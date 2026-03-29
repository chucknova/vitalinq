"""
Transport Request API — patient ambulance requests.

POST   /api/transport/request                    — patient requests transport
POST   /api/transport/{id}/hospital-respond      — hospital accepts/declines
POST   /api/transport/{id}/dispatch-respond       — dispatch company accepts
GET    /api/transport/{id}                        — get transport request status
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase
from app.services.transport_reroute import reroute_transport_request
from app.services.whatsapp import send_text, send_buttons

router = APIRouter(prefix="/transport", tags=["Transport"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class TransportRequest(BaseModel):
    handshake_id: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    pickup_address: str = ""

class HospitalResponse(BaseModel):
    accepted: bool

class DispatchResponse(BaseModel):
    company_id: str
    ambulance_id: str


def _format_pickup_display(transport: dict) -> str:
    pickup_address = (transport.get("pickup_address") or "").strip()
    generic_labels = {
        "",
        "location shared",
        "shared gps location",
        "patient live location",
    }
    if pickup_address.lower() not in generic_labels:
        return pickup_address

    lat = transport.get("pickup_lat")
    lng = transport.get("pickup_lng")
    if lat is not None and lng is not None:
        return f"Lat {float(lat):.5f}, Lng {float(lng):.5f}"

    return "Location shared"


async def start_transport_request_flow(transport: dict, handshake: dict | None = None) -> dict:
    """
    Kick off the existing hospital-first transport workflow for a transport row.

    This lets normal patient transport and broadcast-created transport requests
    share the exact same downstream behavior.
    """
    if not transport.get("destination_hospital_id"):
        raise HTTPException(status_code=400, detail="Transport request has no destination hospital")

    hosp = (
        supabase.table("hospitals")
        .select("id, name, phone, whatsapp_number")
        .eq("id", transport["destination_hospital_id"])
        .execute()
    )
    if not hosp.data:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital = hosp.data[0]

    if handshake is None and transport.get("handshake_id"):
        hs = supabase.table("handshakes").select("*").eq("id", transport["handshake_id"]).execute()
        handshake = hs.data[0] if hs.data else None

    severity = transport.get("severity") or "medium"
    if handshake and isinstance(handshake.get("parsed_requirements"), dict):
        severity = handshake["parsed_requirements"].get("urgency", severity)

    _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="asking_hospital",
        patient_status="assigned",
    )

    patient_phone = transport.get("patient_phone")
    should_notify_patient = patient_phone and patient_phone != "dispatch"
    if should_notify_patient:
        await send_text(patient_phone, (
            "🚑 *Transport request received.*\n\n"
            f"We're checking if *{hospital['name']}* can send an ambulance to pick you up.\n"
            "Please wait — we'll update you shortly."
        ))

    wa_number = hospital.get("whatsapp_number")
    if wa_number:
        severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")
        await send_buttons(wa_number, (
            f"🚑 *Transport Request*\n\n"
            f"A patient with a confirmed bed needs pickup.\n"
            f"Severity: {severity_emoji} *{severity.upper()}*\n"
            f"Pickup: {_format_pickup_display(transport)}\n"
            f"Transfer code: *{(handshake or {}).get('transfer_code', 'N/A')}*\n\n"
            f"Can you send an ambulance?"
        ), [
            ("✅ Yes, we'll send", f"transport_hospital_accept_{transport['id']}"),
            ("❌ No ambulance available", f"transport_hospital_decline_{transport['id']}"),
        ])

    print(f"🚑 TRANSPORT REQUEST: {transport['id'][:8]} — asking {hospital['name']}")

    return {
        "transport_id": transport["id"],
        "status": "asking_hospital",
        "hospital": hospital["name"],
    }


def _find_broadcast_patient_for_transport(transport_id: str | None = None, handshake_id: str | None = None) -> dict | None:
    if transport_id:
        patient = (
            supabase.table("broadcast_patients")
            .select("id, status, transport_id, ambulance_assignment_id, assigned_ambulance_id")
            .eq("transport_id", transport_id)
            .execute()
        )
        if patient.data:
            return patient.data[0]

    if handshake_id:
        patient = (
            supabase.table("broadcast_patients")
            .select("id, status, transport_id, ambulance_assignment_id, assigned_ambulance_id")
            .eq("handshake_id", handshake_id)
            .execute()
        )
        if patient.data:
            return patient.data[0]

    return None


def _sync_broadcast_patient_transport(
    *,
    transport_id: str,
    handshake_id: str | None = None,
    transport_status: str | None = None,
    assignment_id: str | None = None,
    ambulance_id: str | None = None,
    patient_status: str | None = None,
):
    patient = _find_broadcast_patient_for_transport(transport_id=transport_id, handshake_id=handshake_id)
    if not patient:
        return

    update_data = {}
    if patient.get("transport_id") != transport_id:
        update_data["transport_id"] = transport_id
    if transport_status is not None:
        update_data["transport_status"] = transport_status
    if assignment_id is not None:
        update_data["ambulance_assignment_id"] = assignment_id
    if ambulance_id is not None:
        update_data["assigned_ambulance_id"] = ambulance_id
    if patient_status is not None:
        update_data["status"] = patient_status

    if update_data:
        supabase.table("broadcast_patients").update(update_data).eq("id", patient["id"]).execute()


# ---------------------------------------------------------------------------
# POST /api/transport/request — patient requests transport
# ---------------------------------------------------------------------------

@router.post("/request")
async def request_transport(request: TransportRequest):
    """
    Patient requests ambulance transport.
    Step 1: Create the request.
    Step 2: Ask the receiving hospital first.
    """

    # Get handshake details
    hs = supabase.table("handshakes").select("*").eq("id", request.handshake_id).execute()
    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found")
    handshake = hs.data[0]

    if handshake["status"] != "accepted":
        raise HTTPException(status_code=400, detail="Bed must be confirmed before requesting transport")

    hospital_id = handshake["receiving_hospital_id"]
    patient_phone = handshake["requesting_party_phone"]
    severity = "medium"
    pr = handshake.get("parsed_requirements")
    if pr and isinstance(pr, dict):
        severity = pr.get("urgency", "medium")

    # Create transport request
    tr = supabase.table("transport_requests").insert({
        "handshake_id": request.handshake_id,
        "patient_phone": patient_phone,
        "pickup_lat": request.pickup_lat,
        "pickup_lng": request.pickup_lng,
        "pickup_address": request.pickup_address,
        "destination_hospital_id": hospital_id,
        "severity": severity,
        "status": "asking_hospital",
    }).execute()

    return await start_transport_request_flow(tr.data[0], handshake)


# ---------------------------------------------------------------------------
# POST /api/transport/{id}/hospital-respond — hospital accepts or declines
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/hospital-respond")
async def hospital_respond(transport_id: str, request: HospitalResponse):
    """Hospital responds to the transport request."""
    tr = supabase.table("transport_requests").select("*").eq("id", transport_id).execute()
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if transport["status"] != "asking_hospital":
        raise HTTPException(status_code=400, detail=f"Request is no longer pending (status: {transport['status']})")

    if request.accepted:
        return await _hospital_accepted(transport)
    else:
        return await _hospital_declined(transport)


async def _hospital_accepted(transport: dict):
    """Hospital will send their own ambulance."""
    now = datetime.now(timezone.utc).isoformat()

    # Get hospital phone
    hosp = supabase.table("hospitals").select("name, phone, whatsapp_number").eq("id", transport["destination_hospital_id"]).execute()
    hospital = hosp.data[0] if hosp.data else {}
    hospital_phone = hospital.get("phone") or hospital.get("whatsapp_number") or ""

    # Update transport request
    supabase.table("transport_requests").update({
        "status": "hospital_accepted",
        "hospital_response": "accepted",
        "crew_phone": hospital_phone,
        "resolved_at": now,
    }).eq("id", transport["id"]).execute()
    _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="hospital_accepted",
        patient_status="en_route",
    )

    # Notify patient — simple, just a phone number
    await send_text(transport["patient_phone"], (
        f"🚑 *Great news!* {hospital.get('name', 'The hospital')} is sending transport to pick you up.\n\n"
        f"📞 Contact them directly if needed: *{hospital_phone or 'See hospital details'}*\n\n"
        f"Stay at your pickup location and keep your phone nearby."
    ))

    print(f"   ✅ TRANSPORT: Hospital accepted — {hospital.get('name')}")

    return {"status": "hospital_accepted", "crew_phone": hospital_phone}


async def _hospital_declined(transport: dict):
    """Hospital can't send ambulance — escalate to dispatch companies."""
    now = datetime.now(timezone.utc).isoformat()

    supabase.table("transport_requests").update({
        "status": "asking_dispatch",
        "hospital_response": "declined",
    }).eq("id", transport["id"]).execute()
    _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="asking_dispatch",
        patient_status="assigned",
    )

    # Find dispatch companies (all active ones for now)
    companies = (
        supabase.table("dispatch_companies")
        .select("id, name, phone, slug")
        .eq("is_active", True)
        .execute()
    ).data or []

    if not companies:
        # No dispatch companies at all — go straight to no ambulance
        return await _no_ambulance_available(transport)

    # Notify patient that we're looking
    await send_text(transport["patient_phone"], (
        "🚑 The hospital doesn't have an ambulance available.\n"
        "We're now checking private ambulance services in your area. Please hold on."
    ))

    # Get hospital name for the dispatch notification
    hosp = supabase.table("hospitals").select("name").eq("id", transport["destination_hospital_id"]).execute()
    hospital_name = hosp.data[0]["name"] if hosp.data else "hospital"

    severity = transport.get("severity", "medium")
    severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")

    # Notify each dispatch company via WhatsApp
    notified = 0
    for company in companies:
        phone = company.get("phone")
        if not phone:
            continue

        await send_buttons(phone, (
            f"🚑 *Ambulance Needed*\n\n"
            f"Severity: {severity_emoji} *{severity.upper()}*\n"
            f"Pickup: {_format_pickup_display(transport)}\n"
            f"Destination: *{hospital_name}*\n\n"
            f"Can your company respond?"
        ), [
            ("✅ We'll respond", f"transport_dispatch_accept_{transport['id']}_{company['id']}"),
            ("❌ Can't respond", f"transport_dispatch_decline_{transport['id']}_{company['id']}"),
        ])
        notified += 1

    # Also make it visible on dispatch dashboards
    supabase.table("transport_requests").update({
        "status": "asking_dispatch",
    }).eq("id", transport["id"]).execute()

    print(f"   📡 TRANSPORT: Escalated to {notified} dispatch companies")

    return {"status": "asking_dispatch", "companies_notified": notified}


