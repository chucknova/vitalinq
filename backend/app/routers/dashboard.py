"""
Hospital Dashboard API — everything the web dashboard needs.

GET  /api/hospitals/dashboard/{slug}                          — full dashboard data
POST /api/hospitals/dashboard/{slug}/beds                     — update beds (full)
POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/increment — +1 bed
POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/decrement — -1 bed
POST /api/hospitals/dashboard/{slug}/accept/{handshake_id}    — accept handshake from web
POST /api/hospitals/dashboard/{slug}/decline/{handshake_id}   — decline with reason from web
"""

import math
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import supabase, execute_async
from app.auth import get_current_user
from app.config import settings
from app.services.search_engine import extract_equipment, _parse_location
from app.services.handshake_mgr import accept_handshake, decline_handshake
from app.services.transport_reroute import reroute_transport_request
from app.services.dashboard_cache import get_summary, set_summary, invalidate_summary
from app.services.whatsapp import send_text, send_buttons

router = APIRouter(prefix="/hospitals/dashboard", tags=["Hospital Dashboard"])

HOSPITAL_STATS_CACHE_TTL_SEC = 30.0


def _haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _send_text_background(phone: str, message: str):
    try:
        await send_text(phone, message)
    except Exception as exc:
        print(f"   ⚠️ Background send_text failed: {exc}")


def _extract_emergency_phone(handshake: dict) -> str | None:
    parsed_requirements = handshake.get("parsed_requirements")
    if not isinstance(parsed_requirements, dict):
        return None
    phone = (parsed_requirements.get("emergency_contact_phone") or "").strip()
    return phone or None


def _queue_contact_notifications(background_tasks: BackgroundTasks, handshake: dict, message: str):
    phones = []
    requester_phone = (handshake.get("requesting_party_phone") or "").strip()
    emergency_phone = _extract_emergency_phone(handshake)
    if requester_phone:
        phones.append(requester_phone)
    if emergency_phone and emergency_phone not in phones:
        phones.append(emergency_phone)

    for phone in phones:
        background_tasks.add_task(_send_text_background, phone, message)


def _build_emergency_track_link(handshake_id: str | None) -> str | None:
    if not handshake_id:
        return None
    return f"{settings.FRONTEND_URL}/emergency/{handshake_id}/track"


async def _background_override_reroute(handshake_id: str, result: dict, hospital_name: str):
    try:
        transport_req = (
            await execute_async(
            supabase.table("transport_requests")
            .select("id, assignment_id, status")
            .eq("handshake_id", handshake_id)
            )
        ).data or []

        if transport_req:
            tr = transport_req[0]
            if tr.get("assignment_id") and tr["status"] in ("dispatch_accepted", "rerouted"):
                reroute_result = await reroute_transport_request(tr["id"])
                print(f"   🔄 Ambulance rerouted: {reroute_result.get('new_hospital', {}).get('name', 'unknown')}")
                return

        from app.services.router import reroute_displaced_patient
        await reroute_displaced_patient(result, hospital_name)
    except Exception as exc:
        print(f"   ⚠️ Background override reroute failed: {exc}")


# ---------------------------------------------------------------------------
# Helper: resolve slug to hospital
# ---------------------------------------------------------------------------

