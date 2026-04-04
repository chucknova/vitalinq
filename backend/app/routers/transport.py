"""
Transport Request API — patient ambulance requests.

POST   /api/transport/request                    — patient requests transport
POST   /api/transport/{id}/hospital-respond      — hospital accepts/declines
POST   /api/transport/{id}/dispatch-respond       — dispatch company accepts
GET    /api/transport/{id}                        — get transport request status
"""

import asyncio
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase, execute_async
from app.config import settings
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


def _extract_emergency_phone(handshake: dict | None) -> str | None:
    if not handshake or not isinstance(handshake.get("parsed_requirements"), dict):
        return None
    phone = (handshake["parsed_requirements"].get("emergency_contact_phone") or "").strip()
    return phone or None


async def _resolve_transport_contacts(transport: dict, handshake: dict | None = None) -> tuple[str | None, str | None]:
    primary_phone = (transport.get("patient_phone") or "").strip() or None
    emergency_phone = _extract_emergency_phone(handshake)

    if handshake is None and transport.get("handshake_id"):
        hs = await execute_async(supabase.table("handshakes").select("parsed_requirements").eq("id", transport["handshake_id"]))
        handshake = hs.data[0] if hs.data else None
        emergency_phone = _extract_emergency_phone(handshake)

    if emergency_phone == primary_phone:
        emergency_phone = None

    return primary_phone, emergency_phone


async def _notify_transport_contacts(transport: dict, message: str, handshake: dict | None = None):
    primary_phone, emergency_phone = await _resolve_transport_contacts(transport, handshake)
    for phone in [primary_phone, emergency_phone]:
        if phone:
            await send_text(phone, message)


async def _send_text_background(phone: str, message: str):
    try:
        await send_text(phone, message)
    except Exception as exc:
        print(f"   ⚠️ Background send_text failed: {exc}")


async def _send_buttons_background(phone: str, message: str, buttons: list[tuple[str, str]]):
    try:
        await send_buttons(phone, message, buttons)
    except Exception as exc:
        print(f"   ⚠️ Background send_buttons failed: {exc}")


async def _notify_transport_contacts_background(transport: dict, message: str, handshake: dict | None = None):
    try:
        await _notify_transport_contacts(transport, message, handshake)
    except Exception as exc:
        print(f"   ⚠️ Background contact notification failed: {exc}")


def _schedule_background_task(
    background_tasks: BackgroundTasks | None,
    func,
    *args,
):
    if background_tasks is not None:
        background_tasks.add_task(func, *args)
        return

    asyncio.create_task(func(*args))


def _build_emergency_track_link(handshake_id: str | None) -> str | None:
    if not handshake_id:
        return None
    return f"{settings.FRONTEND_URL}/emergency/{handshake_id}/track"


def _rows_by_id(rows: list[dict]) -> dict[str, dict]:
    return {row["id"]: row for row in rows if row.get("id")}


