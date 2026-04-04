"""
Handshake API endpoints — bed reservation lifecycle.

POST /api/handshakes            — create a bed hold request
GET  /api/handshakes/{id}       — check status + countdown timer
POST /api/handshakes/{id}/complete — mark patient arrived
"""

from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, HTTPException
from app.config import settings
from app.models.handshake import (
    HandshakeCreateRequest,
    HandshakeCreateResponse,
    HandshakeStatusResponse,
    HandshakeCompleteRequest,
    HandshakeCompleteResponse,
    HospitalBrief,
    TransportRequestCreate,
    TransportRequestResponse,
)
from app.services.handshake_mgr import (
    create_handshake,
    complete_handshake,
    get_handshake_detail,
)
from app.database import supabase, execute_async
from app.services.transport_queue import request_transport

router = APIRouter(prefix="/handshakes", tags=["Handshakes"])


# ---------------------------------------------------------------------------
# POST /api/handshakes
# ---------------------------------------------------------------------------

@router.post("", response_model=HandshakeCreateResponse)
async def create_handshake_endpoint(request: HandshakeCreateRequest, background_tasks: BackgroundTasks):
    """Create a new bed reservation request."""

    # Verify hospital exists and get WhatsApp number
    hospital = await execute_async(
        supabase.table("hospitals")
        .select("id, name, whatsapp_number, address")
        .eq("id", request.receiving_hospital_id)
    )
    if not hospital.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    h = hospital.data[0]

    handshake = await create_handshake(
        receiving_hospital_id=request.receiving_hospital_id,
        bed_type=request.bed_type,
        requesting_party_type=request.requesting_party_type,
        requesting_party_phone=request.requesting_party_phone,
        patient_summary=request.patient_summary,
        parsed_requirements=request.parsed_requirements,
        query_id=request.query_id,
        hold_duration_min=request.hold_duration_min,
    )

    # Notify the hospital via WhatsApp
    from app.services.whatsapp import send_buttons
    hospital_phone = h.get("whatsapp_number")
    if hospital_phone:
        bed_label = request.bed_type.upper()
        urgency = (request.parsed_requirements or {}).get("urgency", "unknown").upper()
        urgency_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(urgency, "⚪")
        background_tasks.add_task(
            send_buttons,
            hospital_phone,
            (
                f"🚨 *Incoming Patient — Bed Hold Request*\n\n"
                f"Urgency: {urgency_emoji} *{urgency}*\n"
                f"Bed needed: *{bed_label}*\n"
                f"Patient: {request.patient_summary or 'No details provided'}\n"
                f"Transfer code: *{handshake['transfer_code']}*\n\n"
                f"Hold expires in {request.hold_duration_min} min if accepted."
            ),
            [
                ("✅ Accept", f"accept_handshake_{handshake['id']}"),
                ("❌ Decline", f"decline_handshake_{handshake['id']}"),
            ],
        )

    track_link = f"{settings.FRONTEND_URL}/emergency/{handshake['id']}/track"
    emergency_phone = ((request.parsed_requirements or {}).get("emergency_contact_phone") or "").strip()
    if emergency_phone and emergency_phone != request.requesting_party_phone:
        from app.services.whatsapp import send_text
        background_tasks.add_task(
            send_text,
            emergency_phone,
            (
                f"🚨 *Hospital request created for {h['name']}*\n\n"
                f"Booking code: *{handshake['transfer_code']}*\n"
                f"Status: Waiting for hospital confirmation\n\n"
                f"We'll share important updates here too.\n\n"
                f"Track updates:\n{track_link}"
            ),
        )

    return HandshakeCreateResponse(
        handshake_id=handshake["id"],
        transfer_code=handshake["transfer_code"],
        status=handshake["status"],
        receiving_hospital=h["name"],
        message=f"Bed hold request sent to {h['name']}. Awaiting confirmation.",
    )


# ---------------------------------------------------------------------------
# GET /api/handshakes/{id}
# ---------------------------------------------------------------------------

@router.get("/{handshake_id}", response_model=HandshakeStatusResponse)
async def get_handshake_status(handshake_id: str):
    """Check handshake status with countdown timer."""

    handshake = await get_handshake_detail(handshake_id)
    if not handshake:
        raise HTTPException(status_code=404, detail="Handshake not found")

    hospital_info = handshake.get("_hospital", {})

    return HandshakeStatusResponse(
        id=handshake["id"],
        status=handshake["status"],
        transfer_code=handshake["transfer_code"],
        receiving_hospital=HospitalBrief(
            name=hospital_info.get("name", "Unknown"),
            address=hospital_info.get("address", ""),
        ),
        bed_type=handshake["bed_type"],
        patient_summary=handshake.get("patient_summary"),
        parsed_requirements=handshake.get("parsed_requirements"),
        expires_at=handshake.get("expires_at"),
        time_remaining_sec=handshake.get("_time_remaining_sec"),
        declined_reason=handshake.get("declined_reason"),
    )


# ---------------------------------------------------------------------------
# POST /api/handshakes/{id}/complete
# ---------------------------------------------------------------------------

@router.post("/{handshake_id}/complete", response_model=HandshakeCompleteResponse)
async def complete_handshake_endpoint(handshake_id: str, request: HandshakeCompleteRequest):
    """Mark handshake as completed — patient has arrived."""

    handshake = await complete_handshake(handshake_id, request.transfer_code)
    if not handshake:
        raise HTTPException(
            status_code=400,
            detail="Handshake not found, not in accepted status, or wrong transfer code",
        )

    return HandshakeCompleteResponse(
        status="completed",
        completed_at=handshake.get("completed_at", datetime.now(timezone.utc)),
    )


@router.post("/{handshake_id}/transport", response_model=TransportRequestResponse)
async def request_transport_endpoint(handshake_id: str, request: TransportRequestCreate):
    """Patient requests transport after a bed has been accepted."""

    handshake = await get_handshake_detail(handshake_id)
    if not handshake:
        raise HTTPException(status_code=404, detail="Handshake not found")

    try:
        transport = request_transport(
            handshake_id=handshake_id,
            pickup_lat=request.pickup_lat,
            pickup_lng=request.pickup_lng,
            pickup_address=request.pickup_address,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    hospital_info = handshake.get("_hospital", {})

    from app.services.whatsapp import send_text

    hospital_phone = hospital_info.get("whatsapp_number")
    if hospital_phone:
        urgency = (handshake.get("parsed_requirements") or {}).get("urgency", "medium").upper()
        await send_text(
            hospital_phone,
            (
                f"🚑 *Transport Needed for Incoming Patient*\n\n"
                f"Transfer code: *{handshake['transfer_code']}*\n"
                f"Urgency: *{urgency}*\n"
                f"Patient: {handshake.get('patient_summary') or 'No details provided'}\n"
                f"Pickup: {request.pickup_address or 'Shared GPS location'}\n\n"
                f"Please coordinate your ambulance team or call LASEMA / a partner service."
            ),
        )

    return TransportRequestResponse(
        handshake_id=handshake_id,
        transport=transport,
    )