async def get_hospital_by_slug(slug: str) -> dict:
    result = await execute_async(
        supabase.table("hospitals")
        .select("*")
        .eq("slug", slug)
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return result.data[0]


async def _build_hospital_dashboard_stats(hospital: dict, hospital_id: str, now: datetime) -> dict:
    cached_stats = get_summary("hospital_dashboard_stats", hospital_id)
    if cached_stats is not None:
        return cached_stats

    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    recent_handshakes = (
        await execute_async(
        supabase.table("handshakes")
        .select("id, status, created_at")
        .eq("receiving_hospital_id", hospital_id)
        .gt("created_at", cutoff_24h)
        )
    ).data or []

    cutoff_7d = (now - timedelta(days=7)).isoformat()
    routed_7d = await execute_async(
        supabase.table("handshakes")
        .select("id", count="exact")
        .eq("receiving_hospital_id", hospital_id)
        .gt("created_at", cutoff_7d)
    )

    admitted_7d = await execute_async(
        supabase.table("handshakes")
        .select("id", count="exact")
        .eq("receiving_hospital_id", hospital_id)
        .eq("status", "completed")
        .gt("created_at", cutoff_7d)
    )

    cutoff_30d = (now - timedelta(days=30)).isoformat()
    signals = (
        await execute_async(
        supabase.table("verification_signals")
        .select("signal_value")
        .eq("hospital_id", hospital_id)
        .gt("created_at", cutoff_30d)
        )
    ).data or []

    positive_signals = sum(1 for signal in signals if signal["signal_value"] == "positive")
    total_signals = len(signals)

    last_report = hospital.get("last_report_at")
    if last_report:
        if isinstance(last_report, str):
            last_report_dt = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
        else:
            last_report_dt = last_report
        hours_since = (now - last_report_dt).total_seconds() / 3600
    else:
        hours_since = None

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
    return set_summary("hospital_dashboard_stats", hospital_id, stats, HOSPITAL_STATS_CACHE_TTL_SEC)


# ---------------------------------------------------------------------------
# GET /api/hospitals/dashboard/{slug}
# ---------------------------------------------------------------------------

@router.get("/{slug}")
async def get_dashboard(slug: str, user: dict = Depends(get_current_user)):
    """
    Returns everything the hospital dashboard needs in one call:
    hospital info, all beds, active handshakes, and stats.
    """
    hospital = await get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    now = datetime.now(timezone.utc)

    # ── Beds ──────────────────────────────────────────
    beds = (
        await execute_async(
        supabase.table("hospital_beds")
        .select("*")
        .eq("hospital_id", hospital_id)
        )
    ).data

    # ── Active handshakes (requested + accepted) ─────
    active_handshakes = (
        await execute_async(
        supabase.table("handshakes")
        .select("*")
        .eq("receiving_hospital_id", hospital_id)
        .in_("status", ["requested", "accepted"])
        .order("created_at", desc=True)
        )
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

    active_handshake_ids = [hs["id"] for hs in active_handshakes if hs.get("id")]
    transport_requests = []
    if active_handshake_ids:
        transport_requests = (
            await execute_async(
            supabase.table("transport_requests")
            .select("*")
            .in_("handshake_id", active_handshake_ids)
            .order("created_at", desc=True)
            )
        ).data or []

    transport_by_handshake = {}
    for transport in transport_requests:
        handshake_id = transport.get("handshake_id")
        if handshake_id and handshake_id not in transport_by_handshake:
            transport_by_handshake[handshake_id] = transport

    transport_needed_count = 0
    for hs in active_handshakes:
        transport = transport_by_handshake.get(hs["id"])
        hs["_transport_request"] = transport
        hs["_transport_needs_response"] = bool(transport and transport.get("status") == "asking_hospital")
        if hs["_transport_needs_response"]:
            transport_needed_count += 1

    stats = await _build_hospital_dashboard_stats(hospital, hospital_id, now)

    # Parse location
    lat, lng = _parse_location(hospital.get("location"))

    # ── Pending broadcasts this hospital can answer from the dashboard ─────
    pending_broadcasts = []
    broadcast_history = []
    if lat is not None and lng is not None:
        active_broadcasts = (
            await execute_async(
            supabase.table("broadcasts")
            .select("id, title, description, lat, lng, radius_km, expected_patients, created_at, status, images")
            .eq("status", "active")
            .order("created_at", desc=True)
            )
        ).data or []

        if active_broadcasts:
            existing_responses = (
                await execute_async(
                supabase.table("broadcast_responses")
                .select("broadcast_id, status")
                .eq("hospital_id", hospital_id)
                .in_("broadcast_id", [b["id"] for b in active_broadcasts])
                )
            ).data or []
            responded_ids = {response["broadcast_id"] for response in existing_responses if response.get("broadcast_id")}

            for broadcast in active_broadcasts:
                if broadcast["id"] in responded_ids:
                    continue
                b_lat = broadcast.get("lat")
                b_lng = broadcast.get("lng")
                if b_lat is None or b_lng is None:
                    continue
                distance_km = round(_haversine(lat, lng, b_lat, b_lng), 1)
                if distance_km > (broadcast.get("radius_km") or 0):
                    continue
                pending_broadcasts.append({
                    **broadcast,
                    "_distance_km": distance_km,
                })

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
        "pending_broadcasts": pending_broadcasts,
        "transport_needed_count": transport_needed_count,
        "stats": stats,
        "dashboard_url": f"/hospital/{slug}/dashboard",
        "log_url": f"/log/{slug}",
    }


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/broadcasts/{broadcast_id}/respond
# ---------------------------------------------------------------------------

class BroadcastResponseRequest(BaseModel):
    action: str  # respond | decline

@router.post("/{slug}/broadcasts/{broadcast_id}/respond")
async def respond_to_broadcast(slug: str, broadcast_id: str, request: BroadcastResponseRequest, user: dict = Depends(get_current_user)):
    hospital = await get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    invalidate_summary("hospital_dashboard_stats", hospital_id)

    broadcast = (
        supabase.table("broadcasts")
        .select("id, status, lat, lng, radius_km")
        .eq("id", broadcast_id)
        .execute()
    )
    if not broadcast.data:
        raise HTTPException(status_code=404, detail="Broadcast not found")

    broadcast_row = broadcast.data[0]
    if broadcast_row.get("status") != "active":
        raise HTTPException(status_code=400, detail="Broadcast is no longer active")

    existing = (
        supabase.table("broadcast_responses")
        .select("id, status")
        .eq("broadcast_id", broadcast_id)
        .eq("hospital_id", hospital_id)
        .execute()
    )
    if existing.data:
        return {"ok": True, "status": existing.data[0]["status"], "already_responded": True}

    hospital_lat, hospital_lng = _parse_location(hospital.get("location"))
    if hospital_lat is None or hospital_lng is None:
        raise HTTPException(status_code=400, detail="Hospital location is missing")

    distance_km = _haversine(hospital_lat, hospital_lng, broadcast_row["lat"], broadcast_row["lng"])
    if distance_km > (broadcast_row.get("radius_km") or 0):
        raise HTTPException(status_code=403, detail="Broadcast is outside this hospital's response area")

    if request.action == "decline":
        supabase.table("broadcast_responses").insert({
            "broadcast_id": broadcast_id,
            "hospital_id": hospital_id,
            "status": "declined",
            "notes": "Unable to help",
        }).execute()
    elif request.action == "respond":
        beds = (
            supabase.table("hospital_beds")
            .select("bed_type, available_count")
            .eq("hospital_id", hospital_id)
            .execute()
        ).data or []

        capacity = {
            "icu_available": 0,
            "ward_available": 0,
            "emergency_available": 0,
            "surgical_available": 0,
            "maternity_available": 0,
            "pediatric_available": 0,
        }
        for bed in beds:
            col = f"{bed['bed_type']}_available"
            if col in capacity:
                capacity[col] = bed.get("available_count", 0) or 0

        supabase.table("broadcast_responses").insert({
            "broadcast_id": broadcast_id,
            "hospital_id": hospital_id,
            "status": "responded",
            **capacity,
        }).execute()

        now = datetime.now(timezone.utc).isoformat()
        supabase.table("hospitals").update({
            "last_report_at": now,
            "freshness_score": 1.0,
        }).eq("id", hospital_id).execute()
    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    bc = supabase.table("broadcasts").select("hospitals_responded").eq("id", broadcast_id).execute()
    if bc.data:
        supabase.table("broadcasts").update({
            "hospitals_responded": (bc.data[0]["hospitals_responded"] or 0) + 1,
        }).eq("id", broadcast_id).execute()

    return {"ok": True, "status": "responded" if request.action == "respond" else "declined", "already_responded": False}


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
async def update_beds_by_slug(slug: str, request: BedUpdateRequest, user: dict = Depends(get_current_user)):
    """Update bed availability from the dashboard."""
    hospital = await get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    invalidate_summary("hospital_dashboard_stats", hospital_id)
    now = datetime.now(timezone.utc).isoformat()
    bed_rows = []

    for bed in request.beds:
        bed_rows.append({
            "hospital_id": hospital_id,
            "bed_type": bed.bed_type,
            "available_count": bed.available_count,
            "overflow_count": bed.overflow_count,
            "reported_by": request.reported_by,
            "reported_at": now,
        })

    if bed_rows:
        await execute_async(
            supabase.table("hospital_beds").upsert(
                bed_rows,
                on_conflict="hospital_id,bed_type",
            )
        )

    await execute_async(supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id))

    return {"status": "updated", "updated_bed_types": [bed["bed_type"] for bed in bed_rows]}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/beds/{bed_type}/increment
