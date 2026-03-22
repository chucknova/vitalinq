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
from app.services.whatsapp import send_text, send_list, send_buttons, resolve_numeric_reply
from app.services.search_engine import search_nearby
from app.services.handshake_mgr import (
    create_handshake,
    accept_handshake,
    decline_handshake,
    complete_handshake,
    get_handshake_detail,
)
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
    handle_discharge,
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
HOSPITAL_KEYWORDS = {"status", "update", "discharge", "override"}


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
        elif first_word == "DISCHARGE":
            await handle_discharge(phone, hospital, body_stripped)
        elif first_word == "OVERRIDE":
            await handle_override_start(phone, hospital, body_stripped)
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
    # 7. TRANSFER CODE COMPLETION (hospital only)
    #    If a hospital types a 6-char alphanumeric code like "K7M2X9",
    #    treat it as a patient arrival confirmation.
    # ==================================================================
    if hospital:
        code_match = re.match(r"^[A-Z2-9]{6}$", body_upper)
        if code_match:
            await handle_transfer_code_completion(phone, hospital, body_upper)
            return

    # ==================================================================
    # 8. FREE-TEXT BED REPORT (hospital only)
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
        await handle_handshake_accept(phone, handshake_id)

    elif payload.startswith("decline_handshake_"):
        handshake_id = payload.replace("decline_handshake_", "")
        # Start the decline reason selection flow
        set_session(phone, flow="decline_reason", step="select_reason", data={
            "handshake_id": handshake_id,
        })
        await send_list(phone, "Why are you declining this bed request?", [
            {"id": "no_beds", "title": "No beds available", "description": "Reported availability was wrong or changed"},
            {"id": "wrong_specialty", "title": "Wrong specialty", "description": "Patient needs care we don't provide"},
            {"id": "equipment_unavailable", "title": "Equipment unavailable", "description": "Required equipment is down or in use"},
            {"id": "too_severe", "title": "Condition too severe", "description": "Patient needs a higher-level facility"},
            {"id": "too_minor", "title": "Condition too minor", "description": "Patient should visit a clinic instead"},
            {"id": "other", "title": "Other reason", "description": ""},
        ])

    elif payload.startswith("yes_followup_"):
        query_id = payload.replace("yes_followup_", "")
        await handle_followup_response(phone, query_id, "positive")

    elif payload.startswith("no_followup_"):
        query_id = payload.replace("no_followup_", "")
        await handle_followup_response(phone, query_id, "negative")

    elif payload == "find_clinics":
        # Low-urgency user wants to find clinics — ask for location
        session = get_session(phone)
        if session:
            update_session(phone, step="awaiting_location_clinics")
        else:
            set_session(phone, flow="triage_low", step="awaiting_location_clinics", data={})
        await send_text(phone, (
            "📍 Share your *location* to find nearby clinics and pharmacies.\n\n"
            "Tap the + button and select *Location*."
        ))

    elif payload == "override_low_urgency":
        # User insists they need a hospital despite low urgency
        session = get_session(phone)
        data = session["data"] if session else {}
        description = data.get("description", "")
        parsed = data.get("parsed_requirements", {})
        # Upgrade urgency to medium and restart normal triage flow
        parsed["urgency"] = "medium"
        set_session(phone, flow="triage", step="awaiting_location", data={
            "description": description,
            "profile_name": data.get("profile_name", ""),
            "parsed_requirements": parsed,
        })
        await send_text(phone, (
            "Understood. We'll search for hospitals instead.\n\n"
            "📍 Share your *location* to find the nearest hospitals.\n\n"
            "Tap the + button and select *Location*."
        ))

    elif payload.startswith("override_urgency_"):
        # Hospital selected walk-in urgency level
        urgency = payload.replace("override_urgency_", "")  # critical, high, medium
        session = get_session(phone)
        if not session or session["flow"] != "override":
            await send_text(phone, "This override session has expired. Send OVERRIDE {code} to try again.")
            return
        handshake_id = session["data"].get("handshake_id")
        held_urgency = session["data"].get("held_urgency", "medium")

        from app.services.handshake_mgr import URGENCY_RANK
        walkin_rank = URGENCY_RANK.get(urgency, 2)
        held_rank = URGENCY_RANK.get(held_urgency, 2)

        if walkin_rank <= held_rank:
            # Walk-in is equal or lower priority — warn and confirm
            update_session(phone, step="confirm_override", data_updates={"walkin_urgency": urgency})
            await send_buttons(phone, (
                f"⚠️ *Warning:* The current bed hold is for a *{held_urgency.upper()}* urgency patient.\n"
                f"The walk-in is *{urgency.upper()}* urgency.\n\n"
                f"Are you sure you want to override?"
            ), [
                ("✅ Yes, override", "confirm_override_yes"),
                ("❌ Cancel", "confirm_override_no"),
            ])
        else:
            # Walk-in is higher priority — proceed directly
            clear_session(phone)
            await execute_override(phone, handshake_id, urgency)

    elif payload == "confirm_override_yes":
        session = get_session(phone)
        if not session or session["flow"] != "override":
            await send_text(phone, "This override session has expired.")
            return
        handshake_id = session["data"].get("handshake_id")
        urgency = session["data"].get("walkin_urgency", "critical")
        clear_session(phone)
        await execute_override(phone, handshake_id, urgency)

    elif payload == "confirm_override_no":
        clear_session(phone)
        await send_text(phone, "Override cancelled. The bed hold remains active.")

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

    elif session and session["flow"] == "decline_reason" and session["step"] == "select_reason":
        # Hospital selected a decline reason
        reason_id = list_reply
        handshake_id = session["data"].get("handshake_id")

        if reason_id == "other":
            # Ask for custom reason text
            update_session(phone, step="awaiting_custom_reason", data_updates={"reason_id": reason_id})
            await send_text(phone, "Please type your reason for declining:")
        else:
            clear_session(phone)
            await handle_handshake_decline_with_reason(phone, handshake_id, reason_id)

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
                parsed = session["data"].get("parsed_requirements")

                # Run enriched search with equipment filtering
                await run_search_and_send_results(
                    phone, lat, lng,
                    query_type="triage",
                    query_text=description,
                    required_equipment=parsed.get("required_equipment") if parsed else None,
                    bed_type=parsed["required_beds"][0] if parsed and parsed.get("required_beds") else None,
                )
            else:
                await send_text(phone, (
                    "📍 Please share your *location* so we can find "
                    "hospitals near you.\n\n"
                    "Tap the + button and select *Location*."
                ))
        elif step == "awaiting_selection":
            await send_text(phone, "Please reply with a number to select a hospital from the list above.")

    elif flow == "triage_low":
        if step == "awaiting_location_clinics":
            if lat is not None and lng is not None:
                print(f"   → Location for clinic search: {lat}, {lng}")
                await run_clinic_search_and_send(phone, lat, lng)
            else:
                await send_text(phone, (
                    "📍 Share your *location* to find nearby clinics.\n\n"
                    "Tap the + button and select *Location*."
                ))
        elif step == "awaiting_override":
            # User typed something while in low-urgency mode
            if lat is not None and lng is not None:
                # They shared location — find clinics
                await run_clinic_search_and_send(phone, lat, lng)
            else:
                await send_text(phone, (
                    "Reply with a number to select an option, "
                    "or share your *location* to find nearby clinics."
                ))

    elif flow == "handshake":
        if step == "awaiting_summary":
            print(f"   → Patient summary: '{body}'")
            await handle_handshake_create(phone, body, session)

    elif flow == "decline_reason":
        if step == "select_reason":
            # Hospital typed a reason instead of selecting from list
            await send_text(phone, "Please reply with a number to select a reason from the list above.")
        elif step == "awaiting_custom_reason":
            # Hospital typed their custom reason
            handshake_id = session["data"].get("handshake_id")
            clear_session(phone)
            await handle_handshake_decline_with_reason(phone, handshake_id, "other", custom_reason=body)

    elif flow == "override":
        if step == "awaiting_urgency":
            # Hospital typed instead of selecting from buttons
            await send_text(phone, "Please reply with a number to select the walk-in urgency level.")
        elif step == "confirm_override":
            # Hospital typed instead of tapping confirm/cancel
            await send_text(phone, "Please reply with a number to confirm or cancel the override.")

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

        # Phone number
        phone_num = r.get("phone")
        if phone_num:
            description += f" | ☎ {phone_num}"

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
# Clinic search for low-urgency cases
# ---------------------------------------------------------------------------

