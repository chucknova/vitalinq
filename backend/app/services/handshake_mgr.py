"""
Handshake manager — bed reservation state machine.

Lifecycle:  requested → accepted | declined → completed | expired | overridden

A "handshake" is BedSignal's term for a bed reservation. When a user
finds a hospital and wants to reserve a bed:

1. CREATE:   handshake created (status: requested), transfer code generated
2. ACCEPT:   hospital taps Accept → bed count decremented, expiry timer set
3. DECLINE:  hospital taps Decline → requester notified, alternatives offered
4. COMPLETE: patient arrives, shows transfer code → bed hold finalized
5. EXPIRE:   timer runs out → bed restored, both parties notified
6. OVERRIDE: hospital overrides for a walk-in → displaced patient auto-rerouted

Usage:
    from app.services.handshake_mgr import create_handshake, accept_handshake, ...
"""

import secrets
import string
from datetime import datetime, timedelta, timezone
from app.database import supabase, execute_async


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
            await execute_async(
            supabase.table("handshakes")
            .select("id")
            .eq("transfer_code", transfer_code)
            )
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

    result = await execute_async(supabase.table("handshakes").insert(row))
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
    result = await execute_async(
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "requested")
    )

    if not result.data:
        print(f"⚠️ Handshake {handshake_id} not found or not in 'requested' status")
        return None

    return await accept_handshake_record(result.data[0])


async def accept_handshake_record(handshake: dict) -> dict | None:
    """
    Accept a handshake when the caller already has the requested row.

    This avoids an extra handshake fetch on hot paths like reroutes.
    """
    if not handshake or handshake.get("status") != "requested":
        print("⚠️ Handshake not found or not in 'requested' status")
        return None

    handshake_id = handshake["id"]
    now = datetime.now(timezone.utc)
    hold_minutes = handshake.get("hold_duration_min", 45)
    expires_at = now + timedelta(minutes=hold_minutes)

    # Update handshake
    updated = await execute_async(
        supabase.table("handshakes")
        .update({
            "status": "accepted",
            "accepted_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        .eq("id", handshake_id)
    )

    # Decrement bed count
    hospital_id = handshake["receiving_hospital_id"]
    bed_type = handshake["bed_type"]

    bed_record = await execute_async(
        supabase.table("hospital_beds")
        .select("id, available_count")
        .eq("hospital_id", hospital_id)
        .eq("bed_type", bed_type)
    )

    if bed_record.data:
        bed = bed_record.data[0]
        new_count = max(0, (bed["available_count"] or 0) - 1)
        await execute_async(supabase.table("hospital_beds").update({
            "available_count": new_count,
        }).eq("id", bed["id"]))

    print(f"✅ HANDSHAKE ACCEPTED: {handshake_id[:8]}... expires={expires_at.strftime('%H:%M UTC')}")
    return updated.data[0] if updated.data else handshake


# ---------------------------------------------------------------------------
# DECLINE handshake
# ---------------------------------------------------------------------------

async def decline_handshake(handshake_id: str, reason: str | None = None) -> dict | None:
    """Hospital declines the bed hold."""
    result = await execute_async(
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "requested")
    )

    if not result.data:
        return None

    updated = await execute_async(
        supabase.table("handshakes")
        .update({
            "status": "declined",
            "declined_reason": reason,
        })
        .eq("id", handshake_id)
    )

    # If this handshake is linked to a broadcast patient, reset them to unassigned
    bp = await execute_async(
        supabase.table("broadcast_patients")
        .select("id")
        .eq("handshake_id", handshake_id)
    )
    if bp.data:
        await execute_async(supabase.table("broadcast_patients").update({
            "status": "unassigned",
            "assigned_hospital_id": None,
            "handshake_id": None,
        }).eq("handshake_id", handshake_id))
        print(f"   ↩️ MCI patient reset to unassigned (hospital declined)")

    print(f"❌ HANDSHAKE DECLINED: {handshake_id[:8]}...")
    return updated.data[0] if updated.data else result.data[0]


# ---------------------------------------------------------------------------
# COMPLETE handshake
# ---------------------------------------------------------------------------

async def complete_handshake(handshake_id: str, transfer_code: str) -> dict | None:
    """
    Patient arrived. Verify transfer code and mark as completed.
    """
    result = await execute_async(
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "accepted")
    )

    if not result.data:
        return None

    handshake = result.data[0]

    # Verify transfer code
    if handshake["transfer_code"] != transfer_code.upper().strip():
        print(f"⚠️ HANDSHAKE COMPLETE: wrong transfer code for {handshake_id[:8]}")
        return None

    now = datetime.now(timezone.utc)
    updated = await execute_async(
        supabase.table("handshakes")
        .update({
            "status": "completed",
            "completed_at": now.isoformat(),
        })
        .eq("id", handshake_id)
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


# ---------------------------------------------------------------------------
# OVERRIDE handshake — walk-in emergency displaces held patient
# ---------------------------------------------------------------------------

URGENCY_RANK = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}


async def override_handshake(
    handshake_id: str,
    walkin_urgency: str,
    reason: str | None = None,
) -> dict | None:
    """
    Hospital overrides an accepted bed hold for a more critical walk-in.

    - Sets status to 'overridden'
    - Does NOT restore bed count (walk-in takes the bed)
    - Returns the handshake with urgency comparison info

    The caller (router/dashboard) handles:
    - Notifying the displaced patient
    - Running auto-reroute search
    """
    # Fetch the handshake — must be accepted
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .eq("status", "accepted")
        .execute()
    )

    if not result.data:
        print(f"⚠️ Override failed: handshake {handshake_id} not found or not accepted")
        return None

    handshake = result.data[0]
    now = datetime.now(timezone.utc)

    # Determine the held patient's urgency
    held_urgency = "medium"  # default
    query_id = handshake.get("query_id")
    if query_id:
        query = (
            supabase.table("queries")
            .select("parsed_requirements")
            .eq("id", query_id)
            .execute()
        )
        if query.data and query.data[0].get("parsed_requirements"):
            parsed = query.data[0]["parsed_requirements"]
            if isinstance(parsed, dict):
                held_urgency = parsed.get("urgency", "medium")

    # Compare urgencies
    walkin_rank = URGENCY_RANK.get(walkin_urgency, 2)
    held_rank = URGENCY_RANK.get(held_urgency, 2)

    if walkin_rank > held_rank:
        urgency_comparison = "higher"
    elif walkin_rank == held_rank:
        urgency_comparison = "equal"
    else:
        urgency_comparison = "lower"

    # Execute the override
    updated = (
        supabase.table("handshakes")
        .update({
            "status": "overridden",
            "declined_reason": f"override:{walkin_urgency}:{reason or 'walk-in emergency'}",
            "completed_at": now.isoformat(),
        })
        .eq("id", handshake_id)
        .execute()
    )

    # NOTE: We do NOT restore the bed — the walk-in takes it

    print(f"🔴 HANDSHAKE OVERRIDDEN: {handshake_id[:8]}... walk-in={walkin_urgency} held={held_urgency} ({urgency_comparison})")

    result_data = updated.data[0] if updated.data else handshake
    result_data["_walkin_urgency"] = walkin_urgency
    result_data["_held_urgency"] = held_urgency
    result_data["_urgency_comparison"] = urgency_comparison
    result_data["_query_id"] = query_id

    return result_data