async def _no_ambulance_available(transport: dict):
    """No one can provide an ambulance."""
    now = datetime.now(timezone.utc).isoformat()

    supabase.table("transport_requests").update({
        "status": "no_ambulance",
        "resolved_at": now,
    }).eq("id", transport["id"]).execute()
    _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="no_ambulance",
        patient_status="assigned",
    )

    # Get hospital for directions link
    hosp = supabase.table("hospitals").select("name, address").eq("id", transport["destination_hospital_id"]).execute()
    hospital = hosp.data[0] if hosp.data else {}
    hospital_name = hospital.get("name", "the hospital")
    addr = hospital.get("address", hospital_name + " Lagos")
    maps_link = f"https://maps.google.com/maps?daddr={addr.replace(' ', '+')}"

    await send_text(transport["patient_phone"], (
        f"⚠️ *We're sorry — no ambulance is available right now.*\n\n"
        f"Your bed at *{hospital_name}* is still held.\n\n"
        f"Here are your options:\n"
        f"  📞 Call LASEMA: *767* or *112*\n"
        f"  🚕 Take a taxi or ask someone nearby to drive you\n"
        f"  🗺 Directions: {maps_link}\n\n"
        f"If your condition worsens, call 112 immediately."
    ))

    print(f"   ❌ TRANSPORT: No ambulance available")

    return {"status": "no_ambulance"}