async def run_clinic_search_and_send(phone: str, lat: float, lng: float):
    """
    Find nearby clinics and pharmacies for low-urgency cases.
    Simpler than hospital search — no bed availability check, just distance + name + phone.
    """
    from app.services.search_engine import _parse_location, _haversine

    # Fetch clinics and pharmacies
    clinics = (
        supabase.table("hospitals")
        .select("id, name, address, phone, hospital_type, location")
        .eq("is_active", True)
        .in_("hospital_type", ["clinic", "pharmacy"])
        .execute()
    ).data

    # If no clinics in database, fall back to general hospitals
    if not clinics:
        clinics = (
            supabase.table("hospitals")
            .select("id, name, address, phone, hospital_type, location")
            .eq("is_active", True)
            .limit(10)
            .execute()
        ).data

    # Calculate distances and sort
    results = []
    for c in clinics:
        c_lat, c_lng = _parse_location(c.get("location"))
        if c_lat is None:
            continue
        dist = _haversine(lat, lng, c_lat, c_lng)
        if dist <= 20:  # 20km radius for clinics
            results.append({
                "name": c["name"],
                "address": c.get("address", ""),
                "phone": c.get("phone", ""),
                "type": c.get("hospital_type", "clinic"),
                "distance_km": round(dist, 1),
            })

    results.sort(key=lambda x: x["distance_km"])
    results = results[:5]

    if not results:
        await send_text(phone, (
            "😔 No clinics found nearby. If you need emergency care, "
            "reply *HOSPITAL* or send *EMERGENCY* to search for hospitals."
        ))
        clear_session(phone)
        return

    # Format as text message with directions links
    lines = ["🏥 *Nearby clinics and pharmacies:*\n"]
    for i, r in enumerate(results):
        line = f"{i+1}. *{r['name']}* — {r['distance_km']}km"
        if r.get("address"):
            line += f"\n   📍 {r['address']}"
        if r.get("phone"):
            line += f"\n   📞 {r['phone']}"
        # Google Maps directions link
        addr_encoded = r.get("address", r["name"] + " Lagos").replace(" ", "+")
        line += f"\n   🗺 https://maps.google.com/maps?daddr={addr_encoded}"
        lines.append(line)

    lines.append("\n_If symptoms worsen, seek medical attention immediately._")
    lines.append("\nReply *EMERGENCY* if you need hospital care.")

    await send_text(phone, "\n".join(lines))
    clear_session(phone)


