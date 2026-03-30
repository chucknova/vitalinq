"""
Transport timeout checker — auto-escalates transport requests
when the hospital doesn't respond within 5 minutes.

Runs every 60 seconds via the scheduler.

If a transport request has been in 'asking_hospital' status for more
than 5 minutes, it's automatically escalated to dispatch companies
(same as if the hospital tapped "No ambulance available").
"""

from datetime import datetime, timedelta, timezone
from app.database import supabase

HOSPITAL_TIMEOUT_MINUTES = 5


async def check_transport_timeouts():
    """Find and escalate timed-out transport requests."""

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=HOSPITAL_TIMEOUT_MINUTES)).isoformat()

    # Find transport requests stuck in asking_hospital past the timeout
    stale = (
        supabase.table("transport_requests")
        .select("id, patient_phone, destination_hospital_id, handshake_id, created_at")
        .eq("status", "asking_hospital")
        .lt("created_at", cutoff)
        .execute()
    ).data or []

    if not stale:
        return

    print(f"⏰ TRANSPORT TIMEOUT: {len(stale)} request(s) stuck in asking_hospital > {HOSPITAL_TIMEOUT_MINUTES}min")

    for transport in stale:
        try:
            # Get the full transport record for _hospital_declined
            tr = (
                supabase.table("transport_requests")
                .select("*")
                .eq("id", transport["id"])
                .eq("status", "asking_hospital")  # Re-check — might have been resolved between query and now
                .execute()
            )
            if not tr.data:
                continue  # Already resolved

            full_transport = tr.data[0]

            # Get hospital name for the log
            hosp = supabase.table("hospitals").select("name").eq("id", full_transport["destination_hospital_id"]).execute()
            hospital_name = hosp.data[0]["name"] if hosp.data else "hospital"

            print(f"   → Auto-escalating transport {transport['id'][:8]} ({hospital_name} didn't respond)")

            # Import here to avoid circular imports
            from app.routers.transport import _hospital_declined
            await _hospital_declined(full_transport)

        except Exception as e:
            print(f"   ❌ Auto-escalation failed for {transport['id'][:8]}: {e}")