# ---------------------------------------------------------------------------

@router.post("/{slug}/beds/{bed_type}/increment")
async def increment_bed(slug: str, bed_type: str, user: dict = Depends(get_current_user)):
    """Add 1 to available_count for a bed type. Caps at total_count."""
    hospital = await get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    invalidate_summary("hospital_dashboard_stats", hospital_id)
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
async def decrement_bed(slug: str, bed_type: str, user: dict = Depends(get_current_user)):
    """Subtract 1 from available_count for a bed type. Floors at 0."""
    hospital = await get_hospital_by_slug(slug)
    hospital_id = hospital["id"]
    invalidate_summary("hospital_dashboard_stats", hospital_id)
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
async def accept_handshake_web(slug: str, handshake_id: str, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Accept a handshake from the web dashboard."""
    hospital = await get_hospital_by_slug(slug)
    invalidate_summary("hospital_dashboard_stats", hospital["id"])

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
    transfer_code = handshake["transfer_code"]
    bed_type = handshake["bed_type"].upper()

    message = (
        f"\u2705 *Bed confirmed at {hospital['name']}!*\n\n"
        f"Bed type: {bed_type}\n"
        f"Address: {hospital['address']}\n"
        f"Transfer code: *{transfer_code}*\n"
        f"Bed held for 45 minutes.\n\n"
        f"Show the transfer code on arrival."
    )
    track_link = _build_emergency_track_link(handshake_id)
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _queue_contact_notifications(background_tasks, handshake, message)

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
async def decline_handshake_web(slug: str, handshake_id: str, request: DeclineRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Decline a handshake with reason from the web dashboard."""
    hospital = await get_hospital_by_slug(slug)
    invalidate_summary("hospital_dashboard_stats", hospital["id"])

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
    message = (
        f"\u274c *{hospital['name']}* could not hold a bed.\n"
        f"Reason: {reason_label}\n\n"
        f"Send *EMERGENCY* to search for other available hospitals."
    )
    track_link = _build_emergency_track_link(handshake_id)
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _queue_contact_notifications(background_tasks, handshake, message)

    return {"status": "declined", "reason": request.reason}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/override/{handshake_id}
# ---------------------------------------------------------------------------

class OverrideRequest(BaseModel):
    walkin_urgency: str = "critical"
    reason: Optional[str] = None

@router.post("/{slug}/override/{handshake_id}")
async def override_handshake_web(slug: str, handshake_id: str, request: OverrideRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Override a held bed for a walk-in emergency from the web dashboard."""
    hospital = await get_hospital_by_slug(slug)
    invalidate_summary("hospital_dashboard_stats", hospital["id"])

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

    background_tasks.add_task(_background_override_reroute, handshake_id, result, hospital["name"])

    return {
        "status": "overridden",
        "urgency_comparison": result.get("_urgency_comparison", "unknown"),
        "walkin_urgency": request.walkin_urgency,
        "held_urgency": result.get("_held_urgency", "medium"),
        "reroute_results_count": 0,
        "ambulance_rerouted": None,
    }


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/complete/{handshake_id}
# ---------------------------------------------------------------------------

class CompleteRequest(BaseModel):
    transfer_code: str

@router.post("/{slug}/complete/{handshake_id}")
async def complete_handshake_web(slug: str, handshake_id: str, request: CompleteRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Confirm patient arrival — verify transfer code and complete the handshake."""
    hospital = await get_hospital_by_slug(slug)
    invalidate_summary("hospital_dashboard_stats", hospital["id"])

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

    # Verify transfer code
    if handshake["transfer_code"] != request.transfer_code.upper().strip():
        raise HTTPException(status_code=400, detail="Incorrect transfer code")

    now = datetime.now(timezone.utc).isoformat()

    # Complete the handshake
    supabase.table("handshakes").update({
        "status": "completed",
        "completed_at": now,
    }).eq("id", handshake_id).execute()

    # Notify the patient
    transfer_code = handshake["transfer_code"]

    message = (
        f"✅ *Arrival confirmed at {hospital['name']}!*\n\n"
        f"Transfer code *{transfer_code}* has been verified.\n"
        f"Wishing a speedy recovery."
    )
    track_link = _build_emergency_track_link(handshake_id)
    if track_link:
        message += f"\n\nTrack updates:\n{track_link}"
    _queue_contact_notifications(background_tasks, handshake, message)

    return {"status": "completed", "transfer_code": transfer_code}


# ---------------------------------------------------------------------------
# POST /api/hospitals/dashboard/{slug}/bed-scan — AI camera bed detection
# ---------------------------------------------------------------------------

class BedScanRequest(BaseModel):
    bed_type: str
    image_base64: str  # base64-encoded image from phone camera

@router.post("/{slug}/bed-scan")
async def scan_beds(slug: str, request: BedScanRequest, user: dict = Depends(get_current_user)):
    """
    Analyze a photo of a hospital ward using Claude Vision to detect
    bed occupancy. Updates the bed count for the specified bed type.
    """
    import anthropic

    hospital = await get_hospital_by_slug(slug)

    # Determine the media type from the base64 header or default to jpeg
    image_data = request.image_base64
    media_type = "image/jpeg"
    if image_data.startswith("data:"):
        # Strip the data URL prefix: "data:image/png;base64,..."
        header, image_data = image_data.split(",", 1)
        if "image/png" in header:
            media_type = "image/png"
        elif "image/webp" in header:
            media_type = "image/webp"

    # Call Claude Vision to analyze the image
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are analyzing a photo of a hospital ward or room. "
                            "Count the total number of beds visible and how many are "
                            "occupied (have a person lying in or sitting on them) vs empty. "
                            "An occupied bed has a person visibly on it. An empty bed has "
                            "no person on it (may have sheets, pillows, equipment). "
                            "If you cannot clearly identify beds, estimate based on what you see. "
                            "Return ONLY valid JSON, no other text:\n"
                            '{ "total_beds": <number>, "occupied": <number>, "empty": <number>, '
                            '"confidence": "high" | "medium" | "low", '
                            '"notes": "<brief description of what you see>" }'
                        ),
                    },
                ],
            }],
        )

        text = message.content[0].text.strip()
        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.removeprefix("```json").removeprefix("```")
        if text.endswith("```"):
            text = text.removesuffix("```")
        text = text.strip()

        import json
        result = json.loads(text)

        total = result.get("total_beds", 0)
        occupied = result.get("occupied", 0)
        empty = result.get("empty", 0)
        confidence = result.get("confidence", "low")
        notes = result.get("notes", "")

        print(f"📷 BED SCAN: {hospital['name']} — {request.bed_type} — "
              f"total={total}, occupied={occupied}, empty={empty} ({confidence})")

        # Update the bed count in the database
        bed_record = (
            supabase.table("hospital_beds")
            .select("id, total_count, available_count")
            .eq("hospital_id", hospital["id"])
            .eq("bed_type", request.bed_type)
            .execute()
        )

        now = datetime.now(timezone.utc).isoformat()

        if bed_record.data:
            bed = bed_record.data[0]
            supabase.table("hospital_beds").update({
                "total_count": total,
                "available_count": empty,
            }).eq("id", bed["id"]).execute()
        else:
            # Create new bed record
            supabase.table("hospital_beds").insert({
                "hospital_id": hospital["id"],
                "bed_type": request.bed_type,
                "total_count": total,
                "available_count": empty,
            }).execute()

        # Update hospital freshness
        supabase.table("hospitals").update({
            "last_report_at": now,
        }).eq("id", hospital["id"]).execute()

        return {
            "total_beds": total,
            "occupied": occupied,
            "empty": empty,
            "confidence": confidence,
            "notes": notes,
            "bed_type": request.bed_type,
            "updated": True,
        }

    except json.JSONDecodeError as e:
        print(f"⚠️ BED SCAN: Claude returned invalid JSON: {e}")
        raise HTTPException(status_code=500, detail="AI analysis failed — could not parse response")
    except anthropic.APIError as e:
        print(f"❌ BED SCAN: Claude API error: {e}")
        raise HTTPException(status_code=500, detail="AI analysis failed — API error")
    except Exception as e:
        print(f"❌ BED SCAN: Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")