# ---------------------------------------------------------------------------
# Override — hospital overrides a held bed for a walk-in
# ---------------------------------------------------------------------------

async def handle_override_start(phone: str, hospital: dict, body: str):
    """
    Hospital sends OVERRIDE {transfer_code}.
    Look up the handshake, then ask for walk-in urgency.
    """
    import re
    match = re.match(r"^override\s+([A-Z2-9]{6})$", body.strip(), re.IGNORECASE)

    if not match:
        await send_text(phone, (
            "Please use format: *OVERRIDE {transfer code}*\n\n"
            "Example: OVERRIDE K7M2X9\n\n"
            "The transfer code is the 6-character code from the bed request."
        ))
        return

    code = match.group(1).upper()
    hospital_id = hospital["id"]

    # Find the handshake
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("transfer_code", code)
        .eq("receiving_hospital_id", hospital_id)
        .eq("status", "accepted")
        .execute()
    )

    if not result.data:
        await send_text(phone, (
            f"No active bed hold found for code *{code}* at your hospital.\n"
            f"Only accepted (held) reservations can be overridden."
        ))
        return

    handshake = result.data[0]
    handshake_id = handshake["id"]

    # Try to get held patient's urgency
    held_urgency = "medium"
    query_id = handshake.get("query_id")
    if query_id:
        query = supabase.table("queries").select("parsed_requirements").eq("id", query_id).execute()
        if query.data and query.data[0].get("parsed_requirements"):
            parsed = query.data[0]["parsed_requirements"]
            if isinstance(parsed, dict):
                held_urgency = parsed.get("urgency", "medium")

    # Store in session and ask for walk-in urgency
    set_session(phone, flow="override", step="awaiting_urgency", data={
        "handshake_id": handshake_id,
        "transfer_code": code,
        "held_urgency": held_urgency,
    })

    await send_buttons(phone, (
        f"🔴 *Override bed hold — {code}*\n\n"
        f"Current hold: *{held_urgency.upper()}* urgency patient\n"
        f"Bed type: {handshake['bed_type'].upper()}\n\n"
        f"What is the walk-in patient's urgency level?"
    ), [
        ("🔴 Critical", "override_urgency_critical"),
        ("🟠 High", "override_urgency_high"),
        ("🟡 Medium", "override_urgency_medium"),
    ])


