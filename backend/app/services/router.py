"""
WhatsApp message router — decides what to do with each incoming message.

Priority order (first match wins):
    1. ButtonPayload  — user tapped an interactive button
    2. ListReply      — user selected from a list message
    3. Numeric reply  — "1", "2", "3" mapped to recent buttons/lists
    4. Session state  — user is mid-flow
    5. Location       — user shared GPS coordinates
    6. Keywords       — EMERGENCY, HELP, STATUS, UPDATE, etc.
    7. Bed report     — free-text pattern like "ICU: 2, Ward: 5"
    8. Default        — natural language → Smart Triage Router
"""

import re
from app.database import supabase
from app.services.sessions import get_session, set_session, update_session, clear_session
from app.services.whatsapp import send_text, send_list, resolve_numeric_reply
from app.services.search_engine import search_nearby
from app.services.hospital_flows import (
    handle_still_accurate,
    handle_all_full,
    handle_update_start,
    handle_bed_type_selected,
    handle_available_count,
    handle_overflow_count,
    handle_update_another_yes,
    handle_update_another_no,
    handle_status,
    handle_freetext_report,
    handle_unknown,
    send_bed_type_list,
)


# ---------------------------------------------------------------------------
# Patterns and constants
# ---------------------------------------------------------------------------

BED_REPORT_PATTERN = re.compile(
    r"(icu|ward|maternity|mat|pediatric|ped|emergency|emerg|surgical|surg|psychiatric)"
    r"\s*:?\s*(\d+)"
    r"(?:\s*/\s*(\d+)\s*(?:-?\s*overflow)?)?",
    re.IGNORECASE,
)

PANIC_KEYWORDS = {"emergency", "help", "sos", "urgent", "bed", "find"}
HOSPITAL_KEYWORDS = {"status", "update"}


# ---------------------------------------------------------------------------
# Hospital lookup
# ---------------------------------------------------------------------------

async def get_hospital_by_phone(phone: str) -> dict | None:
    """Check if this phone number belongs to a registered hospital."""
    result = (
        supabase.table("hospitals")
        .select("id, name, whatsapp_number")
        .eq("whatsapp_number", phone)
        .eq("is_active", True)
        .execute()
    )
    return result.data[0] if result.data else None


# ---------------------------------------------------------------------------
# Main router
# ---------------------------------------------------------------------------

async def route_message(
    phone: str,
    body: str,
    button_payload: str | None,
    list_reply: str | None,
    lat: float | None,
    lng: float | None,
    profile_name: str = "",
):
    body_stripped = body.strip()
    body_upper = body_stripped.upper()

    # ==================================================================
    # 1. BUTTON PAYLOAD
    # ==================================================================
    if button_payload:
        await handle_button(phone, button_payload)
        return

    # ==================================================================
    # 2. LIST REPLY
    # ==================================================================
    if list_reply:
        await handle_list_reply(phone, list_reply)
        return

    # ==================================================================
    # 3. SESSION STATE — check BEFORE numeric reply resolution
    #    so that a nurse typing "3" during a bed update doesn't get
    #    intercepted as a button/list reply
    # ==================================================================
    session = get_session(phone)
    if session:
        # If user is in a step that expects a number, go straight to session handler
        expects_number = session.get("step") in (
            "awaiting_available", "awaiting_overflow"
        )
        if expects_number and body_stripped.isdigit():
            await handle_session_input(phone, body_stripped, session, lat, lng)
            return

        # Otherwise, check if it's a numeric reply to buttons/list we sent
        if body_stripped.isdigit():
            number = int(body_stripped)
            choice = resolve_numeric_reply(phone, number)
            if choice:
                if choice["type"] == "button":
                    await handle_button(phone, choice["payload"])
                    return
                elif choice["type"] == "list":
                    await handle_list_reply(phone, choice["id"])
                    return

        # Not a numeric reply — handle as regular session input
        await handle_session_input(phone, body_stripped, session, lat, lng)
        return

    # ==================================================================
    # 4. NUMERIC REPLY — no active session, resolve to recent buttons/lists
    # ==================================================================
    if body_stripped.isdigit():
        number = int(body_stripped)
        choice = resolve_numeric_reply(phone, number)
        if choice:
            if choice["type"] == "button":
                await handle_button(phone, choice["payload"])
                return
            elif choice["type"] == "list":
                await handle_list_reply(phone, choice["id"])
                return

    # ==================================================================
    # 5. LOCATION (no active session)
    # ==================================================================
    if lat is not None and lng is not None:
        await handle_location_search(phone, lat, lng)
        return

    # ==================================================================
    # 6. TRIGGER KEYWORDS
    # ==================================================================
    first_word = body_upper.split()[0] if body_stripped else ""
    hospital = await get_hospital_by_phone(phone)

    if first_word in {k.upper() for k in HOSPITAL_KEYWORDS} and hospital:
        if first_word == "STATUS":
            await handle_status(phone, hospital)
        elif first_word == "UPDATE":
            await handle_update_start(phone, hospital)
        return

    if first_word in {k.upper() for k in PANIC_KEYWORDS} and not hospital:
        await handle_panic_mode_start(phone, profile_name)
        return

    # Check if a panic keyword appears as a whole word (not substring)
    # This prevents "finding" matching "find" or "bedside" matching "bed"
    if not hospital and body_stripped:
        words_in_body = set(body_upper.split())
        if words_in_body & {k.upper() for k in PANIC_KEYWORDS}:
            await handle_panic_mode_start(phone, profile_name)
            return

    # ==================================================================
    # 7. FREE-TEXT BED REPORT (hospital only)
    # ==================================================================
    if hospital:
        matches = BED_REPORT_PATTERN.findall(body_stripped)
        if matches:
            await handle_freetext_report(phone, hospital, matches)
            return
        await handle_unknown(phone, hospital)
        return

    # ==================================================================
    # 8. DEFAULT → Smart Triage Router
    # ==================================================================
    await handle_triage_start(phone, body_stripped, profile_name)


