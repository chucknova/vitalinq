"""
Emergency Broadcast API — mass casualty incident coordination.

POST   /api/broadcast                              — trigger a broadcast
GET    /api/broadcast/{id}                         — full dashboard data
PATCH  /api/broadcast/{id}                         — update status (resolve/cancel)
POST   /api/broadcast/{id}/patients                — log a patient (paramedic)
POST   /api/broadcast/patients/{id}/assign         — assign patient to hospital
POST   /api/broadcast/{id}/auto-distribute         — auto-assign all unassigned
PATCH  /api/broadcast/patients/{id}/position       — update ambulance GPS
POST   /api/broadcast/patients/{id}/simulate-route — start simulated ambulance movement
"""

import math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase
from app.services.whatsapp import send_text, send_buttons
from app.services.search_engine import _parse_location

router = APIRouter(prefix="/broadcast", tags=["Emergency Broadcast"])


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


def _next_tag_number(broadcast_id: str) -> str:
    """Generate the next MCI tag number for a broadcast."""
    count = (
        supabase.table("broadcast_patients")
        .select("id", count="exact")
        .eq("broadcast_id", broadcast_id)
        .execute()
    )
    num = (count.count or 0) + 1
    return f"MCI-{num:03d}"


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
async def create_broadcast(request: BroadcastCreate):
    """
    Create an emergency broadcast.
    Finds all hospitals in radius and sends WhatsApp notification to each.
    """
    now = datetime.now(timezone.utc)

    # Find hospitals in radius
    hospitals = (
        supabase.table("hospitals")
        .select("id, name, whatsapp_number, location, hospital_type")
        .eq("is_active", True)
        .execute()
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
    broadcast = supabase.table("broadcasts").insert({
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
    }).execute()

    broadcast_id = broadcast.data[0]["id"]

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
async def list_broadcasts():
    """List all broadcasts, active first, then by most recent."""
    result = (
        supabase.table("broadcasts")
        .select("*")
        .order("status", desc=False)
        .order("created_at", desc=True)
        .execute()
    )
    return {"broadcasts": result.data or []}


# ---------------------------------------------------------------------------
# GET /api/broadcast/{id} — full dashboard data
# ---------------------------------------------------------------------------

@router.get("/{broadcast_id}")
async def get_broadcast(broadcast_id: str):
    """Returns everything the broadcast dashboard needs."""

    # Broadcast record
    bc = supabase.table("broadcasts").select("*").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    broadcast = bc.data[0]

    # Responses
    responses = (
        supabase.table("broadcast_responses")
        .select("*, hospitals(id, name, slug, address, location, hospital_type)")
        .eq("broadcast_id", broadcast_id)
        .order("responded_at", desc=True)
        .execute()
    ).data

    # Parse hospital locations for responses
    for r in responses:
        h = r.get("hospitals", {})
        if h and h.get("location"):
            lat, lng = _parse_location(h["location"])
            r["_hospital_lat"] = lat
            r["_hospital_lng"] = lng
            r["_distance"] = round(_haversine(broadcast["lat"], broadcast["lng"], lat, lng), 1) if lat else None

    # Patients
    patients = (
        supabase.table("broadcast_patients")
        .select("*")
        .eq("broadcast_id", broadcast_id)
        .order("created_at", desc=False)
        .execute()
    ).data

    # Batch-fetch all assigned hospitals
    hospital_ids = list(set(p["assigned_hospital_id"] for p in patients if p.get("assigned_hospital_id")))
    hospitals_map = {}
    if hospital_ids:
        all_h = supabase.table("hospitals").select("id, name, slug, address").in_("id", hospital_ids).execute()
        hospitals_map = {h["id"]: h for h in (all_h.data or [])}

    # Batch-fetch all handshakes
    handshake_ids = list(set(p["handshake_id"] for p in patients if p.get("handshake_id")))
    handshakes_map = {}
    if handshake_ids:
        all_hs = supabase.table("handshakes").select("id, status, transfer_code, accepted_at, completed_at, declined_reason, expires_at").in_("id", handshake_ids).execute()
        handshakes_map = {h["id"]: h for h in (all_hs.data or [])}

    # Enrich patients
    for p in patients:
        p["hospitals"] = hospitals_map.get(p.get("assigned_hospital_id"))

        hs = handshakes_map.get(p.get("handshake_id"))
        if hs:
            p["_handshake_status"] = hs.get("status")
            p["_transfer_code"] = hs.get("transfer_code")
            p["_declined_reason"] = hs.get("declined_reason")
            if hs.get("status") == "accepted" and hs.get("expires_at"):
                expires_str = hs["expires_at"]
                if isinstance(expires_str, str):
                    expires_dt = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
                    remaining = (expires_dt - datetime.now(timezone.utc)).total_seconds()
                    p["_hold_remaining_sec"] = max(0, int(remaining))
        else:
            p["_handshake_status"] = None
            p["_transfer_code"] = None

    # Aggregate capacity
    total_capacity = {
        "icu": 0, "ward": 0, "emergency": 0,
        "surgical": 0, "maternity": 0, "pediatric": 0,
    }
    for r in responses:
        if r.get("status") == "responded":
            total_capacity["icu"] += r.get("icu_available", 0) or 0
            total_capacity["ward"] += r.get("ward_available", 0) or 0
            total_capacity["emergency"] += r.get("emergency_available", 0) or 0
            total_capacity["surgical"] += r.get("surgical_available", 0) or 0
            total_capacity["maternity"] += r.get("maternity_available", 0) or 0
            total_capacity["pediatric"] += r.get("pediatric_available", 0) or 0

    # Patient stats
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "deceased": 0}
    status_counts = {"unassigned": 0, "assigned": 0, "en_route": 0, "arrived": 0, "admitted": 0}
    for p in patients:
        sev = p.get("severity", "medium")
        if sev in severity_counts:
            severity_counts[sev] += 1
        st = p.get("status", "unassigned")
        if st in status_counts:
            status_counts[st] += 1

    return {
        "broadcast": broadcast,
        "responses": responses,
        "patients": patients,
        "total_capacity": total_capacity,
        "patient_stats": {
            "total": len(patients),
            "by_severity": severity_counts,
            "by_status": status_counts,
        },
    }


