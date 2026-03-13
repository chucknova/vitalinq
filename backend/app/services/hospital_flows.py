"""
Hospital-side WhatsApp flow handlers.

These handle everything a hospital does via WhatsApp:
  - Check-In (6-hour proactive nudge with Still Accurate / Update Now / All Full)
  - Interactive bed update (multi-step: pick type → enter count → enter overflow → repeat)
  - STATUS keyword (view current data)
  - UPDATE keyword (start interactive update)
  - Free-text bed report fallback ("ICU: 2, Ward: 5")

Usage:
    These are called from the message router (app/services/router.py).
    Import them and replace the stubs.
"""

from datetime import datetime, timezone
from app.database import supabase
from app.services.sessions import set_session, update_session, clear_session, get_session
from app.services.whatsapp import send_text, send_buttons, send_list


# ---------------------------------------------------------------------------
# BED TYPE display names
# ---------------------------------------------------------------------------
BED_TYPE_LABELS = {
    "icu": "ICU",
    "ward": "Ward",
    "maternity": "Maternity",
    "emergency": "Emergency",
    "pediatric": "Pediatric",
    "surgical": "Surgical",
    "psychiatric": "Psychiatric",
}


# ---------------------------------------------------------------------------
# Helper: fetch a hospital's current bed data
# ---------------------------------------------------------------------------

def get_hospital_beds(hospital_id: str) -> list[dict]:
    """Fetch all bed records for a hospital."""
    return (
        supabase.table("hospital_beds")
        .select("*")
        .eq("hospital_id", hospital_id)
        .execute()
    ).data


def get_hospital_by_id(hospital_id: str) -> dict | None:
    """Fetch a hospital by ID."""
    result = (
        supabase.table("hospitals")
        .select("*")
        .eq("id", hospital_id)
        .execute()
    )
    return result.data[0] if result.data else None


# ---------------------------------------------------------------------------
# CHECK-IN message (sent by background scheduler every 6 hours)
# This is called from the scheduler, not from the router.
# ---------------------------------------------------------------------------

