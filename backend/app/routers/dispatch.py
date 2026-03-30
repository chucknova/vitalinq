"""
Dispatch API — private ambulance company management.

GET    /api/dispatch                                    — list all companies
GET    /api/dispatch/{slug}                             — company dashboard (ambulances + assignments)
POST   /api/dispatch/{slug}/ambulances                  — add an ambulance
PATCH  /api/dispatch/ambulances/{id}                    — update ambulance info/status
DELETE /api/dispatch/ambulances/{id}                    — remove an ambulance
POST   /api/dispatch/ambulances/{id}/assign             — assign ambulance to a patient
GET    /api/dispatch/assignments/{id}                   — get assignment with status history
POST   /api/dispatch/assignments/{id}/status            — crew updates status (the delivery tracker)
GET    /api/dispatch/assignments/{id}/track             — patient-facing: get status timeline
"""

from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase
from app.config import settings
from app.services.whatsapp import send_text

router = APIRouter(prefix="/dispatch", tags=["Dispatch"])


async def _send_text_background(phone: str, message: str):
    try:
        await send_text(phone, message)
    except Exception as exc:
        print(f"   ⚠️ Background send_text failed: {exc}")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AmbulanceCreate(BaseModel):
    vehicle_id: str
    plate_number: str = ""
    type: str = Field(default="BLS", description="BLS, ALS, or motorcycle")
    crew_name: str = ""
    crew_phone: str = ""

class AmbulanceUpdate(BaseModel):
    status: Optional[str] = None
    crew_name: Optional[str] = None
    crew_phone: Optional[str] = None
    plate_number: Optional[str] = None
    note: Optional[str] = None

class AssignAmbulance(BaseModel):
    broadcast_patient_id: Optional[str] = None
    handshake_id: Optional[str] = None
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    pickup_address: str = ""
    destination_hospital_id: Optional[str] = None

class StatusUpdate(BaseModel):
    status: str = Field(description="dispatched, en_route_to_patient, at_scene, en_route_to_hospital, delivered, cancelled")
    note: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_company_by_slug(slug: str) -> dict:
    result = supabase.table("dispatch_companies").select("*").eq("slug", slug).eq("is_active", True).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dispatch company not found")
    return result.data[0]


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


VALID_AMBULANCE_STATUSES = {"available", "dispatched", "en_route_to_patient", "at_scene", "en_route_to_hospital", "offline", "maintenance"}
VALID_ASSIGNMENT_STATUSES = {"assigned", "dispatched", "en_route_to_patient", "at_scene", "en_route_to_hospital", "delivered", "cancelled"}


def _broadcast_status_from_assignment(status: str) -> str | None:
    mapping = {
        "assigned": "assigned",
        "dispatched": "dispatched",
        "en_route_to_patient": "en_route_to_patient",
        "at_scene": "at_scene",
        "en_route_to_hospital": "en_route_to_hospital",
        "delivered": "delivered",
    }
    return mapping.get(status)


# ---------------------------------------------------------------------------
# GET /api/dispatch — list all companies
# ---------------------------------------------------------------------------

@router.get("")
async def list_companies():
    result = supabase.table("dispatch_companies").select("*").eq("is_active", True).order("name").execute()
    return {"companies": result.data or []}


# ---------------------------------------------------------------------------
# GET /api/dispatch/{slug} — company dashboard
# ---------------------------------------------------------------------------