async def execute_override(phone: str, handshake_id: str, walkin_urgency: str):
    """Execute the override, notify both parties, and auto-reroute."""
    from app.services.handshake_mgr import override_handshake

    result = await override_handshake(handshake_id, walkin_urgency)

    if not result:
        await send_text(phone, "Override failed — the bed hold may have already expired or been completed.")
        return

    # Get hospital name
    detail = await get_handshake_detail(handshake_id)
    hospital_name = "the hospital"
    if detail:
        hospital_info = detail.get("_hospital", {})
        hospital_name = hospital_info.get("name", "the hospital")

    comparison = result.get("_urgency_comparison", "higher")
    flag = " ⚠️ (flagged: walk-in was equal or lower priority)" if comparison != "higher" else ""

    # Notify hospital
    await send_text(phone, (
        f"✅ Override executed for *{result.get('transfer_code', '')}*.{flag}\n\n"
        f"The held patient is being automatically rerouted to alternative hospitals."
    ))

    # Auto-reroute the displaced patient
    reroute_count = await reroute_displaced_patient(result, hospital_name)

    if reroute_count > 0:
        await send_text(phone, f"📋 {reroute_count} alternative hospital{'s' if reroute_count != 1 else ''} sent to the displaced patient.")


# ---------------------------------------------------------------------------
# Auto-reroute displaced patient after override
# ---------------------------------------------------------------------------