# ---------------------------------------------------------------------------
# POST /api/transport/{id}/dispatch-respond — dispatch company accepts
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/dispatch-respond")
async def dispatch_respond(transport_id: str, request: DispatchResponse):
    """
    A dispatch company accepts and assigns an ambulance.
    Creates the ambulance assignment with crew tracking.
    """
    tr = supabase.table("transport_requests").select("*").eq("id", transport_id).execute()
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if transport["status"] not in ("asking_dispatch",):
        raise HTTPException(status_code=400, detail=f"Request is no longer pending (status: {transport['status']})")

    # Verify ambulance exists and is available
    amb = supabase.table("ambulances").select("*").eq("id", request.ambulance_id).execute()
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    ambulance = amb.data[0]
    if ambulance["status"] != "available":
        raise HTTPException(status_code=400, detail="Ambulance is not available")

    # Get company name
    company = supabase.table("dispatch_companies").select("name").eq("id", request.company_id).execute()
    company_name = company.data[0]["name"] if company.data else "Ambulance service"
    broadcast_patient = _find_broadcast_patient_for_transport(
        transport_id=transport_id,
        handshake_id=transport.get("handshake_id"),
    )

    now = datetime.now(timezone.utc).isoformat()

    # Create ambulance assignment
    assignment = supabase.table("ambulance_assignments").insert({
        "ambulance_id": request.ambulance_id,
        "broadcast_patient_id": broadcast_patient["id"] if broadcast_patient else None,
        "handshake_id": transport.get("handshake_id"),
        "pickup_lat": transport.get("pickup_lat"),
        "pickup_lng": transport.get("pickup_lng"),
        "pickup_address": transport.get("pickup_address"),
        "destination_hospital_id": transport.get("destination_hospital_id"),
        "status": "dispatched",
        "assigned_at": now,
    }).execute()

    assignment_id = assignment.data[0]["id"]

    # Log initial status
    supabase.table("ambulance_status_updates").insert({
        "assignment_id": assignment_id,
        "status": "dispatched",
        "note": f"Dispatched by {company_name}",
    }).execute()

    # Update ambulance status
    supabase.table("ambulances").update({
        "status": "dispatched",
        "updated_at": now,
    }).eq("id", request.ambulance_id).execute()

    # Update transport request
    crew_phone = ambulance.get("crew_phone") or ""
    supabase.table("transport_requests").update({
        "status": "dispatch_accepted",
        "accepted_by_company_id": request.company_id,
        "assignment_id": assignment_id,
        "crew_phone": crew_phone,
        "resolved_at": now,
    }).eq("id", transport_id).execute()
    _sync_broadcast_patient_transport(
        transport_id=transport_id,
        handshake_id=transport.get("handshake_id"),
        transport_status="dispatch_accepted",
        assignment_id=assignment_id,
        ambulance_id=request.ambulance_id,
        patient_status="en_route",
    )

    # Get transfer code from the handshake
    transfer_code = ""
    if transport.get("handshake_id"):
        hs = supabase.table("handshakes").select("transfer_code").eq("id", transport["handshake_id"]).execute()
        if hs.data:
            transfer_code = hs.data[0].get("transfer_code", "")

    # Notify patient
    await send_text(transport["patient_phone"], (
        f"🚑 *Ambulance dispatched!*\n\n"
        f"*{company_name}* is sending ambulance *{ambulance['vehicle_id']}* to pick you up.\n"
        f"Vehicle: {ambulance.get('plate_number', '')}\n\n"
        f"📞 Contact crew: *{crew_phone or 'N/A'}*\n\n"
        f"Stay at your pickup location. They're on their way.\n\n"
        f"Track your ambulance:\n"
        f"{{FRONTEND_URL}}/transport/{transport_id}/track"
    ))

    # Notify crew — include transfer code
    if crew_phone:
        hosp = supabase.table("hospitals").select("name, address").eq("id", transport["destination_hospital_id"]).execute()
        hospital_name = hosp.data[0]["name"] if hosp.data else "hospital"
        hospital_address = hosp.data[0].get("address", "") if hosp.data else ""

        await send_text(crew_phone, (
            f"🚑 *New Pickup — {ambulance['vehicle_id']}*\n\n"
            f"Pickup: {_format_pickup_display(transport)}\n"
            f"Destination: *{hospital_name}*\n"
            f"{f'Address: {hospital_address}' + chr(10) if hospital_address else ''}"
            f"Patient phone: {transport['patient_phone']}\n"
            f"{f'Transfer code: *{transfer_code}*' + chr(10) if transfer_code else ''}\n"
            f"Show the transfer code when you arrive at the hospital.\n\n"
            f"Update your status:\n"
            f"{{FRONTEND_URL}}/ambulance/{request.ambulance_id}/crew"
        ))

    print(f"   🚑 TRANSPORT: {company_name} dispatched {ambulance['vehicle_id']}")

    return {
        "status": "dispatch_accepted",
        "assignment_id": assignment_id,
        "ambulance": ambulance["vehicle_id"],
        "company": company_name,
        "crew_phone": crew_phone,
    }