# ---------------------------------------------------------------------------
# Department Access — code-based auth for charge nurses
# ---------------------------------------------------------------------------

class DeptCodeCreate(BaseModel):
    bed_types: list[str]
    label: str

class DeptCodeVerify(BaseModel):
    access_code: str


def _normalize_department_access_code(code: str | None) -> str:
    """Normalize department codes so verification is case/whitespace insensitive."""
    return "".join((code or "").upper().split())

# POST /api/hospitals/dashboard/{slug}/departments — list department codes (admin only)
@router.get("/{slug}/departments")
async def list_department_codes(slug: str, user: dict = Depends(get_current_user)):
    """List all department access codes for this hospital (admin only)."""
    hospital = await get_hospital_by_slug(slug)
    codes = (
        supabase.table("department_access")
        .select("id, bed_types, access_code, label, is_active, created_at")
        .eq("hospital_id", hospital["id"])
        .eq("is_active", True)
        .order("label")
        .execute()
    ).data or []
    return {"departments": codes}

# POST /api/hospitals/dashboard/{slug}/departments/create — generate a new code
@router.post("/{slug}/departments/create")
async def create_department_code(slug: str, request: DeptCodeCreate, user: dict = Depends(get_current_user)):
    """Generate a new department access code."""
    import secrets, string
    hospital = await get_hospital_by_slug(slug)

    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("L", "").replace("1", "")
    code = _normalize_department_access_code("".join(secrets.choice(chars) for _ in range(6)))

    result = supabase.table("department_access").insert({
        "hospital_id": hospital["id"],
        "bed_types": request.bed_types,
        "access_code": code,
        "label": request.label,
    }).execute()

    return result.data[0]