async def reroute_displaced_patient(overridden_handshake: dict, hospital_name: str):
    """
    After a bed hold is overridden, find alternatives for the displaced patient
    and notify them automatically.

    Uses the original query's location to search, excludes the overriding hospital.
    """
    requester_phone = overridden_handshake["requesting_party_phone"]
    overriding_hospital_id = overridden_handshake["receiving_hospital_id"]
    query_id = overridden_handshake.get("_query_id") or overridden_handshake.get("query_id")
    walkin_urgency = overridden_handshake.get("_walkin_urgency", "critical")

    # Notify the displaced patient
    await send_text(requester_phone, (
        f"⚠️ *We're sorry — your bed at {hospital_name} has been reassigned.*\n\n"
        f"A critical walk-in emergency required immediate care. "
        f"We understand this is frustrating and we're already "
        f"finding you another hospital.\n\n"
        f"No action needed — alternatives coming shortly."
    ))

    # Try to get the patient's original location from the query
    lat, lng = None, None
    if query_id:
        query = (
            supabase.table("queries")
            .select("user_location, query_text")
            .eq("id", query_id)
            .execute()
        )
        if query.data:
            from app.services.search_engine import _parse_location
            location = query.data[0].get("user_location")
            if location:
                lat, lng = _parse_location(location)

    if lat is None or lng is None:
        # Fallback: use the hospital's location as proxy
        hospital = (
            supabase.table("hospitals")
            .select("location")
            .eq("id", overriding_hospital_id)
            .execute()
        )
        if hospital.data:
            from app.services.search_engine import _parse_location
            lat, lng = _parse_location(hospital.data[0].get("location"))

    if lat is None or lng is None:
        # Can't determine location at all
        await send_text(requester_phone, (
            "We couldn't automatically find alternatives.\n"
            "Share your *location* or send *EMERGENCY* to search again."
        ))
        return 0

    # Run a new search excluding the overriding hospital
    from app.services.search_engine import search_nearby
    results, _ = await search_nearby(
        lat=lat, lng=lng, radius_km=20, limit=5,
    )

    # Filter out the hospital that overrode
    results = [r for r in results if r["hospital_id"] != overriding_hospital_id]

    if not results:
        await send_text(requester_phone, (
            "😔 No alternative hospitals found nearby.\n"
            "Share your *location* or send *EMERGENCY* to try a wider search."
        ))
        return 0

    # Format and send as a list
    options = []
    for i, r in enumerate(results[:5]):
        beds_text = ", ".join(
            f"{k.upper()}: {v['available']}"
            for k, v in r.get("beds", {}).items()
            if v.get("available", 0) > 0
        ) or "Check availability"

        options.append({
            "id": r["hospital_id"],
            "title": f"{i+1}. {r['name'][:20]}",
            "description": f"{r['distance_km']}km | {beds_text}",
        })

    # Set up a session so the displaced patient can select and create a new handshake
    set_session(requester_phone, flow="panic_mode", step="awaiting_selection", data={
        "query_id": query_id,
        "results": results,
    })

    count = len(options)
    await send_list(
        requester_phone,
        f"🏥 We found {count} alternative hospital{'s' if count != 1 else ''} for you:",
        options,
    )

    return count


# ---------------------------------------------------------------------------
# Handshake WhatsApp handlers
# ---------------------------------------------------------------------------

async def handle_handshake_create(phone: str, patient_summary: str, session: dict):
    """User provided patient summary. Create handshake and notify hospital."""
    data = session["data"]
    hospital_id = data.get("selected_hospital_id")
    query_id = data.get("query_id")

    if not hospital_id:
        await send_text(phone, "Something went wrong. Please start a new search by sending *EMERGENCY*.")
        clear_session(phone)
        return

    # Fetch hospital details
    hospital = (
        supabase.table("hospitals")
        .select("id, name, address, whatsapp_number, location")
        .eq("id", hospital_id)
        .execute()
    )
    if not hospital.data:
        await send_text(phone, "Hospital not found. Please try again.")
        clear_session(phone)
        return

    h = hospital.data[0]

    # Determine bed type (use first available from the hospital, or "emergency" as default)
    beds = (
        supabase.table("hospital_beds")
        .select("bed_type, available_count")
        .eq("hospital_id", hospital_id)
        .gt("available_count", 0)
        .order("available_count", desc=True)
        .limit(1)
        .execute()
    )
    bed_type = beds.data[0]["bed_type"] if beds.data else "emergency"

    # Create the handshake
    handshake = await create_handshake(
        receiving_hospital_id=hospital_id,
        bed_type=bed_type,
        requesting_party_type="individual",
        requesting_party_phone=phone,
        patient_summary=patient_summary,
        query_id=query_id,
        hold_duration_min=45,
    )

    transfer_code = handshake["transfer_code"]
    handshake_id = handshake["id"]

    # Notify the requester
    await send_text(phone, (
        f"🔄 *Bed hold request sent to {h['name']}*\n\n"
        f"Transfer code: *{transfer_code}*\n"
        f"Awaiting hospital confirmation...\n\n"
        f"We'll notify you when they respond."
    ))

    # Notify the receiving hospital
    hospital_phone = h["whatsapp_number"]
    bed_label = bed_type.upper()

    await send_buttons(hospital_phone, (
        f"🚨 *Incoming Patient — Bed Hold Request*\n\n"
        f"Bed needed: *{bed_label}*\n"
        f"Patient: {patient_summary}\n"
        f"Transfer code: *{transfer_code}*\n\n"
        f"Hold expires in 45 min if accepted."
    ), [
        ("✅ Accept", f"accept_handshake_{handshake_id}"),
        ("❌ Decline", f"decline_handshake_{handshake_id}"),
    ])

    clear_session(phone)