@router.get("/{slug}")
async def get_company_dashboard(slug: str):
    company = get_company_by_slug(slug)

    # All ambulances
    ambulances = (
        supabase.table("ambulances")
        .select("*")
        .eq("company_id", company["id"])
        .order("vehicle_id")
        .execute()
    ).data or []

    # Active assignments for this company's ambulances
    amb_ids = [a["id"] for a in ambulances]
    assignments = []
    if amb_ids:
        all_assignments = (
            supabase.table("ambulance_assignments")
            .select("*")
            .in_("ambulance_id", amb_ids)
            .order("assigned_at", desc=True)
            .execute()
        ).data or []

        hospital_ids = list({a["destination_hospital_id"] for a in all_assignments if a.get("destination_hospital_id")})
        patient_ids = list({a["broadcast_patient_id"] for a in all_assignments if a.get("broadcast_patient_id")})
        handshake_ids = list({a["handshake_id"] for a in all_assignments if a.get("handshake_id")})
        assignment_ids = [a["id"] for a in all_assignments if a.get("id")]

        hospital_map = {}
        if hospital_ids:
            hospitals = (
                supabase.table("hospitals")
                .select("id, name, slug, address")
                .in_("id", hospital_ids)
                .execute()
            ).data or []
            hospital_map = _rows_by_id(hospitals)

        patient_map = {}
        if patient_ids:
            patients = (
                supabase.table("broadcast_patients")
                .select("id, tag_number, severity, condition_notes")
                .in_("id", patient_ids)
                .execute()
            ).data or []
            patient_map = _rows_by_id(patients)

        handshake_map = {}
        if handshake_ids:
            handshakes = (
                supabase.table("handshakes")
                .select("id, transfer_code")
                .in_("id", handshake_ids)
                .execute()
            ).data or []
            handshake_map = _rows_by_id(handshakes)

        timeline_map = {}
        if assignment_ids:
            updates = (
                supabase.table("ambulance_status_updates")
                .select("assignment_id, status, note, created_at")
                .in_("assignment_id", assignment_ids)
                .order("created_at")
                .execute()
            ).data or []
            timeline_map = _group_updates_by_assignment(updates)

        ambulance_map = _rows_by_id(ambulances)

        for a in all_assignments:
            a["_hospital"] = hospital_map.get(a.get("destination_hospital_id"))
            a["_patient"] = patient_map.get(a.get("broadcast_patient_id"))

            amb = ambulance_map.get(a.get("ambulance_id"))
            a["_ambulance"] = {"vehicle_id": amb["vehicle_id"], "plate_number": amb["plate_number"]} if amb else None

            handshake = handshake_map.get(a.get("handshake_id"))
            a["_transfer_code"] = handshake.get("transfer_code") if handshake else None
            a["_timeline"] = timeline_map.get(a.get("id"), [])

        assignments = all_assignments

    # Stats
    stats = {
        "total": len(ambulances),
        "available": sum(1 for a in ambulances if a["status"] == "available"),
        "dispatched": sum(1 for a in ambulances if a["status"] in ("dispatched", "en_route_to_patient", "at_scene", "en_route_to_hospital")),
        "offline": sum(1 for a in ambulances if a["status"] in ("offline", "maintenance")),
        "active_assignments": sum(1 for a in assignments if a["status"] not in ("delivered", "cancelled")),
    }

    return {
        "company": company,
        "ambulances": ambulances,
        "assignments": assignments,
        "stats": stats,
    }


# ---------------------------------------------------------------------------
# POST /api/dispatch/{slug}/ambulances — add an ambulance
# ---------------------------------------------------------------------------

@router.post("/{slug}/ambulances")
async def add_ambulance(slug: str, request: AmbulanceCreate):
    company = get_company_by_slug(slug)

    result = supabase.table("ambulances").insert({
        "company_id": company["id"],
        "vehicle_id": request.vehicle_id,
        "plate_number": request.plate_number,
        "type": request.type,
        "status": "available",
        "crew_name": request.crew_name,
        "crew_phone": request.crew_phone,
    }).execute()

    return result.data[0]


# ---------------------------------------------------------------------------
# PATCH /api/dispatch/ambulances/{id} — update ambulance
# ---------------------------------------------------------------------------