# DELETE /api/hospitals/dashboard/{slug}/departments/{dept_id}
@router.delete("/{slug}/departments/{dept_id}")
async def delete_department_code(slug: str, dept_id: str, user: dict = Depends(get_current_user)):
    """Deactivate a department access code."""
    hospital = await get_hospital_by_slug(slug)
    supabase.table("department_access").update({"is_active": False}).eq("id", dept_id).eq("hospital_id", hospital["id"]).execute()
    return {"deleted": True}

# POST /api/hospitals/dashboard/{slug}/department/verify — verify a department code (no auth required)
@router.post("/{slug}/department/verify")
async def verify_department_code(slug: str, request: DeptCodeVerify):
    """Verify a department access code. No auth required — the code IS the auth."""
    hospital = await get_hospital_by_slug(slug)
    code = _normalize_department_access_code(request.access_code)
    departments = (
        await execute_async(
            supabase.table("department_access")
            .select("*")
            .eq("hospital_id", hospital["id"])
            .eq("is_active", True)
        )
    ).data or []

    dept = next(
        (
            row
            for row in departments
            if _normalize_department_access_code(row.get("access_code")) == code
        ),
        None,
    )

    if not dept:
        # This route is intentionally public, so a bad code should not masquerade
        # as a failed bearer-token authentication event on the client.
        raise HTTPException(status_code=403, detail="Invalid department code")

    return {
        "verified": True,
        "label": dept["label"],
        "bed_types": dept["bed_types"],
        "hospital_name": hospital["name"],
    }

# GET /api/hospitals/dashboard/{slug}/department/data — get department-filtered data (no auth, code verified client-side)
@router.get("/{slug}/department/data")
async def get_department_data(slug: str, bed_types: str):
    """Get dashboard data filtered to specific bed types. bed_types is comma-separated."""
    hospital = await get_hospital_by_slug(slug)
    types = [t.strip() for t in bed_types.split(",")]

    # Beds for this department only
    beds = (
        supabase.table("hospital_beds")
        .select("*")
        .eq("hospital_id", hospital["id"])
        .in_("bed_type", types)
        .execute()
    ).data or []

    # Handshakes for this department's bed types
    all_hs = (
        supabase.table("handshakes")
        .select("*")
        .eq("receiving_hospital_id", hospital["id"])
        .in_("status", ["requested", "accepted"])
        .order("created_at", desc=True)
        .execute()
    ).data or []

    # Filter to matching bed types
    dept_handshakes = [h for h in all_hs if h.get("bed_type") in types]

    return {
        "hospital": {"id": hospital["id"], "name": hospital["name"], "slug": slug},
        "beds": beds,
        "handshakes": dept_handshakes,
    }