async def handle_handshake_accept(phone: str, handshake_id: str):
    """Hospital tapped Accept — confirm bed hold."""
    handshake = await accept_handshake(handshake_id)

    if not handshake:
        await send_text(phone, "This bed request has already been handled or expired.")
        return

    # Fetch full details for notifications
    detail = await get_handshake_detail(handshake_id)
    if not detail:
        return

    hospital_info = detail.get("_hospital", {})
    hospital_name = hospital_info.get("name", "the hospital")
    hospital_address = hospital_info.get("address", "")
    transfer_code = detail["transfer_code"]
    bed_type = detail["bed_type"].upper()
    hold_minutes = detail.get("hold_duration_min", 45)
    requester_phone = detail["requesting_party_phone"]

    # Google Maps link
    from app.services.search_engine import _parse_location
    h_lat, h_lng = _parse_location(hospital_info.get("location"))
    maps_link = ""
    if h_lat and h_lng:
        maps_link = f"\n📍 https://maps.google.com/maps?daddr={h_lat},{h_lng}"

    # Notify the hospital (confirmation)
    await send_text(phone, (
        f"✅ *Bed hold confirmed*\n\n"
        f"Transfer code: *{transfer_code}*\n"
        f"Bed type: {bed_type}\n"
        f"Hold expires in {hold_minutes} minutes.\n\n"
        f"Patient should show the transfer code on arrival."
    ))

    # Notify the requester
    await send_text(requester_phone, (
        f"✅ *Bed confirmed at {hospital_name}!*\n\n"
        f"Bed type: {bed_type}\n"
        f"Address: {hospital_address}\n"
        f"Transfer code: *{transfer_code}*\n"
        f"Bed held for {hold_minutes} minutes.\n\n"
        f"Show the transfer code on arrival.{maps_link}"
    ))


async def handle_handshake_decline_with_reason(phone: str, handshake_id: str, reason_id: str, custom_reason: str = None):
    """Hospital selected a decline reason — decline and notify patient with reason."""

    REASON_LABELS = {
        "no_beds": "All beds are currently occupied.",
        "wrong_specialty": "This hospital doesn\u2019t have the specialty you need.",
        "equipment_unavailable": "Required equipment is currently unavailable.",
        "too_severe": "Your condition needs a higher-level facility. We\u2019re searching for one.",
        "too_minor": "Your condition may not need hospital care.",
        "other": None,
    }

    reason_text = REASON_LABELS.get(reason_id)
    if reason_id == "other":
        reason_text = custom_reason or "The hospital could not accommodate this request."

    decline_stored = custom_reason if reason_id == "other" else reason_id
    handshake = await decline_handshake(handshake_id, decline_stored)

    if not handshake:
        await send_text(phone, "This bed request has already been handled or expired.")
        return

    detail = await get_handshake_detail(handshake_id)
    if not detail:
        return

    hospital_info = detail.get("_hospital", {})
    hospital_name = hospital_info.get("name", "the hospital")
    requester_phone = detail["requesting_party_phone"]

    # Notify hospital
    await send_text(phone, f"Noted. Bed request *{detail['transfer_code']}* declined — {reason_id.replace('_', ' ')}.")

    # Notify requester with reason
    if reason_id == "too_minor":
        # Redirect to clinics — try to find clinics near the hospital as fallback location
        await send_text(requester_phone, (
            f"\u274c *{hospital_name}* could not hold a bed.\n"
            f"Reason: {reason_text}\n\n"
            f"\U0001f3e5 We recommend visiting a nearby clinic instead.\n"
            f"Searching for clinics near you..."
        ))

        # Get hospital location as a proxy for patient location
        h_location = hospital_info.get("location")
        if h_location:
            from app.services.search_engine import _parse_location
            h_lat, h_lng = _parse_location(h_location)
            if h_lat:
                await run_clinic_search_and_send(requester_phone, h_lat, h_lng)
            else:
                await send_text(requester_phone, "Share your *location* to find nearby clinics.")
        else:
            await send_text(requester_phone, "Share your *location* to find nearby clinics.")

    elif reason_id == "too_severe":
        # Suggest higher-level facility
        await send_text(requester_phone, (
            f"\u274c *{hospital_name}* could not hold a bed.\n"
            f"Reason: {reason_text}\n\n"
            f"Send *EMERGENCY* to search for a higher-level facility."
        ))
    else:
        await send_text(requester_phone, (
            f"\u274c *{hospital_name}* could not hold a bed.\n"
            f"Reason: {reason_text}\n\n"
            f"Send *EMERGENCY* to search for other available hospitals."
        ))


