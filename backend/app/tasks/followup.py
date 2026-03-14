"""
Ghost Bed Detection — follow-up sender.

Runs every 5 minutes. Finds queries where:
  - User selected a hospital (selected_hospital_id is set)
  - Query is 2-4 hours old (enough time to arrive, not so old they forgot)
  - No follow-up has been sent yet

Sends a WhatsApp message asking "Were you admitted?" with Yes/No buttons.
Their response feeds into the hospital's accuracy score.

Usage:
    Registered with APScheduler in app/tasks/scheduler.py.
    Can be called manually:

        from app.tasks.followup import send_followups
        await send_followups()
"""

from datetime import datetime, timezone, timedelta
from app.database import supabase
from app.services.whatsapp import send_text, send_buttons

# Max follow-ups per cycle to avoid Twilio throttling
MAX_PER_CYCLE = 20


async def send_followups():
    """
    Find eligible queries and send follow-up messages.
    Runs every 5 minutes via APScheduler.
    """
    now = datetime.now(timezone.utc)
    two_hours_ago = (now - timedelta(hours=2)).isoformat()
    four_hours_ago = (now - timedelta(hours=4)).isoformat()

    # Find queries that need follow-up
    eligible = (
        supabase.table("queries")
        .select("id, selected_hospital_id, user_phone_hash, channel, created_at")
        .not_.is_("selected_hospital_id", "null")
        .eq("followup_sent", False)
        .lt("created_at", two_hours_ago)     # Older than 2 hours
        .gt("created_at", four_hours_ago)    # But not older than 4 hours
        .limit(MAX_PER_CYCLE)
        .execute()
    )

    if not eligible.data:
        return  # Nothing to follow up on

    print(f"👻 GHOST BED CHECK: Found {len(eligible.data)} queries to follow up on")

    for query in eligible.data:
        query_id = query["id"]
        hospital_id = query["selected_hospital_id"]

        try:
            # Fetch hospital name
            hospital = (
                supabase.table("hospitals")
                .select("name")
                .eq("id", hospital_id)
                .execute()
            )
            hospital_name = hospital.data[0]["name"] if hospital.data else "the hospital"

            # We need the actual phone number to send the follow-up.
            # The queries table stores a hash, not the raw phone.
            # Look up from the handshake that was created for this query.
            handshake = (
                supabase.table("handshakes")
                .select("requesting_party_phone")
                .eq("query_id", query_id)
                .limit(1)
                .execute()
            )

            if not handshake.data:
                # No handshake for this query — can't send follow-up
                # Mark as sent anyway so we don't keep retrying
                supabase.table("queries").update({
                    "followup_sent": True,
                    "followup_sent_at": now.isoformat(),
                }).eq("id", query_id).execute()
                continue

            user_phone = handshake.data[0]["requesting_party_phone"]

            # Send the follow-up
            await send_buttons(user_phone, (
                f"Quick follow-up from BedSignal:\n\n"
                f"Were you successfully admitted at *{hospital_name}*?\n\n"
                f"Your response helps keep data accurate\n"
                f"for the next person in an emergency."
            ), [
                ("✅ Yes, admitted", f"yes_followup_{query_id}"),
                ("❌ No, turned away", f"no_followup_{query_id}"),
            ])

            # Mark follow-up as sent
            supabase.table("queries").update({
                "followup_sent": True,
                "followup_sent_at": now.isoformat(),
            }).eq("id", query_id).execute()

            print(f"   ✅ Follow-up sent for query {query_id[:8]}... → {hospital_name}")

        except Exception as e:
            # Don't let one failure stop the others
            print(f"   ❌ Follow-up failed for query {query_id[:8]}...: {e}")