# ---------------------------------------------------------------------------
# Button handler — dispatches to the correct flow
# ---------------------------------------------------------------------------

async def handle_button(phone: str, payload: str):
    """Route button taps to the correct handler."""
    print(f"🔘 BUTTON: {phone} tapped '{payload}'")

    if payload.startswith("still_accurate_"):
        hospital_id = payload.replace("still_accurate_", "")
        await handle_still_accurate(phone, hospital_id)

    elif payload.startswith("update_now_"):
        hospital_id = payload.replace("update_now_", "")
        hospital = supabase.table("hospitals").select("id, name, whatsapp_number").eq("id", hospital_id).execute()
        if hospital.data:
            await handle_update_start(phone, hospital.data[0])

    elif payload.startswith("all_full_"):
        hospital_id = payload.replace("all_full_", "")
        await handle_all_full(phone, hospital_id)

    elif payload == "update_another_yes":
        await handle_update_another_yes(phone)

    elif payload == "update_another_no":
        await handle_update_another_no(phone)

    elif payload.startswith("accept_handshake_"):
        handshake_id = payload.replace("accept_handshake_", "")
        print(f"   → Accept handshake {handshake_id}")
        # TODO: Phase 6 — handle_handshake_accept(handshake_id)

    elif payload.startswith("decline_handshake_"):
        handshake_id = payload.replace("decline_handshake_", "")
        print(f"   → Decline handshake {handshake_id}")
        # TODO: Phase 6 — handle_handshake_decline(handshake_id)

    elif payload.startswith("yes_followup_"):
        query_id = payload.replace("yes_followup_", "")
        print(f"   → Positive verification for query {query_id}")
        # TODO: Phase 7 — handle_verification(query_id, "positive")

    elif payload.startswith("no_followup_"):
        query_id = payload.replace("no_followup_", "")
        print(f"   → Negative verification for query {query_id}")
        # TODO: Phase 7 — handle_verification(query_id, "negative")

    else:
        print(f"   → Unknown button: {payload}")


# ---------------------------------------------------------------------------
# List reply handler
# ---------------------------------------------------------------------------