def _group_updates_by_assignment(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        assignment_id = row.get("assignment_id")
        if not assignment_id:
            continue
        grouped.setdefault(assignment_id, []).append({
            "status": row.get("status"),
            "note": row.get("note"),
            "created_at": row.get("created_at"),
        })
    return grouped


async def _hydrate_transports(transports: list[dict], include_timeline: bool = False) -> list[dict]:
    if not transports:
        return []

    hospital_ids = list({transport["destination_hospital_id"] for transport in transports if transport.get("destination_hospital_id")})
    company_ids = list({transport["accepted_by_company_id"] for transport in transports if transport.get("accepted_by_company_id")})
    assignment_ids = list({transport["assignment_id"] for transport in transports if transport.get("assignment_id")})

    hospitals_task = execute_async(
        supabase.table("hospitals")
        .select("id, name, address, phone")
        .in_("id", hospital_ids)
    ) if hospital_ids else None

    companies_task = execute_async(
        supabase.table("dispatch_companies")
        .select("id, name, phone")
        .in_("id", company_ids)
    ) if company_ids else None

    assignments_task = execute_async(
        supabase.table("ambulance_assignments")
        .select("id, ambulance_id, status")
        .in_("id", assignment_ids)
    ) if assignment_ids else None

    updates_task = execute_async(
        supabase.table("ambulance_status_updates")
        .select("assignment_id, status, note, created_at")
        .in_("assignment_id", assignment_ids)
        .order("created_at")
    ) if include_timeline and assignment_ids else None

    hospitals_result, companies_result, assignments_result, updates_result = await asyncio.gather(
        hospitals_task if hospitals_task is not None else asyncio.sleep(0, result=None),
        companies_task if companies_task is not None else asyncio.sleep(0, result=None),
        assignments_task if assignments_task is not None else asyncio.sleep(0, result=None),
        updates_task if updates_task is not None else asyncio.sleep(0, result=None),
    )

    hospitals_by_id = _rows_by_id((hospitals_result.data or [])) if hospitals_result else {}
    companies_by_id = _rows_by_id((companies_result.data or [])) if companies_result else {}
    assignments_by_id = _rows_by_id((assignments_result.data or [])) if assignments_result else {}
    updates_by_assignment = _group_updates_by_assignment((updates_result.data or [])) if updates_result else {}

    ambulance_ids = list({
        assignment["ambulance_id"]
        for assignment in assignments_by_id.values()
        if assignment.get("ambulance_id")
    })
    ambulances_by_id = {}
    if ambulance_ids:
        ambulances = await execute_async(
            supabase.table("ambulances")
            .select("id, vehicle_id, plate_number, type, crew_name")
            .in_("id", ambulance_ids)
        )
        ambulances_by_id = _rows_by_id(ambulances.data or [])

    hydrated = []
    for transport in transports:
        item = dict(transport)
        item["_hospital"] = hospitals_by_id.get(item.get("destination_hospital_id"))
        item["_company"] = companies_by_id.get(item.get("accepted_by_company_id"))

        assignment = assignments_by_id.get(item.get("assignment_id"))
        item["_assignment_status"] = assignment.get("status") if assignment else None
        item["_ambulance"] = ambulances_by_id.get(assignment.get("ambulance_id")) if assignment else None

        timeline = updates_by_assignment.get(item.get("assignment_id"), []) if include_timeline else []
        item["_timeline"] = timeline
        reroute_entry = next((entry for entry in timeline if entry["status"] == "rerouted"), None)
        item["_rerouted"] = reroute_entry is not None
        item["_reroute_note"] = reroute_entry["note"] if reroute_entry else None
        hydrated.append(item)

    return hydrated


async def _hydrate_transport(transport: dict, include_timeline: bool = False) -> dict:
    hydrated = await _hydrate_transports([transport], include_timeline=include_timeline)
    return hydrated[0]


async def start_transport_request_flow(
    transport: dict,
    handshake: dict | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> dict:
    """
    Kick off the existing hospital-first transport workflow for a transport row.

    This lets normal patient transport and broadcast-created transport requests
    share the exact same downstream behavior.
    """
    if not transport.get("destination_hospital_id"):
        raise HTTPException(status_code=400, detail="Transport request has no destination hospital")

    hosp = await execute_async(
        supabase.table("hospitals")
        .select("id, name, phone, whatsapp_number")
        .eq("id", transport["destination_hospital_id"])
    )
    if not hosp.data:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital = hosp.data[0]

    if handshake is None and transport.get("handshake_id"):
        hs = await execute_async(supabase.table("handshakes").select("*").eq("id", transport["handshake_id"]))
        handshake = hs.data[0] if hs.data else None

    severity = transport.get("severity") or "medium"
    if handshake and isinstance(handshake.get("parsed_requirements"), dict):
        severity = handshake["parsed_requirements"].get("urgency", severity)

    await _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="asking_hospital",
        patient_status="assigned",
    )

    primary_phone, emergency_phone = await _resolve_transport_contacts(transport, handshake)
    if primary_phone and primary_phone != "dispatch":
        track_link = _build_emergency_track_link(transport.get("handshake_id"))
        message = (
            "🚑 *Transport request received.*\n\n"
            f"We're checking if *{hospital['name']}* can send an ambulance to pick you up.\n"
            "Please wait — we'll update you shortly."
        )
        if track_link:
            message += f"\n\nTrack updates:\n{track_link}"
        _schedule_background_task(background_tasks, _send_text_background, primary_phone, message)
        if emergency_phone:
            _schedule_background_task(background_tasks, _send_text_background, emergency_phone, message)

    wa_number = hospital.get("whatsapp_number")
    if wa_number:
        severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")
        _schedule_background_task(
            background_tasks,
            _send_buttons_background,
            wa_number,
            (
                f"🚑 *Transport Request*\n\n"
                f"A patient with a confirmed bed needs pickup.\n"
                f"Severity: {severity_emoji} *{severity.upper()}*\n"
                f"Pickup: {_format_pickup_display(transport)}\n"
                f"Transfer code: *{(handshake or {}).get('transfer_code', 'N/A')}*\n\n"
                f"Can you send an ambulance?"
            ),
            [
                ("✅ Yes, we'll send", f"transport_hospital_accept_{transport['id']}"),
                ("❌ No ambulance available", f"transport_hospital_decline_{transport['id']}"),
            ],
        )

    print(f"🚑 TRANSPORT REQUEST: {transport['id'][:8]} — asking {hospital['name']}")

    return {
        "transport_id": transport["id"],
        "status": "asking_hospital",
        "hospital": hospital["name"],
    }


async def _find_broadcast_patient_for_transport(transport_id: str | None = None, handshake_id: str | None = None) -> dict | None:
    if transport_id:
        patient = await execute_async(
            supabase.table("broadcast_patients")
            .select("id, status, transport_id, ambulance_assignment_id, assigned_ambulance_id")
            .eq("transport_id", transport_id)
        )
        if patient.data:
            return patient.data[0]

    if handshake_id:
        patient = await execute_async(
            supabase.table("broadcast_patients")
            .select("id, status, transport_id, ambulance_assignment_id, assigned_ambulance_id")
            .eq("handshake_id", handshake_id)
        )
        if patient.data:
            return patient.data[0]

    return None


async def _sync_broadcast_patient_transport(
    *,
    transport_id: str,
    handshake_id: str | None = None,
    transport_status: str | None = None,
    assignment_id: str | None = None,
    ambulance_id: str | None = None,
    patient_status: str | None = None,
):
    patient = await _find_broadcast_patient_for_transport(transport_id=transport_id, handshake_id=handshake_id)
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
        await execute_async(supabase.table("broadcast_patients").update(update_data).eq("id", patient["id"]))


# ---------------------------------------------------------------------------
# POST /api/transport/request — patient requests transport
# ---------------------------------------------------------------------------

@router.post("/request")
async def request_transport(request: TransportRequest, background_tasks: BackgroundTasks):
    """
    Patient requests ambulance transport.
    Step 1: Create the request.
    Step 2: Ask the receiving hospital first.
    """

    # Get handshake details
    hs = await execute_async(supabase.table("handshakes").select("*").eq("id", request.handshake_id))
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
    tr = await execute_async(supabase.table("transport_requests").insert({
        "handshake_id": request.handshake_id,
        "patient_phone": patient_phone,
        "pickup_lat": request.pickup_lat,
        "pickup_lng": request.pickup_lng,
        "pickup_address": request.pickup_address,
        "destination_hospital_id": hospital_id,
        "severity": severity,
        "status": "asking_hospital",
    }))

    return await start_transport_request_flow(tr.data[0], handshake, background_tasks)


# ---------------------------------------------------------------------------
# POST /api/transport/{id}/hospital-respond — hospital accepts or declines
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/hospital-respond")
async def hospital_respond(transport_id: str, request: HospitalResponse, background_tasks: BackgroundTasks):
    """Hospital responds to the transport request."""
    tr = await execute_async(supabase.table("transport_requests").select("*").eq("id", transport_id))
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if transport["status"] != "asking_hospital":
        raise HTTPException(status_code=400, detail=f"Request is no longer pending (status: {transport['status']})")

    if request.accepted:
        return await _hospital_accepted(transport, background_tasks)
    else:
        return await _hospital_declined(transport, background_tasks)


async def _hospital_accepted(transport: dict, background_tasks: BackgroundTasks | None = None):
    """Hospital will send their own ambulance."""
    now = datetime.now(timezone.utc)

    # Extend the bed hold — transport is confirmed, give 60 min from now
    if transport.get("handshake_id"):
        new_expiry = now + timedelta(minutes=60)
        await execute_async(supabase.table("handshakes").update({
            "expires_at": new_expiry.isoformat(),
            "hold_duration_min": 60,
        }).eq("id", transport["handshake_id"]).eq("status", "accepted"))
        print(f"   ⏰ Hold extended to {new_expiry.strftime('%H:%M UTC')} (hospital sending transport)")

    # Get hospital phone
    hosp = await execute_async(supabase.table("hospitals").select("name, phone, whatsapp_number").eq("id", transport["destination_hospital_id"]))
    hospital = hosp.data[0] if hosp.data else {}
    hospital_phone = hospital.get("phone") or hospital.get("whatsapp_number") or ""

    # Update transport request
    await execute_async(supabase.table("transport_requests").update({
        "status": "hospital_accepted",
        "hospital_response": "accepted",
        "crew_phone": hospital_phone,
        "resolved_at": now.isoformat(),
    }).eq("id", transport["id"]))
    await _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="hospital_accepted",
        patient_status="en_route",
    )

    # Notify patient — simple, just a phone number
    track_link = _build_emergency_track_link(transport.get("handshake_id"))
    message = (
        f"🚑 *Great news!* {hospital.get('name', 'The hospital')} is sending transport to pick you up.\n\n"
        f"📞 Contact them directly if needed: *{hospital_phone or 'See hospital details'}*\n\n"
        f"Stay at your pickup location and keep your phone nearby."
    )
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _schedule_background_task(
        background_tasks,
        _notify_transport_contacts_background,
        transport,
        message,
        None,
    )

    print(f"   ✅ TRANSPORT: Hospital accepted — {hospital.get('name')}")

    return {"status": "hospital_accepted", "crew_phone": hospital_phone}


