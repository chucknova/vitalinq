"""
Hospital Patient Log endpoint.

GET /api/hospitals/log/{slug} — returns recent handshakes for a hospital.

No authentication — the slug acts as a lightweight access token.
Only returns non-PII data: transfer codes, bed types, statuses, timestamps.
No patient names, phone numbers, or diagnoses.
"""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from app.database import supabase

router = APIRouter(prefix="/hospitals", tags=["Patient Log"])


@router.get("/log/{slug}")
async def get_patient_log(slug: str, hours: int = 24):
    """
    Get all handshakes for a hospital in the last N hours.
    Accessible via the hospital's unique slug — no auth required.
    """

    # Look up hospital by slug
    hospital = (
        supabase.table("hospitals")
        .select("id, name, slug")
        .eq("slug", slug)
        .execute()
    )

    if not hospital.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    h = hospital.data[0]
    hospital_id = h["id"]
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=hours)).isoformat()

    # Fetch handshakes — only non-PII fields
    handshakes = (
        supabase.table("handshakes")
        .select(
            "id, transfer_code, bed_type, status, "
            "hold_duration_min, expires_at, "
            "created_at, accepted_at, completed_at"
        )
        .eq("receiving_hospital_id", hospital_id)
        .gt("created_at", cutoff)
        .order("created_at", desc=True)
        .execute()
    )

    # Compute time fields for each handshake
    entries = []
    active_holds = 0
    admitted_today = 0
    declined_count = 0

    for hs in handshakes.data:
        entry = {
            "transfer_code": hs["transfer_code"],
            "bed_type": hs["bed_type"],
            "status": hs["status"],
            "created_at": hs["created_at"],
            "accepted_at": hs.get("accepted_at"),
            "completed_at": hs.get("completed_at"),
            "time_remaining_sec": None,
        }

        # Compute countdown for accepted handshakes
        if hs["status"] == "accepted" and hs.get("expires_at"):
            expires = hs["expires_at"]
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            remaining = (expires - now).total_seconds()
            entry["time_remaining_sec"] = max(0, int(remaining))
            active_holds += 1

        if hs["status"] == "completed":
            admitted_today += 1

        if hs["status"] == "declined":
            declined_count += 1

        if hs["status"] == "requested":
            active_holds += 1

        entries.append(entry)

    return {
        "hospital": {
            "name": h["name"],
            "slug": h["slug"],
        },
        "summary": {
            "active_holds": active_holds,
            "admitted_today": admitted_today,
            "declined": declined_count,
            "total": len(entries),
        },
        "entries": entries,
        "as_of": now.isoformat(),
    }