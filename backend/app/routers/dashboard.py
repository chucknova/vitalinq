"""
Hospital Dashboard API — everything the web dashboard needs.

GET  /api/hospitals/dashboard/{slug}                          — full dashboard data
POST /api/hospitals/dashboard/{slug}/beds                     — update beds (full)
POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/increment — +1 bed
POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/decrement — -1 bed
POST /api/hospitals/dashboard/{slug}/accept/{handshake_id}    — accept handshake from web
POST /api/hospitals/dashboard/{slug}/decline/{handshake_id}   — decline with reason from web
"""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import supabase
from app.services.search_engine import extract_equipment, _parse_location
from app.services.handshake_mgr import accept_handshake, decline_handshake
from app.services.transport_reroute import reroute_transport_request
from app.services.whatsapp import send_text, send_buttons

router = APIRouter(prefix="/hospitals/dashboard", tags=["Hospital Dashboard"])


# ---------------------------------------------------------------------------
# Helper: resolve slug to hospital
# ---------------------------------------------------------------------------

def get_hospital_by_slug(slug: str) -> dict:
    result = (
        supabase.table("hospitals")
        .select("*")
        .eq("slug", slug)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return result.data[0]


# ---------------------------------------------------------------------------
# GET /api/hospitals/dashboard/{slug}
# ---------------------------------------------------------------------------

@router.get("/{slug}")
async def get_dashboard(slug: str):
    """
    Returns everything the hospital dashboard needs in one call:
    hospital info, all beds, active handshakes, and stats.
    """
    hospital = get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    now = datetime.now(timezone.utc)

    # ── Beds ──────────────────────────────────────────
    beds = (
        supabase.table("hospital_beds")
        .select("*")
        .eq("hospital_id", hospital_id)
        .execute()
    ).data

    # ── Active handshakes (requested + accepted) ─────
    active_handshakes = (
        supabase.table("handshakes")
        .select("*")
        .eq("receiving_hospital_id", hospital_id)
        .in_("status", ["requested", "accepted"])
        .order("created_at", desc=True)
        .execute()
    ).data

    # Compute time_remaining for accepted handshakes
    for hs in active_handshakes:
        if hs["status"] == "accepted" and hs.get("expires_at"):
            expires = hs["expires_at"]
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            remaining = (expires - now).total_seconds()
            hs["time_remaining_sec"] = max(0, int(remaining))
        else:
            hs["time_remaining_sec"] = None

    # ── Recent handshakes (last 24h, all statuses) ───
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    recent_handshakes = (
        supabase.table("handshakes")
        .select("id, status, created_at")
        .eq("receiving_hospital_id", hospital_id)
        .gt("created_at", cutoff_24h)
        .execute()
    ).data

    # ── Stats ─────────────────────────────────────────

    # Patients routed in last 7 days
    cutoff_7d = (now - timedelta(days=7)).isoformat()
    routed_7d = (
        supabase.table("handshakes")
        .select("id", count="exact")
        .eq("receiving_hospital_id", hospital_id)
        .gt("created_at", cutoff_7d)
        .execute()
    )

    # Patients admitted (completed) in last 7 days
    admitted_7d = (
        supabase.table("handshakes")
        .select("id", count="exact")
        .eq("receiving_hospital_id", hospital_id)
        .eq("status", "completed")
        .gt("created_at", cutoff_7d)
        .execute()
    )

    # Verification signals in last 30 days
    cutoff_30d = (now - timedelta(days=30)).isoformat()
    signals = (
        supabase.table("verification_signals")
        .select("signal_value")
        .eq("hospital_id", hospital_id)
        .gt("created_at", cutoff_30d)
        .execute()
    ).data

    positive_signals = sum(1 for s in signals if s["signal_value"] == "positive")
    total_signals = len(signals)

    # Freshness
    last_report = hospital.get("last_report_at")
    if last_report:
        if isinstance(last_report, str):
            last_report_dt = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
        else:
            last_report_dt = last_report
        hours_since = (now - last_report_dt).total_seconds() / 3600
    else:
        hours_since = None

    # Parse location
    lat, lng = _parse_location(hospital.get("location"))

    stats = {
        "accuracy_score": hospital.get("accuracy_score", 0.5),
        "trust_tier": hospital.get("trust_tier", "active"),
        "freshness_score": hospital.get("freshness_score", 0.0),
        "hours_since_last_report": round(hours_since, 1) if hours_since is not None else None,
        "patients_routed_7d": routed_7d.count or 0,
        "patients_admitted_7d": admitted_7d.count or 0,
        "positive_signals_30d": positive_signals,
        "total_signals_30d": total_signals,
        "handshakes_today": len(recent_handshakes),
        "handshakes_today_by_status": {
            "requested": sum(1 for h in recent_handshakes if h["status"] == "requested"),
            "accepted": sum(1 for h in recent_handshakes if h["status"] == "accepted"),
            "completed": sum(1 for h in recent_handshakes if h["status"] == "completed"),
            "declined": sum(1 for h in recent_handshakes if h["status"] == "declined"),
            "expired": sum(1 for h in recent_handshakes if h["status"] == "expired"),
        },
    }

    return {
        "hospital": {
            "id": hospital["id"],
            "name": hospital["name"],
            "slug": hospital["slug"],
            "address": hospital["address"],
            "lga": hospital.get("lga"),
            "hospital_type": hospital.get("hospital_type"),
            "phone": hospital.get("phone"),
            "whatsapp_number": hospital.get("whatsapp_number"),
            "lat": lat,
            "lng": lng,
            "equipment": extract_equipment(hospital),
            "last_report_at": hospital.get("last_report_at"),
            "is_active": hospital.get("is_active", True),
        },
        "beds": beds,
        "active_handshakes": active_handshakes,
        "stats": stats,
        "dashboard_url": f"/hospital/{slug}/dashboard",
        "log_url": f"/log/{slug}",
    }


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/beds — full bed update
# ---------------------------------------------------------------------------

class BedUpdateItem(BaseModel):
    bed_type: str
    available_count: int
    overflow_count: int = 0

class BedUpdateRequest(BaseModel):
    beds: list[BedUpdateItem]
    reported_by: str = "Dashboard"

@router.post("/{slug}/beds")
async def update_beds_by_slug(slug: str, request: BedUpdateRequest):
    """Update bed availability from the dashboard."""
    hospital = get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    now = datetime.now(timezone.utc).isoformat()
    updated = []

    for bed in request.beds:
        existing = (
            supabase.table("hospital_beds")
            .select("id")
            .eq("hospital_id", hospital_id)
            .eq("bed_type", bed.bed_type)
            .execute()
        )

        bed_data = {
            "hospital_id": hospital_id,
            "bed_type": bed.bed_type,
            "available_count": bed.available_count,
            "overflow_count": bed.overflow_count,
            "reported_by": request.reported_by,
            "reported_at": now,
        }

        if existing.data:
            supabase.table("hospital_beds").update(bed_data).eq("id", existing.data[0]["id"]).execute()
        else:
            supabase.table("hospital_beds").insert(bed_data).execute()

        updated.append(bed.bed_type)

    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    return {"status": "updated", "updated_bed_types": updated}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/increment
# ---------------------------------------------------------------------------

@router.post("/{slug}/beds/{bed_type}/increment")
async def increment_bed(slug: str, bed_type: str):
    """Add 1 to available_count for a bed type. Caps at total_count."""
    hospital = get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    now = datetime.now(timezone.utc).isoformat()

    bed = (
        supabase.table("hospital_beds")
        .select("id, available_count, total_count")
        .eq("hospital_id", hospital_id)
        .eq("bed_type", bed_type)
        .execute()
    )

    if not bed.data:
        raise HTTPException(status_code=404, detail=f"Bed type '{bed_type}' not found for this hospital")

    b = bed.data[0]
    current = b["available_count"] or 0
    total = b["total_count"] or 999
    new_count = min(current + 1, total)

    supabase.table("hospital_beds").update({
        "available_count": new_count,
        "reported_at": now,
    }).eq("id", b["id"]).execute()

    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    return {"bed_type": bed_type, "available_count": new_count, "action": "incremented"}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/decrement
# ---------------------------------------------------------------------------

@router.post("/{slug}/beds/{bed_type}/decrement")
async def decrement_bed(slug: str, bed_type: str):
    """Subtract 1 from available_count for a bed type. Floors at 0."""
    hospital = get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    now = datetime.now(timezone.utc).isoformat()

    bed = (
        supabase.table("hospital_beds")
        .select("id, available_count")
        .eq("hospital_id", hospital_id)
        .eq("bed_type", bed_type)
        .execute()
    )

    if not bed.data:
        raise HTTPException(status_code=404, detail=f"Bed type '{bed_type}' not found for this hospital")

    b = bed.data[0]
    current = b["available_count"] or 0
    new_count = max(current - 1, 0)

    supabase.table("hospital_beds").update({
        "available_count": new_count,
        "reported_at": now,
    }).eq("id", b["id"]).execute()

    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    return {"bed_type": bed_type, "available_count": new_count, "action": "decremented"}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/accept/{handshake_id}
# ---------------------------------------------------------------------------

@router.post("/{slug}/accept/{handshake_id}")
async def accept_handshake_web(slug: str, handshake_id: str):
    """Accept a handshake from the web dashboard."""
    hospital = get_hospital_by_slug(slug)

    # Verify handshake belongs to this hospital
    hs = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("receiving_hospital_id", hospital["id"])
        .eq("status", "requested")
        .execute()
    )

    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found or not in requested status")

    handshake = hs.data[0]
    result = await accept_handshake(handshake_id)

    if not result:
        raise HTTPException(status_code=400, detail="Failed to accept handshake")

    # Notify the patient via WhatsApp
    requester_phone = handshake["requesting_party_phone"]
    transfer_code = handshake["transfer_code"]
    bed_type = handshake["bed_type"].upper()

    await send_text(requester_phone, (
        f"\u2705 *Bed confirmed at {hospital['name']}!*\n\n"
        f"Bed type: {bed_type}\n"
        f"Address: {hospital['address']}\n"
        f"Transfer code: *{transfer_code}*\n"
        f"Bed held for 45 minutes.\n\n"
        f"Show the transfer code on arrival."
    ))

    return {"status": "accepted", "transfer_code": transfer_code}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/decline/{handshake_id}