async def handle_transfer_code_completion(phone: str, hospital: dict, code: str):
    """
    Hospital typed a transfer code — patient has arrived.
    Look up the handshake by code, verify it belongs to this hospital.

    Handles two scenarios:
      - Status "accepted": patient arriving during hold → complete it
      - Status "requested": hospital typing code instead of tapping Accept
        (patient is already here) → accept AND complete in one step
    """
    hospital_id = hospital["id"]
    hospital_name = hospital["name"]

    # Find the handshake by transfer code — check both accepted and requested
    print(f"   🔍 Looking up: code={code} hospital_id={hospital_id[:8]}")

    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("transfer_code", code)
        .eq("receiving_hospital_id", hospital_id)
        .execute()
    )

    print(f"   🔍 Found {len(result.data)} handshakes")
    if result.data:
        print(f"   🔍 Status: {result.data[0]['status']}")

    # Filter to actionable statuses
    actionable = [h for h in result.data if h["status"] in ("accepted", "requested")]

    if not actionable:
        if result.data:
            # Found handshake but wrong status (already completed/expired/declined)
            status = result.data[0]["status"]
            await send_text(phone, f"This transfer code (*{code}*) has already been {status}.")
        else:
            # No handshake found at all — maybe not a transfer code
            await handle_unknown(phone, hospital)
        return

    handshake = actionable[0]
    handshake_id = handshake["id"]
    requester_phone = handshake["requesting_party_phone"]
    current_status = handshake["status"]

    # If still requested, accept it first (patient is already here)
    if current_status == "requested":
        await accept_handshake(handshake_id)

    # Complete it
    completed = await complete_handshake(handshake_id, code)
    if not completed:
        await send_text(phone, f"Could not complete handshake for code *{code}*. It may have already been completed or expired.")
        return

    # Notify hospital
    await send_text(phone, (
        f"🏁 *Patient arrived — code {code} confirmed*\n\n"
        f"Bed hold at {hospital_name} is now complete.\n"
        f"Thank you for using BedSignal."
    ))

    # Notify requester
    await send_text(requester_phone, (
        f"🏁 *Arrival confirmed at {hospital_name}*\n\n"
        f"Your transfer code {code} has been verified.\n"
        f"Wishing a speedy recovery."
    ))