async def send_checkin_message(hospital_id: str):
    """
    Send the proactive 6-hour check-in to a hospital.
    Shows their current recorded data with three options:
      1. Still Accurate
      2. Update Now
      3. All Full
    """
    hospital = get_hospital_by_id(hospital_id)
    if not hospital:
        return

    beds = get_hospital_beds(hospital_id)
    phone = hospital["whatsapp_number"]
    name = hospital["name"]

    # Calculate hours since last report
    last_report = hospital.get("last_report_at")
    if last_report:
        if isinstance(last_report, str):
            last_report = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
        hours_ago = (datetime.now(timezone.utc) - last_report).total_seconds() / 3600
        hours_text = f"{hours_ago:.0f} hours ago"
    else:
        hours_text = "No reports yet"

    # Build bed summary lines
    bed_lines = []
    for bed in beds:
        bt = BED_TYPE_LABELS.get(bed["bed_type"], bed["bed_type"])
        avail = bed["available_count"] or 0
        overflow = bed["overflow_count"] or 0
        line = f"{bt}: {avail} available"
        if overflow > 0:
            line += f" ({overflow} overflow)"
        bed_lines.append(line)

    bed_summary = "\n".join(bed_lines) if bed_lines else "No bed data recorded"

    body = (
        f"🔔 *BedSignal Check-In for {name}*\n\n"
        f"Your current recorded availability:\n"
        f"{bed_summary}\n\n"
        f"Last updated: {hours_text}"
    )

    buttons = [
        ("✅ Still Accurate", f"still_accurate_{hospital_id}"),
        ("✏️ Update Now", f"update_now_{hospital_id}"),
        ("🚨 All Full", f"all_full_{hospital_id}"),
    ]

    await send_buttons(phone, body, buttons)

    # Update last_checkin_sent_at
    supabase.table("hospitals").update({
        "last_checkin_sent_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", hospital_id).execute()


# ---------------------------------------------------------------------------
# STILL ACCURATE — one-tap confirmation
# ---------------------------------------------------------------------------

async def handle_still_accurate(phone: str, hospital_id: str):
    """
    Hospital confirmed their data is still current.
    Refresh all timestamps — this counts as a fresh update.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Refresh hospital timestamps
    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    # Refresh all bed reported_at timestamps
    beds = get_hospital_beds(hospital_id)
    for bed in beds:
        supabase.table("hospital_beds").update({
            "reported_at": now,
        }).eq("id", bed["id"]).execute()

    await send_text(phone, (
        "✅ Confirmed. Your availability is still current.\n\n"
        "Next check-in in 6 hours."
    ))


# ---------------------------------------------------------------------------
# ALL FULL — zero out everything
# ---------------------------------------------------------------------------

async def handle_all_full(phone: str, hospital_id: str):
    """Set all beds to zero at this hospital."""
    now = datetime.now(timezone.utc).isoformat()

    hospital = get_hospital_by_id(hospital_id)
    name = hospital["name"] if hospital else "your hospital"

    beds = get_hospital_beds(hospital_id)
    for bed in beds:
        supabase.table("hospital_beds").update({
            "available_count": 0,
            "overflow_count": 0,
            "reported_at": now,
        }).eq("id", bed["id"]).execute()

    # Update hospital timestamps
    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    await send_text(phone, (
        f"⚠️ All beds marked as full at {name}.\n\n"
        "When beds become available, send *UPDATE* to start a quick update."
    ))


# ---------------------------------------------------------------------------
# UPDATE NOW / UPDATE keyword — start interactive bed update flow
# ---------------------------------------------------------------------------

async def handle_update_start(phone: str, hospital: dict):
    """
    Begin the interactive bed update flow.
    Sends a list of bed types for the nurse to pick from.
    """
    hospital_id = hospital["id"]
    name = hospital["name"]

    # Set session
    set_session(phone, flow="bed_update", step="select_type", data={
        "hospital_id": hospital_id,
        "hospital_name": name,
        "updated_types": [],
    })

    await send_bed_type_list(phone, hospital_id, exclude=[])


async def send_bed_type_list(phone: str, hospital_id: str, exclude: list[str]):
    """
    Send the bed type selection list.
    Excludes types already updated in this session.
    """
    beds = get_hospital_beds(hospital_id)

    options = []
    for bed in beds:
        bt = bed["bed_type"]
        if bt in exclude:
            continue

        label = BED_TYPE_LABELS.get(bt, bt)
        avail = bed["available_count"] or 0
        options.append({
            "id": bt,
            "title": label,
            "description": f"Currently: {avail} available",
        })

    if not options:
        await send_text(phone, "✅ All bed types have been updated this session!")
        clear_session(phone)
        return

    await send_list(
        phone,
        "Which bed type do you want to update?",
        options,
    )


# ---------------------------------------------------------------------------
# Bed update flow — step handlers
# ---------------------------------------------------------------------------

async def handle_bed_type_selected(phone: str, bed_type: str):
    """Nurse selected a bed type from the list. Ask for available count."""
    label = BED_TYPE_LABELS.get(bed_type, bed_type)

    update_session(phone, step="awaiting_available", data_updates={"bed_type": bed_type})

    await send_text(phone, (
        f"How many *{label}* beds are available right now?\n\n"
        "(Reply with a number)"
    ))


async def handle_available_count(phone: str, body: str, session: dict):
    """Nurse typed the available bed count. Validate and ask for overflow."""
    data = session["data"]
    bed_type = data.get("bed_type", "")
    label = BED_TYPE_LABELS.get(bed_type, bed_type)

    # Validate input
    try:
        count = int(body.strip())
        if count < 0:
            raise ValueError
    except ValueError:
        await send_text(phone, "Please reply with a number (e.g. 2 or 0)")
        return

    # Optional: check against total capacity
    hospital_id = data.get("hospital_id")
    if hospital_id:
        beds = get_hospital_beds(hospital_id)
        for bed in beds:
            if bed["bed_type"] == bed_type and bed.get("total_count", 0) > 0:
                if count > bed["total_count"]:
                    await send_text(phone, (
                        f"That's more than your total {label} capacity "
                        f"({bed['total_count']}). Please recheck."
                    ))
                    return

    update_session(phone, step="awaiting_overflow", data_updates={"available_count": count})

    await send_text(phone, (
        f"Any overflow capacity (corridor/extra beds) for {label}?\n\n"
        "(Reply with a number, or 0 if none)"
    ))


async def handle_overflow_count(phone: str, body: str, session: dict):
    """Nurse typed the overflow count. Save to database and ask to continue."""
    data = session["data"]

    # Validate
    try:
        overflow = int(body.strip())
        if overflow < 0:
            raise ValueError
    except ValueError:
        await send_text(phone, "Please reply with a number (e.g. 0)")
        return

    bed_type = data["bed_type"]
    available = data["available_count"]
    hospital_id = data["hospital_id"]
    hospital_name = data["hospital_name"]
    label = BED_TYPE_LABELS.get(bed_type, bed_type)
    now = datetime.now(timezone.utc).isoformat()

    # ── Upsert the bed record ─────────────────────────────────
    existing = (
        supabase.table("hospital_beds")
        .select("id")
        .eq("hospital_id", hospital_id)
        .eq("bed_type", bed_type)
        .execute()
    )

    bed_data = {
        "hospital_id": hospital_id,
        "bed_type": bed_type,
        "available_count": available,
        "overflow_count": overflow,
        "reported_by": f"WhatsApp ({phone[-4:] if len(phone) >= 4 else phone})",
        "reported_at": now,
    }

    if existing.data:
        supabase.table("hospital_beds").update(bed_data).eq(
            "id", existing.data[0]["id"]
        ).execute()
    else:
        supabase.table("hospital_beds").insert(bed_data).execute()

    # Update hospital timestamps
    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    # Track which types have been updated this session
    updated_types = data.get("updated_types", [])
    updated_types.append(bed_type)

    # ── Ask: update another? ──────────────────────────────────
    update_session(phone, step="awaiting_another", data_updates={
        "updated_types": updated_types,
        "overflow_count": overflow,
    })

    body_text = (
        f"✅ Updated {label} at {hospital_name}:\n"
        f"Available: {available} | Overflow: {overflow}\n\n"
        f"Update another bed type?"
    )

    await send_buttons(phone, body_text, [
        ("Yes", "update_another_yes"),
        ("No, all done", "update_another_no"),
    ])


async def handle_update_another_yes(phone: str):
    """Nurse wants to update another bed type."""
    session = get_session(phone)
    if not session:
        await send_text(phone, "Session expired. Send *UPDATE* to start a new update.")
        return

    data = session["data"]
    hospital_id = data["hospital_id"]
    updated_types = data.get("updated_types", [])

    # Reset step and send the list again, excluding already-updated types
    update_session(phone, step="select_type")
    await send_bed_type_list(phone, hospital_id, exclude=updated_types)


async def handle_update_another_no(phone: str):
    """Nurse is done updating. Send final summary."""
    session = get_session(phone)
    if not session:
        await send_text(phone, "✅ Update complete.")
        return

    data = session["data"]
    hospital_id = data["hospital_id"]
    hospital_name = data["hospital_name"]

    # Fetch the latest bed data for summary
    beds = get_hospital_beds(hospital_id)
    now_str = datetime.now(timezone.utc).strftime("%H:%M UTC")

    bed_lines = []
    for bed in beds:
        label = BED_TYPE_LABELS.get(bed["bed_type"], bed["bed_type"])
        avail = bed["available_count"] or 0
        overflow = bed["overflow_count"] or 0
        line = f"{label}: {avail} available"
        if overflow > 0:
            line += f", {overflow} overflow"
        bed_lines.append(line)

    summary = "\n".join(bed_lines)

    await send_text(phone, (
        f"✅ *Bed report complete for {hospital_name}*\n\n"
        f"{summary}\n\n"
        f"Updated: {now_str}\n"
        f"Next check-in in 6 hours.\n\n"
        f"Send *STATUS* anytime to see your current data.\n"
        f"Send *UPDATE* anytime to start a new update."
    ))

    clear_session(phone)


# ---------------------------------------------------------------------------
# STATUS keyword — show current data
# ---------------------------------------------------------------------------

async def handle_status(phone: str, hospital: dict):
    """Send the hospital their full current recorded data."""
    hospital_id = hospital["id"]
    name = hospital["name"]

    # Refresh full hospital data
    h = get_hospital_by_id(hospital_id)
    beds = get_hospital_beds(hospital_id)

    # Hours since last report
    last_report = h.get("last_report_at")
    if last_report:
        if isinstance(last_report, str):
            last_report = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
        hours_ago = (datetime.now(timezone.utc) - last_report).total_seconds() / 3600
        time_text = f"{last_report.strftime('%H:%M UTC')} ({hours_ago:.0f}h ago)"
    else:
        time_text = "Never"

    # Bed lines
    bed_lines = []
    for bed in beds:
        label = BED_TYPE_LABELS.get(bed["bed_type"], bed["bed_type"])
        avail = bed["available_count"] or 0
        overflow = bed["overflow_count"] or 0
        line = f"{label}: {avail} available"
        if overflow > 0:
            line += f", {overflow} overflow"
        bed_lines.append(line)

    summary = "\n".join(bed_lines) if bed_lines else "No bed data recorded"

    trust = h.get("trust_tier", "active")
    accuracy = h.get("accuracy_score", 0.5)

    await send_text(phone, (
        f"🏥 *{name}* — Current BedSignal Status\n\n"
        f"{summary}\n\n"
        f"Last updated: {time_text}\n"
        f"Trust tier: {trust}\n"
        f"Accuracy score: {accuracy*100:.0f}%\n\n"
        f"Send *UPDATE* to change your availability."
    ))


# ---------------------------------------------------------------------------
# FREE-TEXT BED REPORT fallback
# ---------------------------------------------------------------------------

BED_TYPE_ALIASES = {
    "mat": "maternity",
    "ped": "pediatric",
    "emerg": "emergency",
    "surg": "surgical",
}

async def handle_freetext_report(phone: str, hospital: dict, matches: list):
    """
    Parse and save a free-text bed report like "ICU: 2, Ward: 5".
    This is the fallback for nurses who type naturally.
    """
    hospital_id = hospital["id"]
    name = hospital["name"]
    now = datetime.now(timezone.utc).isoformat()

    updated = []

    for match in matches:
        bed_type_raw = match[0].lower()
        available = int(match[1])
        overflow = int(match[2]) if match[2] else 0

        bed_type = BED_TYPE_ALIASES.get(bed_type_raw, bed_type_raw)
        label = BED_TYPE_LABELS.get(bed_type, bed_type)

        # Upsert
        existing = (
            supabase.table("hospital_beds")
            .select("id")
            .eq("hospital_id", hospital_id)
            .eq("bed_type", bed_type)
            .execute()
        )

        bed_data = {
            "hospital_id": hospital_id,
            "bed_type": bed_type,
            "available_count": available,
            "overflow_count": overflow,
            "reported_by": f"WhatsApp freetext ({phone[-4:] if len(phone) >= 4 else phone})",
            "reported_at": now,
        }

        if existing.data:
            supabase.table("hospital_beds").update(bed_data).eq(
                "id", existing.data[0]["id"]
            ).execute()
        else:
            supabase.table("hospital_beds").insert(bed_data).execute()

        line = f"{label}: {available}"
        if overflow > 0:
            line += f" ({overflow} overflow)"
        updated.append(line)

    # Update hospital timestamps
    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    summary = "\n".join(updated)

    await send_text(phone, (
        f"✅ Bed report received for {name}:\n\n"
        f"{summary}\n\n"
        f"Updated: {datetime.now(timezone.utc).strftime('%H:%M UTC')}"
    ))


# ---------------------------------------------------------------------------
# UNKNOWN message from hospital
# ---------------------------------------------------------------------------

async def handle_unknown(phone: str, hospital: dict):
    """Hospital sent something we don't understand."""
    await send_text(phone, (
        "I didn't understand that.\n\n"
        "Send *UPDATE* to start an interactive update.\n"
        "Send *STATUS* to see your current data."
    ))