# ---------------------------------------------------------------------------

class DeclineRequest(BaseModel):
    reason: str = "no_beds"
    reason_text: Optional[str] = None

DECLINE_REASONS = {
    "no_beds": "All beds are currently occupied.",
    "wrong_specialty": "This hospital doesn\u2019t have the specialty you need.",
    "equipment_unavailable": "Required equipment is currently unavailable.",
    "too_severe": "Your condition needs a higher-level facility.",
    "too_minor": "Your condition may not need hospital care.",
    "other": None,
}

@router.post("/{slug}/decline/{handshake_id}")
async def decline_handshake_web(slug: str, handshake_id: str, request: DeclineRequest):
    """Decline a handshake with reason from the web dashboard."""
    hospital = get_hospital_by_slug(slug)

    # Verify handshake belongs to this hospital
    hs = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("receiving_hospital_id", hospital["id"])
        .eq("status", "requested")
        .execute()
    )

    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found or not in requested status")

    handshake = hs.data[0]

    # Build the reason string
    reason_label = DECLINE_REASONS.get(request.reason)
    if request.reason == "other":
        reason_label = request.reason_text or "No reason provided."
    full_reason = request.reason if request.reason != "other" else request.reason_text

    result = await decline_handshake(handshake_id, full_reason)

    if not result:
        raise HTTPException(status_code=400, detail="Failed to decline handshake")

    # Notify the patient
    requester_phone = handshake["requesting_party_phone"]
    await send_text(requester_phone, (
        f"\u274c *{hospital['name']}* could not hold a bed.\n"
        f"Reason: {reason_label}\n\n"
        f"Send *EMERGENCY* to search for other available hospitals."
    ))

    return {"status": "declined", "reason": request.reason}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/override/{handshake_id}
