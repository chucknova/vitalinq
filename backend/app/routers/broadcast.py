"""
Emergency Broadcast API — mass casualty incident coordination.

POST   /api/broadcast                              — trigger a broadcast
GET    /api/broadcast/{id}                         — full dashboard data
PATCH  /api/broadcast/{id}                         — update status (resolve/cancel)
POST   /api/broadcast/{id}/patients                — log a patient (paramedic)
POST   /api/broadcast/patients/{id}/assign         — assign patient to hospital
POST   /api/broadcast/patients/{id}/dispatch       — create a real transport request
POST   /api/broadcast/{id}/auto-distribute         — auto-assign all unassigned
PATCH  /api/broadcast/patients/{id}/position       — update ambulance GPS
"""

import math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase, execute_async
from app.auth import get_current_user
from app.routers.transport import start_transport_request_flow
from app.services.dashboard_cache import get_summary, set_summary, invalidate_summary
from app.services.whatsapp import send_text, send_buttons
from app.services.search_engine import _parse_location

router = APIRouter(prefix="/broadcast", tags=["Emergency Broadcast"])

BROADCAST_SUMMARY_CACHE_TTL_SEC = 10.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _haversine(lat1, lng1, lat2, lng2):
    """Distance in km between two points."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _next_tag_number(broadcast_id: str) -> str:
    """Generate the next MCI tag number for a broadcast."""
    count = await execute_async(
        supabase.table("broadcast_patients")
        .select("id", count="exact")
        .eq("broadcast_id", broadcast_id)
    )
    num = (count.count or 0) + 1
    return f"MCI-{num:03d}"


async def _get_broadcast_or_404(broadcast_id: str) -> dict:
    result = await execute_async(supabase.table("broadcasts").select("*").eq("id", broadcast_id))
    if not result.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    return result.data[0]


async def _load_broadcast_summary(broadcast_id: str) -> dict:
    cached_summary = get_summary("broadcast_summary", broadcast_id)
    if cached_summary is not None:
        return cached_summary

    broadcast = await _get_broadcast_or_404(broadcast_id)

    response_rows = (
        await execute_async(
            supabase.table("broadcast_responses")
            .select("status, icu_available, ward_available, emergency_available, surgical_available, maternity_available, pediatric_available")
            .eq("broadcast_id", broadcast_id)
        )
    ).data or []

    patients = (
        await execute_async(
            supabase.table("broadcast_patients")
            .select("severity, status, assigned_hospital_id, transport_status, transport_id, ambulance_assignment_id")
            .eq("broadcast_id", broadcast_id)
        )
    ).data or []

    total_capacity = {
        "icu": 0, "ward": 0, "emergency": 0,
        "surgical": 0, "maternity": 0, "pediatric": 0,
    }
    for response in response_rows:
        if response.get("status") != "responded":
            continue
        total_capacity["icu"] += response.get("icu_available", 0) or 0
        total_capacity["ward"] += response.get("ward_available", 0) or 0
        total_capacity["emergency"] += response.get("emergency_available", 0) or 0
        total_capacity["surgical"] += response.get("surgical_available", 0) or 0
        total_capacity["maternity"] += response.get("maternity_available", 0) or 0
        total_capacity["pediatric"] += response.get("pediatric_available", 0) or 0

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "deceased": 0}
    status_counts = {
        "unassigned": 0,
        "assigned": 0,
        "dispatched": 0,
        "en_route_to_patient": 0,
        "at_scene": 0,
        "en_route_to_hospital": 0,
        "delivered": 0,
        "admitted": 0,
    }
    for patient in patients:
        severity = patient.get("severity", "medium")
        if severity in severity_counts:
            severity_counts[severity] += 1

        effective_status = patient.get("status") or "unassigned"
        if effective_status not in ("admitted", "deceased"):
            if patient.get("ambulance_assignment_id"):
                effective_status = patient.get("transport_status") or "assigned"
            elif patient.get("transport_id") or patient.get("assigned_hospital_id"):
                effective_status = "assigned"
        if effective_status in status_counts:
            status_counts[effective_status] += 1

    summary = {
        "broadcast": broadcast,
        "response_count": len(response_rows),
        "total_capacity": total_capacity,
        "patient_stats": {
            "total": len(patients),
            "by_severity": severity_counts,
            "by_status": status_counts,
        },
    }
    return set_summary("broadcast_summary", broadcast_id, summary, BROADCAST_SUMMARY_CACHE_TTL_SEC)


async def _load_broadcast_details(broadcast_id: str) -> dict:
    broadcast = await _get_broadcast_or_404(broadcast_id)

    responses = (
        await execute_async(
        supabase.table("broadcast_responses")
        .select("*, hospitals(id, name, slug, address, location, hospital_type)")
        .eq("broadcast_id", broadcast_id)
        .order("responded_at", desc=True)
        )
    ).data or []

    for response in responses:
        hospital = response.get("hospitals", {})
        if hospital and hospital.get("location"):
            lat, lng = _parse_location(hospital["location"])
            response["_hospital_lat"] = lat
            response["_hospital_lng"] = lng
            response["_distance"] = round(_haversine(broadcast["lat"], broadcast["lng"], lat, lng), 1) if lat else None

    patients = (
        await execute_async(
        supabase.table("broadcast_patients")
        .select("*")
        .eq("broadcast_id", broadcast_id)
        .order("created_at", desc=False)
        )
    ).data or []

    hospital_ids = list(set(p["assigned_hospital_id"] for p in patients if p.get("assigned_hospital_id")))
    hospitals_map = {}
    if hospital_ids:
        all_h = await execute_async(supabase.table("hospitals").select("id, name, slug, address").in_("id", hospital_ids))
        hospitals_map = {h["id"]: h for h in (all_h.data or [])}

    handshake_ids = list(set(p["handshake_id"] for p in patients if p.get("handshake_id")))
    handshakes_map = {}
    if handshake_ids:
        all_hs = await execute_async(supabase.table("handshakes").select("id, status, transfer_code, accepted_at, completed_at, declined_reason, expires_at").in_("id", handshake_ids))
        handshakes_map = {h["id"]: h for h in (all_hs.data or [])}

    transport_ids = list(set(p["transport_id"] for p in patients if p.get("transport_id")))
    transports_map = {}
    if transport_ids:
        all_tr = (
            await execute_async(supabase.table("transport_requests")
            .select("id, status, assignment_id, accepted_by_company_id, destination_hospital_id, crew_phone")
            .in_("id", transport_ids)
            )
        )
        transports_map = {t["id"]: t for t in (all_tr.data or [])}

    assignment_ids = list(set(
        (p.get("ambulance_assignment_id") or (transports_map.get(p.get("transport_id")) or {}).get("assignment_id"))
        for p in patients
        if p.get("ambulance_assignment_id") or (transports_map.get(p.get("transport_id")) or {}).get("assignment_id")
    ))
    assignments_map = {}
    ambulance_ids = set()
    if assignment_ids:
        all_assignments = (
            await execute_async(supabase.table("ambulance_assignments")
            .select("id, ambulance_id, status")
            .in_("id", assignment_ids)
            )
        )
        assignments_map = {a["id"]: a for a in (all_assignments.data or [])}
        ambulance_ids = {a["ambulance_id"] for a in assignments_map.values() if a.get("ambulance_id")}

    updates_map = {}
    if assignment_ids:
        all_updates = (
            await execute_async(supabase.table("ambulance_status_updates")
            .select("assignment_id, status, note, created_at")
            .in_("assignment_id", assignment_ids)
            .order("created_at")
            )
        ).data or []
        for update in all_updates:
            assignment_id = update.get("assignment_id")
            if not assignment_id:
                continue
            updates_map.setdefault(assignment_id, []).append(update)

    ambulances_map = {}
    if ambulance_ids:
        all_ambulances = (
            await execute_async(supabase.table("ambulances")
            .select("id, vehicle_id, plate_number, type")
            .in_("id", list(ambulance_ids))
            )
        )
        ambulances_map = {a["id"]: a for a in (all_ambulances.data or [])}

    for patient in patients:
        patient["hospitals"] = hospitals_map.get(patient.get("assigned_hospital_id"))

        handshake = handshakes_map.get(patient.get("handshake_id"))
        if handshake:
            patient["_handshake_status"] = handshake.get("status")
            patient["_transfer_code"] = handshake.get("transfer_code")
            patient["_declined_reason"] = handshake.get("declined_reason")
            if handshake.get("status") == "accepted" and handshake.get("expires_at"):
                expires_str = handshake["expires_at"]
                if isinstance(expires_str, str):
                    expires_dt = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
                    remaining = (expires_dt - datetime.now(timezone.utc)).total_seconds()
                    patient["_hold_remaining_sec"] = max(0, int(remaining))
        else:
            patient["_handshake_status"] = None
            patient["_transfer_code"] = None

        transport = transports_map.get(patient.get("transport_id"))
        assignment = assignments_map.get(
            patient.get("ambulance_assignment_id") or (transport or {}).get("assignment_id")
        )
        ambulance = ambulances_map.get(assignment.get("ambulance_id")) if assignment else None
        updates = updates_map.get(assignment.get("id")) if assignment else []
        latest_update = updates[-1] if updates else None

        patient["_transport_status"] = transport.get("status") if transport else patient.get("transport_status")
        patient["_transport_contact_phone"] = transport.get("crew_phone") if transport else None
        patient["_assignment_status"] = assignment.get("status") if assignment else None
        patient["_ambulance"] = ambulance
        patient["_crew_timeline"] = updates
        patient["_crew_progress"] = latest_update.get("status") if latest_update else patient.get("_assignment_status")
        patient["_crew_note"] = latest_update.get("note") if latest_update else None
        if transport and transport.get("assignment_id") and not patient.get("ambulance_assignment_id"):
            patient["ambulance_assignment_id"] = transport["assignment_id"]

        if patient.get("status") not in ("admitted", "deceased"):
            effective_status = "assigned" if patient.get("assigned_hospital_id") else "unassigned"
            assignment_status = patient.get("_assignment_status")
            transport_status = patient.get("_transport_status")

            if assignment_status in ("assigned", "dispatched", "en_route_to_patient", "at_scene", "en_route_to_hospital", "delivered"):
                effective_status = assignment_status
            elif transport_status in ("asking_hospital", "asking_dispatch", "hospital_accepted", "dispatch_accepted", "no_ambulance", "rerouted", "reroute_failed"):
                effective_status = "assigned"

            patient["_display_status"] = effective_status
        else:
            patient["_display_status"] = patient.get("status")

    return {
        "responses": responses,
        "patients": patients,
    }


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class BroadcastCreate(BaseModel):
    title: str
    description: str = ""
    lat: float
    lng: float
    radius_km: float = Field(default=10, ge=1, le=50)
    expected_patients: int = Field(default=0, ge=0)
    created_by: str = "Dispatcher"
    images: list[str] = Field(default=[], description="Base64-encoded images from the scene")


class PatientLog(BaseModel):
    severity: str = Field(description="critical, high, medium, low, deceased")
    condition_notes: str = ""
    requirements: list[str] = Field(default=[])


class PatientAssign(BaseModel):
    hospital_id: str
    ambulance_id: str = ""


class AutoDistributePreview(BaseModel):
    confirm: bool = False


class PositionUpdate(BaseModel):
    lat: float
    lng: float


class BroadcastUpdate(BaseModel):
    status: str = "resolved"


# ---------------------------------------------------------------------------
# POST /api/broadcast — trigger a broadcast
# ---------------------------------------------------------------------------

@router.post("")
async def create_broadcast(request: BroadcastCreate, user: dict = Depends(get_current_user)):
    """
    Create an emergency broadcast.
    Finds all hospitals in radius and sends WhatsApp notification to each.
    """
    now = datetime.now(timezone.utc)

    # Find hospitals in radius
    hospitals = (
        await execute_async(
        supabase.table("hospitals")
        .select("id, name, whatsapp_number, location, hospital_type")
        .eq("is_active", True)
        )
    ).data

    in_radius = []
    for h in hospitals:
        # Skip clinics/pharmacies — they don't handle mass casualty
        if h.get("hospital_type") in ("clinic", "pharmacy"):
            continue
        h_lat, h_lng = _parse_location(h.get("location"))
        if h_lat is None:
            continue
        dist = _haversine(request.lat, request.lng, h_lat, h_lng)
        if dist <= request.radius_km:
            in_radius.append({**h, "_distance": round(dist, 1), "_lat": h_lat, "_lng": h_lng})

    if not in_radius:
        raise HTTPException(status_code=404, detail="No hospitals found in the specified radius")

    # Create broadcast record
    broadcast = await execute_async(supabase.table("broadcasts").insert({
        "title": request.title,
        "description": request.description,
        "lat": request.lat,
        "lng": request.lng,
        "radius_km": request.radius_km,
        "expected_patients": request.expected_patients,
        "status": "active",
        "hospitals_pinged": len(in_radius),
        "hospitals_responded": 0,
        "created_by": request.created_by,
        "images": request.images if request.images else None,
    }))

    broadcast_id = broadcast.data[0]["id"]
    invalidate_summary("broadcast_summary", broadcast_id)

    # Send WhatsApp to each hospital
    sent_count = 0
    for h in in_radius:
        phone = h.get("whatsapp_number")
        if not phone:
            continue

        await send_buttons(phone, (
            f"\U0001f6a8 *EMERGENCY BROADCAST — Mass Casualty Event*\n\n"
            f"Incident: *{request.title}*\n"
            f"{request.description}\n"
            f"Distance from you: *{h['_distance']}km*\n"
            f"Expected patients: *~{request.expected_patients}*\n\n"
            f"Please report your CURRENT bed availability immediately."
        ), [
            ("\U0001f3e5 Report Capacity", f"broadcast_report_{broadcast_id}"),
            ("\u274c Unable to Help", f"broadcast_decline_{broadcast_id}"),
        ])
        sent_count += 1

    print(f"\U0001f6a8 BROADCAST: '{request.title}' — {sent_count} hospitals notified in {request.radius_km}km radius")

    return {
        "broadcast_id": broadcast_id,
        "title": request.title,
        "hospitals_pinged": len(in_radius),
        "hospitals_notified": sent_count,
        "status": "active",
    }


# ---------------------------------------------------------------------------
# GET /api/broadcast — list all broadcasts
# ---------------------------------------------------------------------------

@router.get("")
async def list_broadcasts(user: dict = Depends(get_current_user)):
    """List all broadcasts, active first, then by most recent."""
    result = await execute_async(
        supabase.table("broadcasts")
        .select("*")
        .order("status", desc=False)
        .order("created_at", desc=True)
    )
    return {"broadcasts": result.data or []}


# ---------------------------------------------------------------------------
# GET /api/broadcast/{id} — full dashboard data
# ---------------------------------------------------------------------------

@router.get("/{broadcast_id}")
async def get_broadcast(broadcast_id: str, user: dict = Depends(get_current_user)):
    """Returns the lightweight broadcast dashboard summary."""
    return await _load_broadcast_summary(broadcast_id)


@router.get("/{broadcast_id}/details")
async def get_broadcast_details(broadcast_id: str, user: dict = Depends(get_current_user)):
    """Returns the heavy patient and hospital detail for the broadcast dashboard."""
    return await _load_broadcast_details(broadcast_id)


# ---------------------------------------------------------------------------
# PATCH /api/broadcast/{id} — resolve/cancel
# ---------------------------------------------------------------------------

@router.patch("/{broadcast_id}")
async def update_broadcast(broadcast_id: str, request: BroadcastUpdate, user: dict = Depends(get_current_user)):
    """Update broadcast status (resolve or cancel)."""
    now = datetime.now(timezone.utc).isoformat()
    invalidate_summary("broadcast_summary", broadcast_id)

    bc = supabase.table("broadcasts").select("id").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")

    supabase.table("broadcasts").update({
        "status": request.status,
        "resolved_at": now if request.status == "resolved" else None,
    }).eq("id", broadcast_id).execute()

    return {"status": request.status}


# ---------------------------------------------------------------------------
# DELETE /api/broadcast/{id}
# ---------------------------------------------------------------------------

@router.delete("/{broadcast_id}")
async def delete_broadcast(broadcast_id: str, user: dict = Depends(get_current_user)):
    """Delete a broadcast and all related data (responses + patients)."""
    bc = supabase.table("broadcasts").select("id").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    invalidate_summary("broadcast_summary", broadcast_id)

    # CASCADE handles responses and patients (FK with ON DELETE CASCADE)
    supabase.table("broadcasts").delete().eq("id", broadcast_id).execute()

    return {"deleted": True, "broadcast_id": broadcast_id}


# ---------------------------------------------------------------------------
# POST /api/broadcast/{id}/patients — log a patient
# ---------------------------------------------------------------------------

@router.post("/{broadcast_id}/patients")
async def log_patient(broadcast_id: str, request: PatientLog, user: dict = Depends(get_current_user)):
    """Paramedic logs a new patient at the scene."""
    invalidate_summary("broadcast_summary", broadcast_id)

    bc = supabase.table("broadcasts").select("id, status").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    if bc.data[0]["status"] != "active":
        raise HTTPException(status_code=400, detail="Broadcast is no longer active")

    valid_severities = {"critical", "high", "medium", "low", "deceased"}
    if request.severity not in valid_severities:
        raise HTTPException(status_code=400, detail=f"Invalid severity. Must be one of: {valid_severities}")

    tag = await _next_tag_number(broadcast_id)

    patient = supabase.table("broadcast_patients").insert({
        "broadcast_id": broadcast_id,
        "tag_number": tag,
        "severity": request.severity,
        "condition_notes": request.condition_notes,
        "requirements": request.requirements,
        "status": "unassigned",
    }).execute()

    print(f"   \U0001f3f7\ufe0f PATIENT LOGGED: {tag} — {request.severity} — {request.condition_notes[:40]}")

    return {
        "patient_id": patient.data[0]["id"],
        "tag_number": tag,
        "severity": request.severity,
        "status": "unassigned",
    }


# ---------------------------------------------------------------------------
# GET /api/broadcast/patients/{id} — single patient with hospital info
# ---------------------------------------------------------------------------

@router.get("/patients/{patient_id}")
async def get_patient(patient_id: str):
    """Get a single patient with hospital info — used by ambulance tracker."""
    pt = supabase.table("broadcast_patients").select("*").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = pt.data[0]
    hospital = None

    if patient.get("assigned_hospital_id"):
        hosp = (
            supabase.table("hospitals")
            .select("id, name, slug, address, location")
            .eq("id", patient["assigned_hospital_id"])
            .execute()
        )
        if hosp.data:
            h = hosp.data[0]
            from app.services.search_engine import _parse_location
            h_lat, h_lng = _parse_location(h.get("location"))
            hospital = {
                "id": h["id"],
                "name": h["name"],
                "address": h.get("address"),
                "lat": h_lat,
                "lng": h_lng,
            }

    return {"patient": patient, "hospital": hospital}


# ---------------------------------------------------------------------------
# POST /api/broadcast/patients/{id}/assign — assign patient to hospital
# ---------------------------------------------------------------------------

@router.post("/patients/{patient_id}/assign")
async def assign_patient(patient_id: str, request: PatientAssign, user: dict = Depends(get_current_user)):
    """Assign a patient to a hospital. Creates a handshake and notifies the hospital."""

    # Fetch patient
    pt = supabase.table("broadcast_patients").select("*").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient = pt.data[0]
    invalidate_summary("broadcast_summary", patient["broadcast_id"])

    if patient["status"] not in ("unassigned", "assigned"):
        raise HTTPException(status_code=400, detail=f"Patient is already {patient['status']}")

    # Fetch hospital
    hosp = supabase.table("hospitals").select("id, name, whatsapp_number, address").eq("id", request.hospital_id).execute()
    if not hosp.data:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital = hosp.data[0]

    # Create handshake
    from app.services.handshake_mgr import create_handshake
    bed_type = "emergency"
    reqs = patient.get("requirements", [])
    if "icu" in reqs:
        bed_type = "icu"
    elif "surgical" in reqs:
        bed_type = "surgical"
    elif "maternity" in reqs:
        bed_type = "maternity"
    elif "pediatric" in reqs:
        bed_type = "pediatric"

    handshake = await create_handshake(
        receiving_hospital_id=request.hospital_id,
        bed_type=bed_type,
        requesting_party_type="broadcast",
        requesting_party_phone="dispatch",
        patient_summary=f"{patient['tag_number']} — {patient['severity'].upper()} — {patient.get('condition_notes', '')}",
        parsed_requirements={"urgency": patient["severity"], "required_equipment": reqs},
        hold_duration_min=60,
    )

    # Update patient record
    supabase.table("broadcast_patients").update({
        "assigned_hospital_id": request.hospital_id,
        "assigned_ambulance_id": request.ambulance_id or None,
        "status": "assigned",
        "handshake_id": handshake["id"],
    }).eq("id", patient_id).execute()

    # Notify hospital
    wa_phone = hospital.get("whatsapp_number")
    if wa_phone:
        severity_emoji = {"critical": "\U0001f534", "high": "\U0001f7e0", "medium": "\U0001f7e1", "low": "\U0001f7e2"}.get(patient["severity"], "\u26aa")
        await send_text(wa_phone, (
            f"\U0001f691 *MCI Patient Incoming*\n\n"
            f"Tag: *{patient['tag_number']}*\n"
            f"Severity: {severity_emoji} *{patient['severity'].upper()}*\n"
            f"Condition: {patient.get('condition_notes', 'No details')}\n"
            f"Transfer code: *{handshake['transfer_code']}*\n\n"
            f"Prepare bed: {bed_type.upper()}"
        ))

    print(f"   \U0001f3e5 ASSIGNED: {patient['tag_number']} → {hospital['name']}")

    return {
        "patient_id": patient_id,
        "tag_number": patient["tag_number"],
        "assigned_to": hospital["name"],
        "handshake_id": handshake["id"],
        "transfer_code": handshake["transfer_code"],
        "bed_type": bed_type,
    }


# ---------------------------------------------------------------------------
# POST /api/broadcast/patients/{id}/dispatch — create a real transport request
# ---------------------------------------------------------------------------

@router.post("/patients/{patient_id}/dispatch")
async def dispatch_patient_transport(patient_id: str, user: dict = Depends(get_current_user)):
    """
    Turn an assigned broadcast patient into a real transport request.

    Uses the broadcast scene as the pickup location and stores the created
    transport request id back on the patient record.
    """
    pt = supabase.table("broadcast_patients").select("*").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = pt.data[0]
    invalidate_summary("broadcast_summary", patient["broadcast_id"])

    if not patient.get("assigned_hospital_id"):
        raise HTTPException(status_code=400, detail="Patient must be assigned to a hospital first")
    if not patient.get("handshake_id"):
        raise HTTPException(status_code=400, detail="Patient must have a handshake before transport can be created")

    if patient.get("transport_id"):
        existing = (
            supabase.table("transport_requests")
            .select("id, status, destination_hospital_id")
            .eq("id", patient["transport_id"])
            .execute()
        )
        if existing.data:
            return {
                "patient_id": patient_id,
                "transport_id": existing.data[0]["id"],
                "status": existing.data[0]["status"],
                "existing": True,
            }

    hs = (
        supabase.table("handshakes")
        .select("id, status, receiving_hospital_id")
        .eq("id", patient["handshake_id"])
        .execute()
    )
    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found")

    handshake = hs.data[0]
    if handshake.get("status") not in ("requested", "accepted"):
        raise HTTPException(status_code=400, detail=f"Handshake is not dispatchable (status: {handshake.get('status')})")
    if handshake.get("receiving_hospital_id") != patient.get("assigned_hospital_id"):
        raise HTTPException(status_code=409, detail="Assigned hospital and handshake destination do not match")

    bc = (
        supabase.table("broadcasts")
        .select("id, title, lat, lng")
        .eq("id", patient["broadcast_id"])
        .execute()
    )
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")

    broadcast = bc.data[0]

    transport = (
        supabase.table("transport_requests")
        .insert({
            "handshake_id": patient["handshake_id"],
            "patient_phone": "dispatch",
            "pickup_lat": broadcast.get("lat"),
            "pickup_lng": broadcast.get("lng"),
            "pickup_address": f"{broadcast.get('title', 'Incident scene')} scene",
            "destination_hospital_id": patient["assigned_hospital_id"],
            "severity": patient.get("severity", "medium"),
            "status": "asking_hospital",
        })
        .execute()
    )

    transport_row = transport.data[0]

    supabase.table("broadcast_patients").update({
        "transport_id": transport_row["id"],
        "transport_status": transport_row["status"],
    }).eq("id", patient_id).execute()

    print(f"   🚑 BROADCAST TRANSPORT CREATED: {patient.get('tag_number', patient_id[:8])} → {transport_row['id'][:8]}")

    flow_result = await start_transport_request_flow(transport_row, handshake)
    return {
        "patient_id": patient_id,
        "tag_number": patient.get("tag_number"),
        "transport_id": transport_row["id"],
        "status": flow_result["status"],
        "hospital": flow_result.get("hospital"),
        "pickup_address": transport_row.get("pickup_address"),
        "destination_hospital_id": transport_row.get("destination_hospital_id"),
        "existing": False,
    }


# ---------------------------------------------------------------------------
# POST /api/broadcast/{id}/auto-distribute — assign all unassigned
# ---------------------------------------------------------------------------

@router.post("/{broadcast_id}/auto-distribute")
async def auto_distribute(broadcast_id: str, request: AutoDistributePreview, user: dict = Depends(get_current_user)):
    """
    invalidate_summary("broadcast_summary", broadcast_id)
    Auto-assign all unassigned patients to responding hospitals.
    If confirm=false, returns a preview. If confirm=true, executes assignments.
    """

    # Fetch unassigned patients
    patients = (
        supabase.table("broadcast_patients")
        .select("*")
        .eq("broadcast_id", broadcast_id)
        .eq("status", "unassigned")
        .order("created_at")
        .execute()
    ).data

    if not patients:
        return {"assignments": [], "message": "No unassigned patients"}

    # Sort by severity (critical first)
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "deceased": 4}
    patients.sort(key=lambda p: severity_order.get(p["severity"], 3))

    # Fetch responding hospitals with capacity
    responses = (
        supabase.table("broadcast_responses")
        .select("*, hospitals(id, name, whatsapp_number, address, location)")
        .eq("broadcast_id", broadcast_id)
        .eq("status", "responded")
        .execute()
    ).data

    if not responses:
        return {"assignments": [], "message": "No hospitals have responded yet"}

    # Fetch broadcast location
    bc = supabase.table("broadcasts").select("lat, lng").eq("id", broadcast_id).execute()
    bc_lat, bc_lng = bc.data[0]["lat"], bc.data[0]["lng"]

    # Build hospital capacity tracker (mutable copy)
    hospital_pool = []
    for r in responses:
        h = r.get("hospitals", {})
        if not h:
            continue
        h_lat, h_lng = _parse_location(h.get("location"))
        dist = _haversine(bc_lat, bc_lng, h_lat, h_lng) if h_lat else 99
        hospital_pool.append({
            "hospital_id": h["id"],
            "name": h["name"],
            "distance": dist,
            "icu": r.get("icu_available", 0) or 0,
            "ward": r.get("ward_available", 0) or 0,
            "emergency": r.get("emergency_available", 0) or 0,
            "surgical": r.get("surgical_available", 0) or 0,
            "maternity": r.get("maternity_available", 0) or 0,
            "pediatric": r.get("pediatric_available", 0) or 0,
            "assigned_count": 0,
        })

    # Assignment algorithm
    assignments = []
    for patient in patients:
        reqs = patient.get("requirements", [])
        best_hospital = None
        best_score = -1

        # Determine needed bed type
        needed_bed = "emergency"
        if "icu" in reqs: needed_bed = "icu"
        elif "surgical" in reqs: needed_bed = "surgical"
        elif "maternity" in reqs: needed_bed = "maternity"
        elif "pediatric" in reqs: needed_bed = "pediatric"

        for hp in hospital_pool:
            # Check capacity for needed bed type
            capacity = hp.get(needed_bed, 0)
            if capacity <= 0:
                # Fallback to emergency or ward
                capacity = hp.get("emergency", 0) or hp.get("ward", 0)
                if capacity <= 0:
                    continue

            # Score: capacity (40%) + distance inverse (30%) + low assignment count (30%)
            cap_score = min(capacity / 10, 1.0) * 0.4
            dist_score = max(0, 1.0 - hp["distance"] / 20) * 0.3
            load_score = max(0, 1.0 - hp["assigned_count"] / 10) * 0.3
            score = cap_score + dist_score + load_score

            if score > best_score:
                best_score = score
                best_hospital = hp

        if best_hospital:
            assignments.append({
                "patient_id": patient["id"],
                "tag_number": patient["tag_number"],
                "severity": patient["severity"],
                "condition": patient.get("condition_notes", ""),
                "hospital_id": best_hospital["hospital_id"],
                "hospital_name": best_hospital["name"],
                "distance_km": round(best_hospital["distance"], 1),
                "bed_type": needed_bed,
            })
            # Decrement capacity for next assignment
            best_hospital[needed_bed] = max(0, best_hospital.get(needed_bed, 0) - 1)
            best_hospital["assigned_count"] += 1
        else:
            assignments.append({
                "patient_id": patient["id"],
                "tag_number": patient["tag_number"],
                "severity": patient["severity"],
                "condition": patient.get("condition_notes", ""),
                "hospital_id": None,
                "hospital_name": "No compatible hospital found",
                "distance_km": None,
                "bed_type": needed_bed,
            })

    # If not confirming, just return the preview
    if not request.confirm:
        assigned_count = sum(1 for a in assignments if a["hospital_id"])
        return {
            "preview": True,
            "assignments": assignments,
            "assigned_count": assigned_count,
            "unassignable_count": len(assignments) - assigned_count,
            "message": f"Preview: {assigned_count} of {len(assignments)} patients can be assigned. Send confirm=true to execute.",
        }

    # Execute assignments
    results = []
    for a in assignments:
        if not a["hospital_id"]:
            results.append({**a, "status": "failed", "reason": "No compatible hospital"})
            continue

        try:
            result = await assign_patient(a["patient_id"], PatientAssign(hospital_id=a["hospital_id"]))
            results.append({**a, "status": "assigned", "transfer_code": result.get("transfer_code")})
        except Exception as e:
            results.append({**a, "status": "failed", "reason": str(e)})

    assigned_count = sum(1 for r in results if r["status"] == "assigned")

    # Update broadcast response count
    supabase.table("broadcasts").update({
        "hospitals_responded": len(responses),
    }).eq("id", broadcast_id).execute()

    print(f"   \U0001f916 AUTO-DISTRIBUTE: {assigned_count}/{len(results)} patients assigned")

    return {
        "preview": False,
        "assignments": results,
        "assigned_count": assigned_count,
        "failed_count": len(results) - assigned_count,
    }


# ---------------------------------------------------------------------------
# PATCH /api/broadcast/patients/{id}/position — ambulance GPS update
# ---------------------------------------------------------------------------

@router.patch("/patients/{patient_id}/position")
async def update_ambulance_position(patient_id: str, request: PositionUpdate):
    """Update ambulance GPS position for a patient in transit."""
    now = datetime.now(timezone.utc).isoformat()

    pt = supabase.table("broadcast_patients").select("id").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    supabase.table("broadcast_patients").update({
        "ambulance_lat": request.lat,
        "ambulance_lng": request.lng,
        "ambulance_updated_at": now,
    }).eq("id", patient_id).execute()

    return {
        "patient_id": patient_id,
        "lat": request.lat,
        "lng": request.lng,
        "status": "position_updated",
    }