# ---------------------------------------------------------------------------
# GET /api/transport/{id} — get transport request status
# ---------------------------------------------------------------------------

@router.get("/{transport_id}")
async def get_transport(transport_id: str):
    """Get the current status of a transport request."""
    tr = supabase.table("transport_requests").select("*").eq("id", transport_id).execute()
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    # Get hospital name
    hospital = None
    if transport.get("destination_hospital_id"):
        h = supabase.table("hospitals").select("name, address, phone").eq("id", transport["destination_hospital_id"]).execute()
        hospital = h.data[0] if h.data else None
    transport["_hospital"] = hospital

    # Get company name if accepted by dispatch
    company = None
    if transport.get("accepted_by_company_id"):
        c = supabase.table("dispatch_companies").select("name, phone").eq("id", transport["accepted_by_company_id"]).execute()
        company = c.data[0] if c.data else None
    transport["_company"] = company

    # Get assignment timeline if dispatch accepted
    timeline = []
    if transport.get("assignment_id"):
        updates = (
            supabase.table("ambulance_status_updates")
            .select("status, note, created_at")
            .eq("assignment_id", transport["assignment_id"])
            .order("created_at")
            .execute()
        ).data or []
        timeline = updates

        # Get ambulance info
        assignment = supabase.table("ambulance_assignments").select("ambulance_id, status").eq("id", transport["assignment_id"]).execute()
        if assignment.data:
            amb = supabase.table("ambulances").select("vehicle_id, plate_number, type, crew_name").eq("id", assignment.data[0]["ambulance_id"]).execute()
            transport["_ambulance"] = amb.data[0] if amb.data else None
            transport["_assignment_status"] = assignment.data[0]["status"]

    transport["_timeline"] = timeline

    # Detect if rerouted
    reroute_entry = next((t for t in timeline if t["status"] == "rerouted"), None)
    transport["_rerouted"] = reroute_entry is not None
    transport["_reroute_note"] = reroute_entry["note"] if reroute_entry else None

    return transport