async def handle_followup_response(phone: str, query_id: str, signal_value: str):
    """Handle Yes/No response to Ghost Bed Detection follow-up."""
    from app.services.verification import handle_verification_response

    result = await handle_verification_response(query_id, signal_value, reporter_phone=phone)

    if signal_value == "positive":
        await send_text(phone, "Thank you. Glad you got the care you needed. 🙏")
    else:
        # Fetch hospital name for the message
        query = (
            supabase.table("queries")
            .select("selected_hospital_id")
            .eq("id", query_id)
            .execute()
        )
        hospital_name = "the hospital"
        if query.data and query.data[0].get("selected_hospital_id"):
            hospital = (
                supabase.table("hospitals")
                .select("name")
                .eq("id", query.data[0]["selected_hospital_id"])
                .execute()
            )
            if hospital.data:
                hospital_name = hospital.data[0]["name"]

        await send_text(phone, (
            f"Sorry to hear that. This has been flagged and will "
            f"affect {hospital_name}'s accuracy score.\n\n"
            f"Thank you for helping keep BedSignal data accurate."
        ))


# ---------------------------------------------------------------------------
# User-side handlers
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
    """
    Default — natural language → Claude parses → urgency gating.
    
    Low urgency:    Show self-care advice + clinic suggestions (no hospital search)
    Medium urgency: Ask for location, but prepend advisory when results come back
    High/Critical:  Full hospital search as normal
    """
    print(f"🧠 TRIAGE: {phone} — '{description[:60]}'")

    # Parse with Claude (or cache)
    from app.services.triage import parse_emergency
    parsed = await parse_emergency(description)
    urgency = parsed.get("urgency", "medium")

    # Format the analysis
    condition = parsed["condition_category"].replace("_", " ").title()
    equipment_readable = ", ".join(
        eq.replace("_", " ").title() for eq in parsed.get("required_equipment", [])
    )
    specialists_readable = ", ".join(
        sp.replace("_", " ").title() for sp in parsed.get("required_specialists", [])
    )

    # ── LOW URGENCY: clinic redirect ──────────────────
    if urgency == "low":
        print(f"   → Low urgency — redirecting to clinics")

        # Self-care advice
        self_care = parsed.get("self_care_advice", [])
        advice_text = ""
        if self_care:
            advice_text = "\n".join(f"  • {tip}" for tip in self_care)
            advice_text = f"\n💊 *Self-care suggestions:*\n{advice_text}\n"

        # Store parsed data in session for potential override
        set_session(phone, flow="triage_low", step="awaiting_override", data={
            "description": description,
            "profile_name": profile_name,
            "parsed_requirements": parsed,
        })

        await send_buttons(phone, (
            f"🧠 *BedSignal analyzed your situation:*\n\n"
            f"Likely: *{condition}*\n"
            f"Urgency: *{urgency.upper()}*\n\n"
            f"Based on your description, this may not require "
            f"emergency hospital care.{advice_text}\n"
            f"🏥 We recommend visiting a nearby clinic or pharmacy.\n\n"
            f"📍 Share your *location* to find nearby clinics.\n\n"
            f"If you believe this is more serious, tap below."
        ), [
            ("📍 Find nearby clinics", "find_clinics"),
            ("🚨 I still need a hospital", "override_low_urgency"),
        ])
        return

    # ── MEDIUM / HIGH / CRITICAL: normal flow ─────────
    analysis_parts = [f"🧠 *BedSignal analyzed your emergency:*\n"]
    analysis_parts.append(f"Likely: *{condition}*")
    analysis_parts.append(f"Urgency: *{urgency.upper()}*")
    if equipment_readable:
        analysis_parts.append(f"Needs: {equipment_readable}")
    if specialists_readable:
        analysis_parts.append(f"Specialists: {specialists_readable}")

    # Medium urgency advisory
    if urgency == "medium":
        analysis_parts.append(f"\n⚠️ _Consider visiting a clinic if this is not urgent._")

    analysis_parts.append(f"\n📍 Share your *location* for the nearest matches.")
    analysis_parts.append("Tap the + button and select *Location*.")

    # Store parsed requirements in session
    set_session(phone, flow="triage", step="awaiting_location", data={
        "description": description,
        "profile_name": profile_name,
        "parsed_requirements": parsed,
    })

    await send_text(phone, "\n".join(analysis_parts))