async def _hospital_declined(transport: dict, background_tasks: BackgroundTasks | None = None):
    """Hospital can't send ambulance — escalate to dispatch companies."""
    now = datetime.now(timezone.utc).isoformat()

    await execute_async(supabase.table("transport_requests").update({
        "status": "asking_dispatch",
        "hospital_response": "declined",
    }).eq("id", transport["id"]))
    await _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="asking_dispatch",
        patient_status="assigned",
    )

    # Find dispatch companies (all active ones for now)
    companies = (
        await execute_async(
        supabase.table("dispatch_companies")
        .select("id, name, phone, slug")
        .eq("is_active", True)
        )
    ).data or []

    if not companies:
        # No dispatch companies at all — go straight to no ambulance
        return await _no_ambulance_available(transport, background_tasks)

    # Notify patient that we're looking
    track_link = _build_emergency_track_link(transport.get("handshake_id"))
    message = (
        "🚑 The hospital doesn't have an ambulance available.\n"
        "We're now checking private ambulance services in your area. Please hold on."
    )
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _schedule_background_task(
        background_tasks,
        _notify_transport_contacts_background,
        transport,
        message,
        None,
    )

    # Get hospital name for the dispatch notification
    hosp = await execute_async(supabase.table("hospitals").select("name").eq("id", transport["destination_hospital_id"]))
    hospital_name = hosp.data[0]["name"] if hosp.data else "hospital"

    severity = transport.get("severity", "medium")
    severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")

    # Notify each dispatch company via WhatsApp
    notified = 0
    for company in companies:
        phone = company.get("phone")
        if not phone:
            continue

        _schedule_background_task(
            background_tasks,
            _send_buttons_background,
            phone,
            (
                f"🚑 *Ambulance Needed*\n\n"
                f"Severity: {severity_emoji} *{severity.upper()}*\n"
                f"Pickup: {_format_pickup_display(transport)}\n"
                f"Destination: *{hospital_name}*\n\n"
                f"Can your company respond?"
            ),
            [
                ("✅ We'll respond", f"transport_dispatch_accept_{transport['id']}_{company['id']}"),
                ("❌ Can't respond", f"transport_dispatch_decline_{transport['id']}_{company['id']}"),
            ],
        )
        notified += 1

    # Also make it visible on dispatch dashboards
    await execute_async(supabase.table("transport_requests").update({
        "status": "asking_dispatch",
    }).eq("id", transport["id"]))

    print(f"   📡 TRANSPORT: Escalated to {notified} dispatch companies")

    return {"status": "asking_dispatch", "companies_notified": notified}