# ---------------------------------------------------------------------------
# GET /api/transport/hospital/{hospital_id}/pending — hospital's pending requests
# ---------------------------------------------------------------------------

@router.get("/hospital/{hospital_id}/pending")
async def get_hospital_pending_transports(hospital_id: str):
    """Get transport requests waiting for this hospital's response."""
    results = (
        supabase.table("transport_requests")
        .select("*")
        .eq("destination_hospital_id", hospital_id)
        .eq("status", "asking_hospital")
        .order("created_at", desc=True)
        .execute()
    ).data or []

    for result in results:
        result["pickup_address"] = _format_pickup_display(result)

    return {"pending": results}


# ---------------------------------------------------------------------------
# GET /api/transport/dispatch/pending — all requests waiting for dispatch
# ---------------------------------------------------------------------------

@router.get("/dispatch/pending")
async def get_dispatch_pending_transports():
    """Get transport requests waiting for a dispatch company to accept."""
    results = (
        supabase.table("transport_requests")
        .select("*")
        .eq("status", "asking_dispatch")
        .order("created_at", desc=True)
        .execute()
    ).data or []

    # Enrich with hospital names
    for r in results:
        r["pickup_address"] = _format_pickup_display(r)
        if r.get("destination_hospital_id"):
            h = supabase.table("hospitals").select("name, address").eq("id", r["destination_hospital_id"]).execute()
            r["_hospital"] = h.data[0] if h.data else None

    return {"pending": results}

# ---------------------------------------------------------------------------
# POST /api/transport/{id}/reroute — reroute ambulance to a new hospital
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/reroute")
async def reroute_transport(transport_id: str):
    return await reroute_transport_request(transport_id)