# ---------------------------------------------------------------------------
# PATCH /api/broadcast/{id} — resolve/cancel
# ---------------------------------------------------------------------------

@router.patch("/{broadcast_id}")
async def update_broadcast(broadcast_id: str, request: BroadcastUpdate):
    """Update broadcast status (resolve or cancel)."""
    now = datetime.now(timezone.utc).isoformat()

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
async def delete_broadcast(broadcast_id: str):
    """Delete a broadcast and all related data (responses + patients)."""
    bc = supabase.table("broadcasts").select("id").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")

    # CASCADE handles responses and patients (FK with ON DELETE CASCADE)
    supabase.table("broadcasts").delete().eq("id", broadcast_id).execute()

    return {"deleted": True, "broadcast_id": broadcast_id}


# ---------------------------------------------------------------------------
# POST /api/broadcast/{id}/patients — log a patient
# ---------------------------------------------------------------------------

@router.post("/{broadcast_id}/patients")
async def log_patient(broadcast_id: str, request: PatientLog):
    """Paramedic logs a new patient at the scene."""

    bc = supabase.table("broadcasts").select("id, status").eq("id", broadcast_id).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    if bc.data[0]["status"] != "active":
        raise HTTPException(status_code=400, detail="Broadcast is no longer active")

    valid_severities = {"critical", "high", "medium", "low", "deceased"}
    if request.severity not in valid_severities:
        raise HTTPException(status_code=400, detail=f"Invalid severity. Must be one of: {valid_severities}")

    tag = _next_tag_number(broadcast_id)

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
async def assign_patient(patient_id: str, request: PatientAssign):
    """Assign a patient to a hospital. Creates a handshake and notifies the hospital."""

    # Fetch patient
    pt = supabase.table("broadcast_patients").select("*").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient = pt.data[0]

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
# POST /api/broadcast/{id}/auto-distribute — assign all unassigned
# ---------------------------------------------------------------------------