# ---------------------------------------------------------------------------

class OverrideRequest(BaseModel):
    walkin_urgency: str = "critical"
    reason: Optional[str] = None

@router.post("/{slug}/override/{handshake_id}")
async def override_handshake_web(slug: str, handshake_id: str, request: OverrideRequest):
    """Override a held bed for a walk-in emergency from the web dashboard."""
    hospital = get_hospital_by_slug(slug)

    # Verify handshake belongs to this hospital and is accepted
    hs = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("receiving_hospital_id", hospital["id"])
        .eq("status", "accepted")
        .execute()
    )

    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found or not in accepted status")

    from app.services.handshake_mgr import override_handshake as do_override
    result = await do_override(handshake_id, request.walkin_urgency, request.reason)

    if not result:
        raise HTTPException(status_code=400, detail="Failed to override handshake")

    reroute_result = None
    has_active_ambulance = False
    transport_req = (
        supabase.table("transport_requests")
        .select("id, assignment_id, status")
        .eq("handshake_id", handshake_id)
        .execute()
    ).data
    if transport_req:
        tr = transport_req[0]
        if tr.get("assignment_id") and tr["status"] in ("dispatch_accepted", "rerouted"):
            has_active_ambulance = True
            try:
                reroute_result = await reroute_transport_request(tr["id"])
                print(f"   🔄 Ambulance rerouted: {reroute_result.get('new_hospital', {}).get('name', 'unknown')}")
            except Exception as e:
                print(f"   ⚠️ Ambulance reroute failed: {e}")
                has_active_ambulance = False

    reroute_count = 0
    if not has_active_ambulance:
        from app.services.router import reroute_displaced_patient
        reroute_count = await reroute_displaced_patient(result, hospital["name"])

    return {
        "status": "overridden",
        "urgency_comparison": result.get("_urgency_comparison", "unknown"),
        "walkin_urgency": request.walkin_urgency,
        "held_urgency": result.get("_held_urgency", "medium"),
        "reroute_results_count": reroute_count,
        "ambulance_rerouted": reroute_result,
    }


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/complete/{handshake_id}
# ---------------------------------------------------------------------------

@router.post("/{slug}/complete/{handshake_id}")
async def complete_handshake_web(slug: str, handshake_id: str):
    """Confirm patient arrival — complete the handshake from the web dashboard."""
    hospital = get_hospital_by_slug(slug)

    # Verify handshake belongs to this hospital and is accepted
    hs = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("receiving_hospital_id", hospital["id"])
        .eq("status", "accepted")
        .execute()
    )

    if not hs.data:
        raise HTTPException(status_code=404, detail="Handshake not found or not in accepted status")

    handshake = hs.data[0]
    now = datetime.now(timezone.utc).isoformat()

    # Complete the handshake
    supabase.table("handshakes").update({
        "status": "completed",
        "completed_at": now,
    }).eq("id", handshake_id).execute()

    # Notify the patient
    requester_phone = handshake["requesting_party_phone"]
    transfer_code = handshake["transfer_code"]

    await send_text(requester_phone, (
        f"✅ *Arrival confirmed at {hospital['name']}!*\n\n"
        f"Transfer code *{transfer_code}* has been verified.\n"
        f"Wishing a speedy recovery."
    ))

    return {"status": "completed", "transfer_code": transfer_code}