async def handle_list_reply(phone: str, list_reply: str):
    """Route list selections to the correct handler."""
    print(f"📋 LIST: {phone} selected '{list_reply}'")

    session = get_session(phone)
    if session and session["flow"] == "bed_update" and session["step"] == "select_type":
        await handle_bed_type_selected(phone, list_reply)

    elif session and session["flow"] in ("panic_mode", "triage") and session["step"] == "awaiting_selection":
        # User selected a hospital from search results
        hospital_id = list_reply
        query_id = session["data"].get("query_id")
        print(f"   → Hospital selected: {hospital_id}")

        # Log the selection in the queries table
        if query_id:
            supabase.table("queries").update({
                "selected_hospital_id": hospital_id,
            }).eq("id", query_id).execute()

        # Transition to handshake flow
        set_session(phone, flow="handshake", step="awaiting_summary", data={
            "selected_hospital_id": hospital_id,
            "query_id": query_id,
        })
        await send_text(phone, (
            "Reserving a bed at this hospital.\n\n"
            "Briefly describe the patient's condition\n"
            "(e.g. 'Male, 66, diabetic, head injury, confused'):"
        ))

    else:
        print(f"   → No matching session for list reply")


# ---------------------------------------------------------------------------
# Session input handler — mid-flow messages
# ---------------------------------------------------------------------------

async def handle_session_input(
    phone: str, body: str, session: dict, lat: float | None, lng: float | None
):
    """Handle input from a user mid-flow."""
    flow = session["flow"]
    step = session["step"]

    print(f"🔄 SESSION: {phone} flow='{flow}' step='{step}' input='{body[:40]}'")

    if flow == "bed_update":
        if step == "awaiting_available":
            await handle_available_count(phone, body, session)
        elif step == "awaiting_overflow":
            await handle_overflow_count(phone, body, session)
        elif step == "select_type":
            # They typed instead of selecting — try to match a bed type
            typed = body.lower().strip()
            from app.services.hospital_flows import BED_TYPE_ALIASES
            bed_type = BED_TYPE_ALIASES.get(typed, typed)
            if bed_type in ("icu", "ward", "maternity", "emergency", "pediatric", "surgical", "psychiatric"):
                await handle_bed_type_selected(phone, bed_type)
            else:
                await send_text(phone, "Please select a bed type from the list above, or type the name (e.g. ICU, Ward).")
        elif step == "awaiting_another":
            # They typed instead of tapping a button
            if body.lower() in ("yes", "y", "yeah", "yep"):
                await handle_update_another_yes(phone)
            elif body.lower() in ("no", "n", "nah", "nope", "done"):
                await handle_update_another_no(phone)
            else:
                await send_text(phone, "Reply *Yes* to update another bed type, or *No* if you're done.")

    elif flow == "panic_mode":
        if step == "awaiting_location":
            if lat is not None and lng is not None:
                print(f"   → Location received: {lat}, {lng}")
                description = session["data"].get("description")
                await run_search_and_send_results(
                    phone, lat, lng,
                    query_type="panic_mode",
                    query_text=description,
                )
            else:
                # Typed text instead of location — save as description, re-ask
                update_session(phone, step="awaiting_location",
                              data_updates={"description": body})
                await send_text(phone, (
                    "🧠 Got it. Now share your *location* so we can "
                    "find the nearest hospital.\n\n"
                    "📍 Tap the + button and select *Location*."
                ))
        elif step == "awaiting_selection":
            # User typed something instead of selecting from the list
            # (numeric selection is handled by resolve_numeric_reply above)
            await send_text(phone, "Please reply with a number to select a hospital from the list above.")

    elif flow == "triage":
        if step == "awaiting_location":
            if lat is not None and lng is not None:
                print(f"   → Location for triage: {lat}, {lng}")
                description = session["data"].get("description", "")
                await run_search_and_send_results(
                    phone, lat, lng,
                    query_type="triage",
                    query_text=description,
                )
            else:
                await send_text(phone, (
                    "📍 Please share your *location* so we can find "
                    "hospitals near you.\n\n"
                    "Tap the + button and select *Location*."
                ))

    elif flow == "handshake":
        if step == "awaiting_summary":
            print(f"   → Patient summary: '{body}'")
            # TODO: Phase 6 — create handshake with this summary
            await send_text(phone, "🔄 Sending bed hold request... (Handshake system coming in Phase 6)")
            clear_session(phone)

    else:
        print(f"   → Unknown flow '{flow}', clearing")
        clear_session(phone)


# ---------------------------------------------------------------------------
# Search → Format → Send results as list message
# ---------------------------------------------------------------------------

