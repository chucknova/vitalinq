"""
Handshake manager — bed reservation state machine.

Lifecycle:  requested → accepted | declined → completed | expired

A "handshake" is BedSignal's term for a bed reservation. When a user
finds a hospital and wants to reserve a bed:

1. CREATE:   handshake created (status: requested), transfer code generated
2. ACCEPT:   hospital taps Accept → bed count decremented, expiry timer set
3. DECLINE:  hospital taps Decline → requester notified, alternatives offered
4. COMPLETE: patient arrives, shows transfer code → bed hold finalized
5. EXPIRE:   timer runs out → bed restored, both parties notified

Usage:
    from app.services.handshake_mgr import create_handshake, accept_handshake, ...
"""

import secrets
import string
from datetime import datetime, timedelta, timezone
from app.database import supabase


# ---------------------------------------------------------------------------
# Transfer code generator
# ---------------------------------------------------------------------------

def generate_transfer_code(length: int = 6) -> str:
    """
    Generate a random alphanumeric transfer code like 'K7M2X9'.
    Used as confirmation number — patient shows this on arrival.
    """
    chars = string.ascii_uppercase + string.digits
    # Remove ambiguous characters (0/O, 1/I/L) to avoid confusion
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("L", "").replace("1", "")
    return "".join(secrets.choice(chars) for _ in range(length))


# ---------------------------------------------------------------------------
# CREATE handshake
# ---------------------------------------------------------------------------

async def create_handshake(
    receiving_hospital_id: str,
    bed_type: str,
    requesting_party_type: str,
    requesting_party_phone: str,
    patient_summary: str | None = None,
    parsed_requirements: dict | None = None,
    query_id: str | None = None,
    hold_duration_min: int = 45,
) -> dict:
    """
    Create a new bed reservation request.

    Returns the full handshake record including transfer_code.
    """
    transfer_code = generate_transfer_code()

    # Ensure transfer code is unique (extremely unlikely to collide, but be safe)
    for _ in range(5):
        existing = (
            supabase.table("handshakes")
            .select("id")
            .eq("transfer_code", transfer_code)
            .execute()
        )
        if not existing.data:
            break
        transfer_code = generate_transfer_code()

    row = {
        "receiving_hospital_id": receiving_hospital_id,
        "bed_type": bed_type,
        "requesting_party_type": requesting_party_type,
        "requesting_party_phone": requesting_party_phone,
        "patient_summary": patient_summary,
        "parsed_requirements": parsed_requirements,
        "query_id": query_id,
        "status": "requested",
        "transfer_code": transfer_code,
        "hold_duration_min": hold_duration_min,
    }

    result = supabase.table("handshakes").insert(row).execute()
    handshake = result.data[0]

    print(f"🤝 HANDSHAKE CREATED: {handshake['id'][:8]}... code={transfer_code}")
    return handshake


# ---------------------------------------------------------------------------
# ACCEPT handshake
# ---------------------------------------------------------------------------

async def accept_handshake(handshake_id: str) -> dict | None:
    """
    Hospital accepts the bed hold.

    - Sets status to 'accepted'
    - Sets expires_at (now + hold_duration)
    - Decrements available_count for that bed type at that hospital
    """
    # Fetch the handshake
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "requested")
        .execute()
    )

    if not result.data:
        print(f"⚠️ Handshake {handshake_id} not found or not in 'requested' status")
        return None

    handshake = result.data[0]
    now = datetime.now(timezone.utc)
    hold_minutes = handshake.get("hold_duration_min", 45)
    expires_at = now + timedelta(minutes=hold_minutes)

    # Update handshake
    updated = (
        supabase.table("handshakes")
        .update({
            "status": "accepted",
            "accepted_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        .eq("id", handshake_id)
        .execute()
    )

    # Decrement bed count
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
        new_count = max(0, (bed["available_count"] or 0) - 1)
        supabase.table("hospital_beds").update({
            "available_count": new_count,
        }).eq("id", bed["id"]).execute()

    print(f"✅ HANDSHAKE ACCEPTED: {handshake_id[:8]}... expires={expires_at.strftime('%H:%M UTC')}")
    return updated.data[0] if updated.data else handshake


# ---------------------------------------------------------------------------
# DECLINE handshake
# ---------------------------------------------------------------------------

async def decline_handshake(handshake_id: str, reason: str | None = None) -> dict | None:
    """Hospital declines the bed hold."""
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "requested")
        .execute()
    )

    if not result.data:
        return None

    updated = (
        supabase.table("handshakes")
        .update({
            "status": "declined",
            "declined_reason": reason,
        })
        .eq("id", handshake_id)
        .execute()
    )

    print(f"❌ HANDSHAKE DECLINED: {handshake_id[:8]}...")
    return updated.data[0] if updated.data else result.data[0]


# ---------------------------------------------------------------------------
# COMPLETE handshake
# ---------------------------------------------------------------------------

async def complete_handshake(handshake_id: str, transfer_code: str) -> dict | None:
    """
    Patient arrived. Verify transfer code and mark as completed.
    """
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "accepted")
        .execute()
    )

    if not result.data:
        return None

    handshake = result.data[0]

    # Verify transfer code
    if handshake["transfer_code"] != transfer_code.upper().strip():
        print(f"⚠️ HANDSHAKE COMPLETE: wrong transfer code for {handshake_id[:8]}")
        return None

    now = datetime.now(timezone.utc)
    updated = (
        supabase.table("handshakes")
        .update({
            "status": "completed",
            "completed_at": now.isoformat(),
        })
        .eq("id", handshake_id)
        .execute()
    )

    print(f"🏁 HANDSHAKE COMPLETED: {handshake_id[:8]}...")
    return updated.data[0] if updated.data else handshake


# ---------------------------------------------------------------------------
# EXPIRE handshake (called by background task)
# ---------------------------------------------------------------------------

async def expire_handshake(handshake_id: str) -> dict | None:
    """
    Bed hold timed out. Restore bed count and mark as expired.
    Called by the auto-expiry background task.
    """
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "accepted")
        .execute()
    )

    if not result.data:
        return None

    handshake = result.data[0]

    # Mark as expired
    supabase.table("handshakes").update({
        "status": "expired",
    }).eq("id", handshake_id).execute()

    # Restore bed count
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

    print(f"⏰ HANDSHAKE EXPIRED: {handshake_id[:8]}... bed restored")
    return handshake


# ---------------------------------------------------------------------------
# Helper: get handshake with hospital details
# ---------------------------------------------------------------------------

async def get_handshake_detail(handshake_id: str) -> dict | None:
    """Fetch a handshake with receiving hospital info."""
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .execute()
    )

    if not result.data:
        return None

    handshake = result.data[0]

    # Fetch hospital
    hospital = (
        supabase.table("hospitals")
        .select("id, name, address, whatsapp_number, location")
        .eq("id", handshake["receiving_hospital_id"])
        .execute()
    )

    if hospital.data:
        handshake["_hospital"] = hospital.data[0]

    # Calculate time remaining
    if handshake.get("status") == "accepted" and handshake.get("expires_at"):
        expires = handshake["expires_at"]
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
        handshake["_time_remaining_sec"] = max(0, int(remaining))
    else:
        handshake["_time_remaining_sec"] = None

    return handshake