@router.patch("/ambulances/{ambulance_id}")
async def update_ambulance(ambulance_id: str, request: AmbulanceUpdate):
    amb = supabase.table("ambulances").select("id").eq("id", ambulance_id).execute()
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if request.status is not None:
        if request.status not in VALID_AMBULANCE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {VALID_AMBULANCE_STATUSES}")
        update["status"] = request.status
    if request.crew_name is not None:
        update["crew_name"] = request.crew_name
    if request.crew_phone is not None:
        update["crew_phone"] = request.crew_phone
    if request.plate_number is not None:
        update["plate_number"] = request.plate_number
    if request.note is not None:
        update["note"] = request.note

    result = supabase.table("ambulances").update(update).eq("id", ambulance_id).execute()
    return result.data[0]


# ---------------------------------------------------------------------------
# DELETE /api/dispatch/ambulances/{id}
# ---------------------------------------------------------------------------

@router.delete("/ambulances/{ambulance_id}")
async def delete_ambulance(ambulance_id: str):
    amb = supabase.table("ambulances").select("id").eq("id", ambulance_id).execute()
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    supabase.table("ambulances").delete().eq("id", ambulance_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# POST /api/dispatch/ambulances/{id}/assign — assign to a patient
# ---------------------------------------------------------------------------

@router.post("/ambulances/{ambulance_id}/assign")
async def assign_ambulance(ambulance_id: str, request: AssignAmbulance):
    amb = supabase.table("ambulances").select("*").eq("id", ambulance_id).execute()
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    ambulance = amb.data[0]
    if ambulance["status"] != "available":
        raise HTTPException(status_code=400, detail=f"Ambulance is not available (current status: {ambulance['status']})")

    now = datetime.now(timezone.utc).isoformat()

    # Create assignment
    assignment = supabase.table("ambulance_assignments").insert({
        "ambulance_id": ambulance_id,
        "broadcast_patient_id": request.broadcast_patient_id,
        "handshake_id": request.handshake_id,
        "pickup_lat": request.pickup_lat,
        "pickup_lng": request.pickup_lng,
        "pickup_address": request.pickup_address,
        "destination_hospital_id": request.destination_hospital_id,
        "status": "assigned",
        "assigned_at": now,
    }).execute()

    # Update ambulance status
    supabase.table("ambulances").update({
        "status": "dispatched",
        "updated_at": now,
    }).eq("id", ambulance_id).execute()

    # Log initial status update
    supabase.table("ambulance_status_updates").insert({
        "assignment_id": assignment.data[0]["id"],
        "status": "assigned",
        "note": f"Assigned to pickup at {request.pickup_address or 'location provided'}",
    }).execute()

    # Notify crew via WhatsApp if they have a phone
    if ambulance.get("crew_phone"):
        hospital_name = ""
        if request.destination_hospital_id:
            h = supabase.table("hospitals").select("name").eq("id", request.destination_hospital_id).execute()
            hospital_name = h.data[0]["name"] if h.data else ""

        await send_text(ambulance["crew_phone"], (
            f"🚑 *New Assignment — {ambulance['vehicle_id']}*\n\n"
            f"Pickup: {request.pickup_address or 'See dispatcher for location'}\n"
            f"Destination: {hospital_name or 'TBD'}\n\n"
            f"Update your status at:\n"
            f"{settings.FRONTEND_URL}/ambulance/{ambulance_id}/crew"
        ))

    return {
        "assignment_id": assignment.data[0]["id"],
        "ambulance": ambulance["vehicle_id"],
        "status": "assigned",
    }


# ---------------------------------------------------------------------------
# GET /api/dispatch/assignments/{id} — full assignment detail
# ---------------------------------------------------------------------------

@router.get("/assignments/{assignment_id}")
async def get_assignment(assignment_id: str):
    a = supabase.table("ambulance_assignments").select("*").eq("id", assignment_id).execute()
    if not a.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment = a.data[0]

    # Status timeline
    updates = (
        supabase.table("ambulance_status_updates")
        .select("*")
        .eq("assignment_id", assignment_id)
        .order("created_at")
        .execute()
    ).data or []

    # Ambulance info
    amb = supabase.table("ambulances").select("vehicle_id, plate_number, type, crew_name, crew_phone").eq("id", assignment["ambulance_id"]).execute()
    assignment["_ambulance"] = amb.data[0] if amb.data else None

    # Hospital info
    if assignment.get("destination_hospital_id"):
        h = supabase.table("hospitals").select("id, name, address").eq("id", assignment["destination_hospital_id"]).execute()
        assignment["_hospital"] = h.data[0] if h.data else None

    # Patient info
    if assignment.get("broadcast_patient_id"):
        p = supabase.table("broadcast_patients").select("tag_number, severity, condition_notes").eq("id", assignment["broadcast_patient_id"]).execute()
        assignment["_patient"] = p.data[0] if p.data else None

    return {
        "assignment": assignment,
        "status_updates": updates,
    }


# ---------------------------------------------------------------------------
# POST /api/dispatch/assignments/{id}/status — crew updates status
# ---------------------------------------------------------------------------

@router.post("/assignments/{assignment_id}/status")
async def update_assignment_status(assignment_id: str, request: StatusUpdate, background_tasks: BackgroundTasks):
    a = supabase.table("ambulance_assignments").select("*, ambulances(id, vehicle_id, crew_phone)").eq("id", assignment_id).execute()
    if not a.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment = a.data[0]

    if request.status not in VALID_ASSIGNMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {VALID_ASSIGNMENT_STATUSES}")

    now = datetime.now(timezone.utc).isoformat()

    # Update assignment status
    update_data = {"status": request.status}
    if request.status == "at_scene":
        update_data["picked_up_at"] = now
    elif request.status == "delivered":
        update_data["delivered_at"] = now

    supabase.table("ambulance_assignments").update(update_data).eq("id", assignment_id).execute()

    # Log the status update
    supabase.table("ambulance_status_updates").insert({
        "assignment_id": assignment_id,
        "status": request.status,
        "note": request.note or None,
    }).execute()

    # Update ambulance status to match
    ambulance_id = assignment["ambulance_id"]
    amb_status = request.status
    if request.status in ("delivered", "cancelled"):
        amb_status = "available"  # Free up the ambulance

    supabase.table("ambulances").update({
        "status": amb_status,
        "updated_at": now,
    }).eq("id", ambulance_id).execute()

    if assignment.get("broadcast_patient_id"):
        update_patient = {}
        broadcast_status = _broadcast_status_from_assignment(request.status)
        if broadcast_status:
            update_patient["status"] = broadcast_status
        update_patient["transport_status"] = request.status
        supabase.table("broadcast_patients").update(update_patient).eq("id", assignment["broadcast_patient_id"]).execute()

    # Notify patient via WhatsApp for key milestones
    patient_phone = None
    if assignment.get("handshake_id"):
        hs = supabase.table("handshakes").select("requesting_party_phone").eq("id", assignment["handshake_id"]).execute()
        if hs.data:
            patient_phone = hs.data[0].get("requesting_party_phone")

    STATUS_MESSAGES = {
        "dispatched": "🚑 An ambulance has been dispatched to pick you up.",
        "en_route_to_patient": "🚑 Your ambulance is on the way to you.",
        "at_scene": "🚑 The ambulance has arrived at your location.",
        "en_route_to_hospital": "🏥 You're on your way to the hospital.",
        "delivered": "✅ You've arrived at the hospital. Wishing a speedy recovery.",
    }

    if patient_phone and request.status in STATUS_MESSAGES:
        ambulance_info = assignment.get("ambulances", {})
        vehicle = ambulance_info.get("vehicle_id", "")
        msg = STATUS_MESSAGES[request.status]
        if vehicle:
            msg = f"{msg}\nAmbulance: *{vehicle}*"
        background_tasks.add_task(_send_text_background, patient_phone, msg)

    print(f"   🚑 STATUS UPDATE: {assignment_id[:8]} → {request.status}")

    return {"status": request.status, "assignment_id": assignment_id}


# ---------------------------------------------------------------------------
# GET /api/dispatch/assignments/{id}/track — patient-facing timeline
# ---------------------------------------------------------------------------

@router.get("/assignments/{assignment_id}/track")
async def track_assignment(assignment_id: str):
    """Patient-facing endpoint — returns the status timeline for tracking."""
    a = supabase.table("ambulance_assignments").select("*").eq("id", assignment_id).execute()
    if not a.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment = a.data[0]

    # Status updates
    updates = (
        supabase.table("ambulance_status_updates")
        .select("status, note, created_at")
        .eq("assignment_id", assignment_id)
        .order("created_at")
        .execute()
    ).data or []

    # Ambulance info (limited — don't expose crew phone to patients)
    amb = supabase.table("ambulances").select("vehicle_id, plate_number, type").eq("id", assignment["ambulance_id"]).execute()

    # Hospital info
    hospital = None
    if assignment.get("destination_hospital_id"):
        h = supabase.table("hospitals").select("name, address").eq("id", assignment["destination_hospital_id"]).execute()
        hospital = h.data[0] if h.data else None

    return {
        "assignment_id": assignment_id,
        "status": assignment["status"],
        "ambulance": amb.data[0] if amb.data else None,
        "hospital": hospital,
        "pickup_address": assignment.get("pickup_address"),
        "timeline": updates,
    }


# ---------------------------------------------------------------------------
# GET /api/dispatch/ambulances/{id}/active — crew page: get active assignment
# ---------------------------------------------------------------------------

@router.get("/ambulances/{ambulance_id}/active")
async def get_active_assignment(ambulance_id: str):
    """Returns the ambulance info + its current active assignment + timeline."""
    amb = supabase.table("ambulances").select("*").eq("id", ambulance_id).execute()
    if not amb.data:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    ambulance = amb.data[0]

    # Find active assignment (not delivered or cancelled)
    all_assignments = (
        supabase.table("ambulance_assignments")
        .select("*")
        .eq("ambulance_id", ambulance_id)
        .order("assigned_at", desc=True)
        .execute()
    ).data or []

    # Filter out completed ones in Python
    active = [a for a in all_assignments if a["status"] not in ("delivered", "cancelled")]

    if not active:
        return {"ambulance": ambulance, "assignment": None, "timeline": []}

    assignment = active[0]

    # Enrich
    if assignment.get("destination_hospital_id"):
        h = supabase.table("hospitals").select("id, name, address").eq("id", assignment["destination_hospital_id"]).execute()
        assignment["_hospital"] = h.data[0] if h.data else None

    if assignment.get("broadcast_patient_id"):
        p = supabase.table("broadcast_patients").select("tag_number, severity, condition_notes").eq("id", assignment["broadcast_patient_id"]).execute()
        assignment["_patient"] = p.data[0] if p.data else None

    # Get transfer code from handshake
    if assignment.get("handshake_id"):
        hs = supabase.table("handshakes").select("transfer_code").eq("id", assignment["handshake_id"]).execute()
        assignment["_transfer_code"] = hs.data[0].get("transfer_code") if hs.data else None

    # Timeline
    updates = (
        supabase.table("ambulance_status_updates")
        .select("status, note, created_at")
        .eq("assignment_id", assignment["id"])
        .order("created_at")
        .execute()
    ).data or []

    # Detect reroute
    reroute_entry = next((u for u in updates if u["status"] == "rerouted"), None)

    return {
        "ambulance": ambulance,
        "assignment": assignment,
        "timeline": updates,
        "rerouted": reroute_entry is not None,
        "reroute_note": reroute_entry["note"] if reroute_entry else None,
    }