async def _no_ambulance_available(transport: dict, background_tasks: BackgroundTasks | None = None):
    """No one can provide an ambulance."""
    now = datetime.now(timezone.utc).isoformat()

    await execute_async(supabase.table("transport_requests").update({
        "status": "no_ambulance",
        "resolved_at": now,
    }).eq("id", transport["id"]))
    await _sync_broadcast_patient_transport(
        transport_id=transport["id"],
        handshake_id=transport.get("handshake_id"),
        transport_status="no_ambulance",
        patient_status="assigned",
    )

    # Get hospital for directions link
    hosp = await execute_async(supabase.table("hospitals").select("name, address").eq("id", transport["destination_hospital_id"]))
    hospital = hosp.data[0] if hosp.data else {}
    hospital_name = hospital.get("name", "the hospital")
    addr = hospital.get("address", hospital_name + " Lagos")
    maps_link = f"https://maps.google.com/maps?daddr={addr.replace(' ', '+')}"

    track_link = _build_emergency_track_link(transport.get("handshake_id"))
    message = (
        f"⚠️ *We're sorry — no ambulance is available right now.*\n\n"
        f"Your bed at *{hospital_name}* is still held.\n\n"
        f"Here are your options:\n"
        f"  📞 Call LASEMA: *767* or *112*\n"
        f"  🚕 Take a taxi or ask someone nearby to drive you\n"
        f"  🗺 Directions: {maps_link}\n\n"
        f"If your condition worsens, call 112 immediately."
    )
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _schedule_background_task(
        background_tasks,
        _notify_transport_contacts_background,
        transport,
        message,
        None,
    )

    print(f"   ❌ TRANSPORT: No ambulance available")

    return {"status": "no_ambulance"}