# Trust tier badges for WhatsApp display
TRUST_BADGES = {
    "verified": "✅ Verified",
    "active": "",
    "unverified": "⚠️ Unverified",
}

async def run_search_and_send_results(
    phone: str,
    lat: float,
    lng: float,
    query_type: str = "basic_search",
    query_text: str | None = None,
    radius_km: float = 15,
    bed_type: str | None = None,
    required_equipment: list[str] | None = None,
):
    """
    Run a hospital search and send results to the user as a WhatsApp list.
    Then transition the session to awaiting hospital selection.
    """
    results, query_id = await search_nearby(
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        bed_type=bed_type,
        include_overflow=True,
        limit=5,
        required_equipment=required_equipment,
        user_phone=phone,
        query_type=query_type,
        query_text=query_text,
        channel="whatsapp",
    )

    if not results:
        await send_text(phone, (
            "😔 No hospitals with available beds found within "
            f"{radius_km}km of your location.\n\n"
            "Try again later, or send another location to search a different area."
        ))
        clear_session(phone)
        return

    # Format results as list options
    options = []
    for r in results:
        # Build a compact bed summary: "ICU: 2 | Ward: 5"
        bed_parts = []
        for bt, bd in r["beds"].items():
            avail = bd["available"]
            if avail > 0:
                bed_parts.append(f"{bt.upper()}: {avail}")
            elif bd["overflow"] > 0:
                bed_parts.append(f"{bt.upper()}: {bd['overflow']}ovf")
        bed_text = " | ".join(bed_parts[:3])  # Max 3 types to keep it short

        # Trust badge
        badge = TRUST_BADGES.get(r["trust_tier"], "")
        if badge:
            badge = f" {badge}"

        # Freshness
        fresh = ""
        if r.get("freshness_hours") is not None:
            hrs = r["freshness_hours"]
            if hrs < 1:
                fresh = f"{int(hrs*60)}min ago"
            else:
                fresh = f"{hrs:.0f}h ago"

        description = f"{bed_text}{badge}"
        if fresh:
            description += f" | {fresh}"

        options.append({
            "id": r["hospital_id"],
            "title": f"{r['name'][:40]} — {r['distance_km']}km",
            "description": description,
        })

    # Set session to expect a hospital selection
    set_session(phone, flow="panic_mode", step="awaiting_selection", data={
        "query_id": query_id,
        "lat": lat,
        "lng": lng,
        "results": results,
    })

    count = len(options)
    await send_list(
        phone,
        f"🏥 {count} hospital{'s' if count != 1 else ''} found near you:",
        options,
    )


# ---------------------------------------------------------------------------
# User-side stubs (Phases 5, 6)
# ---------------------------------------------------------------------------

async def handle_location_search(phone: str, lat: float, lng: float):
    """Unsolicited location share — do a nearby search."""
    print(f"📍 LOCATION: {phone} ({lat}, {lng}) → running search")
    await run_search_and_send_results(phone, lat, lng, query_type="basic_search")


async def handle_panic_mode_start(phone: str, profile_name: str):
    """Start Panic Mode — user needs a hospital urgently."""
    print(f"🚨 PANIC: {phone} ({profile_name})")
    set_session(phone, flow="panic_mode", step="awaiting_location", data={
        "profile_name": profile_name,
    })
    await send_text(phone, (
        "🚨 *BedSignal Emergency*\n\n"
        "Share your location so we can find the nearest "
        "hospitals with available beds.\n\n"
        "📍 Tap the + button and select *Location*.\n\n"
        "Or describe your emergency and we'll find the best match:\n"
        "e.g. 'My father collapsed, he's diabetic, hit his head'"
    ))


async def handle_triage_start(phone: str, description: str, profile_name: str):
    """Default — natural language, will go to Claude in Phase 5."""
    print(f"🧠 TRIAGE: {phone} — '{description[:60]}'")
    set_session(phone, flow="triage", step="awaiting_location", data={
        "description": description,
        "profile_name": profile_name,
    })
    await send_text(phone, (
        "🧠 I'll analyze your emergency to find the best hospital.\n\n"
        "📍 Please share your *location* so I can search nearby.\n\n"
        "Tap the + button and select *Location*."
    ))