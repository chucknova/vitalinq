"""
Handshake auto-expiry — runs every 60 seconds.

Finds accepted handshakes where expires_at has passed, then:
  1. Sets status to 'expired'
  2. Restores the held bed (increments available_count)
  3. Notifies both parties via WhatsApp

This is critical — if it fails, beds stay phantom-locked forever.
Every action is logged.

Usage:
    This is registered with APScheduler in app/tasks/scheduler.py.
    It can also be called manually for testing:

        from app.tasks.expiry import check_expired_handshakes
        await check_expired_handshakes()
"""

from datetime import datetime, timezone
from app.database import supabase
from app.services.handshake_mgr import expire_handshake
from app.services.whatsapp import send_text


async def check_expired_handshakes():
    """
    Find and expire all accepted handshakes past their expiry time.
    Runs every 60 seconds via APScheduler.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Find all accepted handshakes that have expired
    expired = (
        supabase.table("handshakes")
        .select("id, transfer_code, requesting_party_phone, receiving_hospital_id, bed_type")
        .eq("status", "accepted")
        .lt("expires_at", now)
        .execute()
    )

    if not expired.data:
        return  # Nothing to do — this is the happy path most of the time

    print(f"⏰ EXPIRY CHECK: Found {len(expired.data)} expired handshake(s)")

    for handshake in expired.data:
        handshake_id = handshake["id"]
        transfer_code = handshake["transfer_code"]
        requester_phone = handshake["requesting_party_phone"]
        hospital_id = handshake["receiving_hospital_id"]

        try:
            # Expire it (sets status, restores bed count)
            result = await expire_handshake(handshake_id)

            if not result:
                print(f"   ⚠️ {handshake_id[:8]}: already handled, skipping")
                continue

            # Fetch hospital details for notification
            hospital = (
                supabase.table("hospitals")
                .select("name, whatsapp_number")
                .eq("id", hospital_id)
                .execute()
            )

            hospital_name = "the hospital"
            hospital_phone = None
            if hospital.data:
                hospital_name = hospital.data[0]["name"]
                hospital_phone = hospital.data[0]["whatsapp_number"]

            # Notify requester
            await send_text(requester_phone, (
                f"⏰ *Bed hold expired*\n\n"
                f"Your reserved bed at {hospital_name} "
                f"(code: {transfer_code}) has been released.\n\n"
                f"Send *EMERGENCY* to search for available beds again."
            ))

            # Notify hospital
            if hospital_phone:
                await send_text(hospital_phone, (
                    f"⏰ Bed hold expired for transfer code *{transfer_code}*.\n"
                    f"The reserved bed has been released back to your availability."
                ))

            print(f"   ✅ {handshake_id[:8]}: expired, bed restored, both parties notified")

        except Exception as e:
            # Never let one failure stop the others
            print(f"   ❌ {handshake_id[:8]}: expiry failed — {e}")
            import traceback
            traceback.print_exc()