# ---------------------------------------------------------------------------
# POST /api/transport/{id}/dispatch-respond — dispatch company accepts
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/dispatch-respond")
async def dispatch_respond(transport_id: str, request: DispatchResponse, background_tasks: BackgroundTasks):
    """
    A dispatch company accepts and assigns an ambulance.
    Creates the ambulance assignment with crew tracking.
    """
    tr = await execute_async(supabase.table("transport_requests").select("*").eq("id", transport_id))
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if transport["status"] not in ("asking_dispatch",):
        raise HTTPException(status_code=400, detail=f"Request is no longer pending (status: {transport['status']})")

    # Verify ambulance exists and is available
    amb = await execute_async(supabase.table("ambulances").select("*").eq("id", request.ambulance_id))
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    ambulance = amb.data[0]
    if ambulance["status"] != "available":
        raise HTTPException(status_code=400, detail="Ambulance is not available")

    # Get company name
    company = await execute_async(supabase.table("dispatch_companies").select("name").eq("id", request.company_id))
    company_name = company.data[0]["name"] if company.data else "Ambulance service"
    broadcast_patient = await _find_broadcast_patient_for_transport(
        transport_id=transport_id,
        handshake_id=transport.get("handshake_id"),
    )

    now = datetime.now(timezone.utc)

    # Extend the bed hold — ambulance is dispatched, give 60 min from now
    if transport.get("handshake_id"):
        new_expiry = now + timedelta(minutes=60)
        await execute_async(supabase.table("handshakes").update({
            "expires_at": new_expiry.isoformat(),
            "hold_duration_min": 60,
        }).eq("id", transport["handshake_id"]).eq("status", "accepted"))
        print(f"   ⏰ Hold extended to {new_expiry.strftime('%H:%M UTC')} (ambulance dispatched)")

    # Create ambulance assignment
    assignment = await execute_async(supabase.table("ambulance_assignments").insert({
        "ambulance_id": request.ambulance_id,
        "broadcast_patient_id": broadcast_patient["id"] if broadcast_patient else None,
        "handshake_id": transport.get("handshake_id"),
        "pickup_lat": transport.get("pickup_lat"),
        "pickup_lng": transport.get("pickup_lng"),
        "pickup_address": transport.get("pickup_address"),
        "destination_hospital_id": transport.get("destination_hospital_id"),
        "status": "dispatched",
        "assigned_at": now.isoformat(),
    }))

    assignment_id = assignment.data[0]["id"]

    # Log initial status
    await execute_async(supabase.table("ambulance_status_updates").insert({
        "assignment_id": assignment_id,
        "status": "dispatched",
        "note": f"Dispatched by {company_name}",
    }))

    # Update ambulance status
    await execute_async(supabase.table("ambulances").update({
        "status": "dispatched",
        "updated_at": now.isoformat(),
    }).eq("id", request.ambulance_id))

    # Update transport request
    crew_phone = ambulance.get("crew_phone") or ""
    await execute_async(supabase.table("transport_requests").update({
        "status": "dispatch_accepted",
        "accepted_by_company_id": request.company_id,
        "assignment_id": assignment_id,
        "crew_phone": crew_phone,
        "resolved_at": now.isoformat(),
    }).eq("id", transport_id))
    await _sync_broadcast_patient_transport(
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
        hs = await execute_async(supabase.table("handshakes").select("transfer_code").eq("id", transport["handshake_id"]))
        if hs.data:
            transfer_code = hs.data[0].get("transfer_code", "")

    # Notify patient
    track_link = _build_emergency_track_link(transport.get("handshake_id"))
    message = (
        f"🚑 *Ambulance dispatched!*\n\n"
        f"*{company_name}* is sending ambulance *{ambulance['vehicle_id']}* to pick you up.\n"
        f"Vehicle: {ambulance.get('plate_number', '')}\n\n"
        f"📞 Contact crew: *{crew_phone or 'N/A'}*\n\n"
        f"Stay at your pickup location. They're on their way.\n\n"
        f"Track your ambulance:\n"
        f"{track_link or settings.FRONTEND_URL}"
    )
    _schedule_background_task(
        background_tasks,
        _notify_transport_contacts_background,
        transport,
        message,
        None,
    )

    # Notify crew — include transfer code
    if crew_phone:
        hosp = await execute_async(supabase.table("hospitals").select("name, address").eq("id", transport["destination_hospital_id"]))
        hospital_name = hosp.data[0]["name"] if hosp.data else "hospital"
        hospital_address = hosp.data[0].get("address", "") if hosp.data else ""

        _schedule_background_task(
            background_tasks,
            _send_text_background,
            crew_phone,
            (
                f"🚑 *New Pickup — {ambulance['vehicle_id']}*\n\n"
                f"Pickup: {_format_pickup_display(transport)}\n"
                f"Destination: *{hospital_name}*\n"
                f"{f'Address: {hospital_address}' + chr(10) if hospital_address else ''}"
                f"Patient phone: {transport['patient_phone']}\n"
                f"{f'Transfer code: *{transfer_code}*' + chr(10) if transfer_code else ''}\n"
                f"Show the transfer code when you arrive at the hospital.\n\n"
                f"Update your status:\n"
                f"{settings.FRONTEND_URL}/ambulance/{request.ambulance_id}/crew"
            ),
        )

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
async def get_transport(transport_id: str, include_timeline: bool = False):
    """Get the current status of a transport request."""
    tr = await execute_async(supabase.table("transport_requests").select("*").eq("id", transport_id))
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    return await _hydrate_transport(tr.data[0], include_timeline=include_timeline)


@router.get("/by-handshake/{handshake_id}")
async def get_transport_by_handshake(handshake_id: str, include_timeline: bool = False):
    tr = await execute_async(
        supabase.table("transport_requests")
        .select("*")
        .eq("handshake_id", handshake_id)
        .order("created_at", desc=True)
        .limit(1)
    )
    if not tr.data:
        return {"transport": None}
    return {"transport": await _hydrate_transport(tr.data[0], include_timeline=include_timeline)}


# ---------------------------------------------------------------------------
# GET /api/transport/hospital/{hospital_id}/pending — hospital's pending requests
# ---------------------------------------------------------------------------

@router.get("/hospital/{hospital_id}/pending")
async def get_hospital_pending_transports(hospital_id: str):
    """Get transport requests waiting for this hospital's response."""
    results = (
        await execute_async(
            supabase.table("transport_requests")
            .select("*")
            .eq("destination_hospital_id", hospital_id)
            .eq("status", "asking_hospital")
            .order("created_at", desc=True)
        )
    ).data or []

    handshake_ids = [result.get("handshake_id") for result in results if result.get("handshake_id")]
    handshakes_by_id = {}
    if handshake_ids:
        handshake_rows = (
            await execute_async(
                supabase.table("handshakes")
                .select("id, patient_summary, parsed_requirements")
                .in_("id", handshake_ids)
            )
        ).data or []
        handshakes_by_id = {row["id"]: row for row in handshake_rows}

    for result in results:
        result["pickup_address"] = _format_pickup_display(result)
        handshake = handshakes_by_id.get(result.get("handshake_id"))
        if handshake:
            result["_patient_summary"] = handshake.get("patient_summary")
            result["_emergency_contact_phone"] = _extract_emergency_phone(handshake)

    return {"pending": results}


# ---------------------------------------------------------------------------
# GET /api/transport/dispatch/pending — all requests waiting for dispatch
# ---------------------------------------------------------------------------

async def fetch_dispatch_pending_transports() -> list[dict]:
    """Fetch pending dispatch transports with hospital details in one batch."""
    results = (
        await execute_async(
            supabase.table("transport_requests")
            .select("*")
            .eq("status", "asking_dispatch")
            .order("created_at", desc=True)
        )
    ).data or []

    hospital_ids = list({r["destination_hospital_id"] for r in results if r.get("destination_hospital_id")})
    hospitals_by_id = {}
    if hospital_ids:
        hospitals = (
            await execute_async(
                supabase.table("hospitals")
                .select("id, name, address")
                .in_("id", hospital_ids)
            )
        ).data or []
        hospitals_by_id = {hospital["id"]: hospital for hospital in hospitals}

    for result in results:
        result["pickup_address"] = _format_pickup_display(result)
        hospital_id = result.get("destination_hospital_id")
        result["_hospital"] = hospitals_by_id.get(hospital_id)

    return results


@router.get("/dispatch/pending")
async def get_dispatch_pending_transports():
    """Get transport requests waiting for a dispatch company to accept."""
    return {"pending": await fetch_dispatch_pending_transports()}

# ---------------------------------------------------------------------------
# POST /api/transport/{id}/reroute — reroute ambulance to a new hospital
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/reroute")
async def reroute_transport(transport_id: str):
    return await reroute_transport_request(transport_id)

# ---------------------------------------------------------------------------
# POST /api/transport/{id}/cancel — patient cancels transport
# ---------------------------------------------------------------------------

@router.post("/{transport_id}/cancel")
async def cancel_transport(transport_id: str):
    """
    Patient cancels their transport request.
    Frees up the ambulance if one was assigned.
    """
    tr = supabase.table("transport_requests").select("*").eq("id", transport_id).execute()
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if transport["status"] in ("no_ambulance", "cancelled"):
        return {"status": "already_cancelled"}

    now = datetime.now(timezone.utc).isoformat()

    # If an ambulance was assigned, free it up
    if transport.get("assignment_id"):
        # Update assignment status
        supabase.table("ambulance_assignments").update({
            "status": "cancelled",
        }).eq("id", transport["assignment_id"]).execute()

        # Log the cancellation
        supabase.table("ambulance_status_updates").insert({
            "assignment_id": transport["assignment_id"],
            "status": "cancelled",
            "note": "Patient cancelled the transport request",
        }).execute()

        # Free up the ambulance
        assign = supabase.table("ambulance_assignments").select("ambulance_id").eq("id", transport["assignment_id"]).execute()
        if assign.data:
            supabase.table("ambulances").update({
                "status": "available",
                "updated_at": now,
            }).eq("id", assign.data[0]["ambulance_id"]).execute()

        # Notify crew
        if assign.data:
            amb = supabase.table("ambulances").select("crew_phone, vehicle_id").eq("id", assign.data[0]["ambulance_id"]).execute()
            if amb.data and amb.data[0].get("crew_phone"):
                await send_text(amb.data[0]["crew_phone"], (
                    f"❌ *Assignment cancelled — {amb.data[0]['vehicle_id']}*\n\n"
                    f"The patient has cancelled the transport request.\n"
                    f"You are now available for new assignments."
                ))

    # Cancel the transport request
    supabase.table("transport_requests").update({
        "status": "cancelled",
        "resolved_at": now,
    }).eq("id", transport_id).execute()

    print(f"   ❌ TRANSPORT CANCELLED: {transport_id[:8]}")

    return {"status": "cancelled"}


# ---------------------------------------------------------------------------
# POST /api/handshakes/{id}/cancel — patient cancels bed reservation
# ---------------------------------------------------------------------------

@router.post("/cancel-reservation/{handshake_id}")
async def cancel_reservation(handshake_id: str):
    """
    Patient cancels their bed reservation.
    Restores the bed count and cancels any active transport.
    """
    hs = supabase.table("handshakes").select("*").eq("id", handshake_id).execute()
    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found")

    handshake = hs.data[0]

    if handshake["status"] not in ("requested", "accepted"):
        return {"status": "already_resolved", "handshake_status": handshake["status"]}

    now = datetime.now(timezone.utc).isoformat()

    # If bed was accepted, restore the bed count
    if handshake["status"] == "accepted":
        hospital_id = handshake["receiving_hospital_id"]
        bed_type = handshake["bed_type"]

        bed_record = (
            supabase.table("hospital_beds")
            .select("id, available_count")
            .eq("hospital_id", hospital_id)
            .eq("bed_type", bed_type)
            .execute()
        )
        if bed_record.data:
            bed = bed_record.data[0]
            new_count = (bed["available_count"] or 0) + 1
            supabase.table("hospital_beds").update({
                "available_count": new_count,
            }).eq("id", bed["id"]).execute()

    # Mark handshake as cancelled (using declined status with reason)
    supabase.table("handshakes").update({
        "status": "declined",
        "declined_reason": "patient_cancelled",
        "completed_at": now,
    }).eq("id", handshake_id).execute()

    # Cancel any active transport request for this handshake
    transport = (
        supabase.table("transport_requests")
        .select("id, status")
        .eq("handshake_id", handshake_id)
        .execute()
    ).data
    if transport:
        tr = transport[0]
        if tr["status"] not in ("no_ambulance", "cancelled"):
            await cancel_transport(tr["id"])

    # Notify the hospital
    hosp = supabase.table("hospitals").select("whatsapp_number, name").eq("id", handshake["receiving_hospital_id"]).execute()
    if hosp.data and hosp.data[0].get("whatsapp_number"):
        await send_text(hosp.data[0]["whatsapp_number"], (
            f"ℹ️ Patient cancelled their bed reservation.\n"
            f"Transfer code: *{handshake.get('transfer_code', 'N/A')}*\n"
            f"The bed has been restored."
        ))

    print(f"   ❌ RESERVATION CANCELLED: {handshake_id[:8]}")

    return {"status": "cancelled"}