@router.post("/{broadcast_id}/auto-distribute")
async def auto_distribute(broadcast_id: str, request: AutoDistributePreview):
    """
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

    pt = supabase.table("broadcast_patients").select("id, status, assigned_hospital_id").eq("id", patient_id).execute()
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = pt.data[0]

    # Auto-detect arrival (within 200m of hospital)
    arrived = False
    if patient.get("assigned_hospital_id"):
        hosp = supabase.table("hospitals").select("location").eq("id", patient["assigned_hospital_id"]).execute()
        if hosp.data:
            h_lat, h_lng = _parse_location(hosp.data[0].get("location"))
            if h_lat:
                dist = _haversine(request.lat, request.lng, h_lat, h_lng)
                if dist < 0.2:  # Within 200 meters
                    arrived = True

    update_data = {
        "ambulance_lat": request.lat,
        "ambulance_lng": request.lng,
        "ambulance_updated_at": now,
    }

    if arrived:
        update_data["status"] = "arrived"

    # Update status to en_route if still assigned
    if patient["status"] == "assigned" and not arrived:
        update_data["status"] = "en_route"

    supabase.table("broadcast_patients").update(update_data).eq("id", patient_id).execute()

    return {
        "patient_id": patient_id,
        "lat": request.lat,
        "lng": request.lng,
        "arrived": arrived,
        "status": update_data.get("status", patient["status"]),
    }


# ---------------------------------------------------------------------------
# POST /api/broadcast/patients/{id}/simulate-route — demo simulation
# ---------------------------------------------------------------------------

@router.post("/patients/{patient_id}/simulate-route")
async def simulate_ambulance_route(patient_id: str):
    """
    Start a simulated ambulance route for demo purposes.
    Generates waypoints along the driving route and stores them.
    A background process will move the ambulance along these waypoints.
    """
    import os

    pt = (
        supabase.table("broadcast_patients")
        .select("*")
        .eq("id", patient_id)
        .execute()
    )
    if not pt.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = pt.data[0]
    if not patient.get("assigned_hospital_id"):
        raise HTTPException(status_code=400, detail="Patient not assigned to a hospital yet")

    # Get hospital location
    hosp = supabase.table("hospitals").select("name, location").eq("id", patient["assigned_hospital_id"]).execute()
    if not hosp.data:
        raise HTTPException(status_code=404, detail="Assigned hospital not found")

    h_lat, h_lng = _parse_location(hosp.data[0].get("location"))

    # Get broadcast location
    bc = supabase.table("broadcasts").select("lat, lng").eq("id", patient["broadcast_id"]).execute()
    if not bc.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    from_lat, from_lng = bc.data[0]["lat"], bc.data[0]["lng"]

    if not all([h_lat, h_lng, from_lat, from_lng]):
        raise HTTPException(status_code=400, detail="Missing location data")

    # Fetch route from Mapbox — try multiple token sources
    from app.config import settings
    token = (
        getattr(settings, "MAPBOX_TOKEN", "")
        or getattr(settings, "VITE_MAPBOX_TOKEN", "")
        or os.environ.get("MAPBOX_TOKEN", "")
        or os.environ.get("VITE_MAPBOX_TOKEN", "")
    )

    if not token:
        raise HTTPException(status_code=500, detail="Mapbox token not configured. Add MAPBOX_TOKEN to your .env")

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.mapbox.com/directions/v5/mapbox/driving/"
            f"{from_lng},{from_lat};{h_lng},{h_lat}"
            f"?geometries=geojson&overview=full&access_token={token}",
            timeout=15,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch route from Mapbox")

    data = resp.json()
    if not data.get("routes"):
        raise HTTPException(status_code=404, detail="No route found")

    route = data["routes"][0]
    coords = route["geometry"]["coordinates"]  # [[lng, lat], ...]
    duration_sec = route["duration"]
    distance_m = route["distance"]

    # Sample ~20 waypoints evenly along the route
    total_points = len(coords)
    sample_count = min(20, total_points)
    step = max(1, total_points // sample_count)
    waypoints = [{"lat": c[1], "lng": c[0]} for c in coords[::step]]
    # Ensure the last point is the destination
    waypoints.append({"lat": h_lat, "lng": h_lng})

    # Store waypoints in patient record for the background simulator
    supabase.table("broadcast_patients").update({
        "status": "en_route",
        "eta_minutes": round(duration_sec / 60),
        "ambulance_lat": from_lat,
        "ambulance_lng": from_lng,
        "ambulance_updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", patient_id).execute()

    print(f"   \U0001f697 SIMULATE: {patient['tag_number']} — {len(waypoints)} waypoints, {round(duration_sec/60)} min, {round(distance_m/1000, 1)} km")

    return {
        "patient_id": patient_id,
        "tag_number": patient["tag_number"],
        "waypoints": waypoints,
        "duration_minutes": round(duration_sec / 60),
        "distance_km": round(distance_m / 1000, 1),
        "destination": hosp.data[0]["name"],
        "message": "Simulation ready. Call PATCH /position with each waypoint every 5 seconds.",
    }