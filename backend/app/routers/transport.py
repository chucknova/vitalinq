"""
Transport request queue for patient-side ambulance coordination.

This powers:
  - Patient "I need transport" requests after a bed is accepted
  - Dispatcher-facing transport queue
  - Demo dispatch of the nearest ambulance-capable provider
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import supabase
from app.services.transport_queue import (
    dispatch_transport,
    get_handshake,
    list_transport_requests,
    request_transport,
)
from app.services.whatsapp import send_text

router = APIRouter(prefix="/transport", tags=["Transport"])


class DispatchTransportRequest(BaseModel):
    provider_id: str | None = None


@router.get("/requests")
async def get_transport_requests():
    """List active patient transport requests for the dispatcher queue."""
    return {"requests": list_transport_requests()}


@router.post("/requests/{handshake_id}/dispatch")
async def dispatch_transport_request(handshake_id: str, request: DispatchTransportRequest):
    """Assign the nearest ambulance-capable provider for demo dispatch."""
    try:
        transport = dispatch_transport(handshake_id, request.provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    handshake = get_handshake(handshake_id)
    hospital = (
        supabase.table("hospitals")
        .select("name, address")
        .eq("id", handshake["receiving_hospital_id"])
        .execute()
    )
    hospital_name = hospital.data[0]["name"] if hospital.data else "the receiving hospital"

    provider_phone = transport.get("provider_whatsapp_number")
    if provider_phone:
        await send_text(
            provider_phone,
            (
                f"🚑 *Transport Dispatch Request*\n\n"
                f"Pickup: {transport.get('pickup_address') or 'Shared GPS location'}\n"
                f"Destination: *{hospital_name}*\n"
                f"Patient: {handshake.get('patient_summary') or 'Emergency patient'}\n"
                f"Transfer code: *{handshake.get('transfer_code')}*\n"
                f"Urgency: {(handshake.get('parsed_requirements') or {}).get('urgency', 'medium').upper()}"
            ),
        )

    return {"handshake_id": handshake_id, "transport": transport}
