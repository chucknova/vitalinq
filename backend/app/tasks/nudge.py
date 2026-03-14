"""
Hospital Check-In Sender — runs every 15 minutes.

Finds hospitals that haven't received a check-in in 6+ hours,
then sends them the interactive check-in message (Still Accurate /
Update Now / All Full).

Max 10 check-ins per cycle to avoid Twilio throttling.
"""

from datetime import datetime, timezone, timedelta
from app.database import supabase
from app.services.hospital_flows import send_checkin_message

MAX_PER_CYCLE = 10


async def send_checkins():
    """Find hospitals due for check-in and send them."""
    now = datetime.now(timezone.utc)
    six_hours_ago = (now - timedelta(hours=6)).isoformat()

    # Find hospitals that haven't been checked in for 6+ hours
    due = (
        supabase.table("hospitals")
        .select("id, name")
        .eq("is_active", True)
        .or_(f"last_checkin_sent_at.is.null,last_checkin_sent_at.lt.{six_hours_ago}")
        .limit(MAX_PER_CYCLE)
        .execute()
    )

    if not due.data:
        return

    print(f"🔔 CHECK-IN: {len(due.data)} hospitals due")

    for hospital in due.data:
        try:
            await send_checkin_message(hospital["id"])
            print(f"   ✅ Check-in sent to {hospital['name']}")
        except Exception as e:
            print(f"   ❌ Check-in failed for {hospital['name']}: {e}")
