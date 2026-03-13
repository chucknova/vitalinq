"""
WhatsApp message sender — helpers for sending different message types via Twilio.

All messages are sent asynchronously via the Twilio Messages API.
The webhook never returns message content — it always returns empty 200 OK.

Three message types:
  1. Plain text     — simple text message
  2. Button message — text + up to 3 tappable buttons
  3. List message   — text + dropdown with up to 10 selectable options

IMPORTANT: Buttons and list messages require Twilio Content Templates.
See the setup guide at the bottom of this file for how to create them
in Twilio Console → Content Editor.

Usage:
    from app.services.whatsapp import send_text, send_buttons, send_list

    await send_text("+2348012345678", "Hello from BedSignal!")
    await send_buttons("+234...", "Accept this bed?", [
        ("✅ Accept", "accept_handshake_uuid"),
        ("❌ Decline", "decline_handshake_uuid"),
    ])
"""

from twilio.rest import Client
from app.config import settings

# ---------------------------------------------------------------------------
# Dry run mode — logs messages to terminal instead of sending via Twilio.
# Add DRY_RUN=true to your .env to enable.
# Saves your Twilio message quota for the actual demo.
# ---------------------------------------------------------------------------
DRY_RUN = getattr(settings, "DRY_RUN", "false").lower() in ("true", "1", "yes")

# ---------------------------------------------------------------------------
# Twilio client — single instance
# ---------------------------------------------------------------------------
client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
FROM_NUMBER = settings.TWILIO_WHATSAPP_NUMBER  # "whatsapp:+14155238886"

if DRY_RUN:
    print("⚠️  WhatsApp DRY RUN mode — messages will be logged, not sent")


# ---------------------------------------------------------------------------
# Helper: format the "to" number
# ---------------------------------------------------------------------------
def _to_whatsapp(phone: str) -> str:
    """Ensure phone is in whatsapp:+234... format."""
    phone = phone.strip()
    if not phone.startswith("whatsapp:"):
        phone = f"whatsapp:{phone}"
    return phone


# ---------------------------------------------------------------------------
# 1. Plain text message
# ---------------------------------------------------------------------------

async def send_text(to: str, body: str):
    """
    Send a simple text message via WhatsApp.

    This is the most common message type — used for confirmations,
    status displays, error messages, etc.
    """
    if DRY_RUN:
        print(f"\n📤 DRY RUN → {to}")
        print(f"{'─' * 50}")
        print(body)
        print(f"{'─' * 50}\n")
        return None

    try:
        message = client.messages.create(
            body=body,
            from_=FROM_NUMBER,
            to=_to_whatsapp(to),
        )
        print(f"📤 Text to {to}: {body[:80]}... [sid: {message.sid}]")
        return message
    except Exception as e:
        print(f"❌ Failed to send text to {to}: {e}")
        return None


# ---------------------------------------------------------------------------
# 2. Button message (up to 3 buttons)
#
# WhatsApp buttons require a Content Template created in Twilio Console.
# However, for the hackathon sandbox, we can use a workaround:
# send buttons as numbered options in plain text, then handle
# numeric replies ("1", "2", "3") in the router.
#
# This approach works WITHOUT content templates and is faster to set up.
# The user experience is slightly less polished but functionally identical.
# ---------------------------------------------------------------------------

async def send_buttons(to: str, body: str, buttons: list[tuple[str, str]]):
    """
    Send a message with button-like options.

    Args:
        to:      Phone number
        body:    Message text
        buttons: List of (label, payload) tuples, max 3

    For the hackathon, this sends numbered options as text.
    The router handles numeric replies by mapping them back to payloads.

    Example:
        send_buttons(phone, "Accept this bed?", [
            ("✅ Accept", "accept_handshake_123"),
            ("❌ Decline", "decline_handshake_123"),
        ])

    User sees:
        Accept this bed?

        Reply:
        1. ✅ Accept
        2. ❌ Decline
    """
    # Build the message with numbered options
    options_text = "\n".join(
        f"{i+1}. {label}" for i, (label, payload) in enumerate(buttons)
    )
    full_message = f"{body}\n\nReply:\n{options_text}"

    # Store the button mapping in a simple module-level cache
    # so the router can look up which payload "1" or "2" maps to
    _store_button_mapping(to, buttons)

    return await send_text(to, full_message)


async def send_buttons_content_api(
    to: str,
    content_sid: str,
    content_variables: dict,
):
    """
    Send a proper interactive button message using Twilio Content API.

    Use this if you've created Content Templates in Twilio Console.
    The content_sid is the template ID (starts with "HX").
    content_variables are the dynamic values to inject.

    Example:
        await send_buttons_content_api(
            phone,
            content_sid="HXXXXXXXXXXX",
            content_variables={"1": "LASUTH", "2": "K7M2X9"},
        )
    """
    import json
    if DRY_RUN:
        print(f"\n📤 DRY RUN BUTTONS → {to} [template: {content_sid}]")
        print(f"   Variables: {content_variables}")
        return None

    try:
        message = client.messages.create(
            content_sid=content_sid,
            content_variables=json.dumps(content_variables),
            from_=FROM_NUMBER,
            to=_to_whatsapp(to),
        )
        print(f"📤 Buttons to {to} [template: {content_sid}, sid: {message.sid}]")
        return message
    except Exception as e:
        print(f"❌ Failed to send buttons to {to}: {e}")
        return None


# ---------------------------------------------------------------------------
# 3. List message (up to 10 options)
#
# Same approach as buttons — send as numbered text for the hackathon.
# Proper WhatsApp list messages require Content Templates.
# ---------------------------------------------------------------------------

async def send_list(
    to: str,
    body: str,
    options: list[dict],
    button_text: str = "View Options",
):
    """
    Send a message with a list of selectable options.

    Args:
        to:          Phone number
        body:        Header text
        options:     List of dicts with "id", "title", and optional "description"
        button_text: Label for the list button (not used in text fallback)

    Example:
        await send_list(phone, "Select a hospital:", [
            {"id": "uuid-1", "title": "LASUTH — 3.2km", "description": "ICU: 2 | Ward: 5"},
            {"id": "uuid-2", "title": "LUTH — 5.1km", "description": "ICU: 1 | Ward: 12"},
        ])

    User sees:
        Select a hospital:

        1. LASUTH — 3.2km
           ICU: 2 | Ward: 5
        2. LUTH — 5.1km
           ICU: 1 | Ward: 12

        Reply with a number to select.
    """
    lines = []
    for i, opt in enumerate(options):
        line = f"{i+1}. {opt['title']}"
        if opt.get("description"):
            line += f"\n   {opt['description']}"
        lines.append(line)

    options_text = "\n".join(lines)
    full_message = f"{body}\n\n{options_text}\n\nReply with a number to select."

    # Store mapping so router can resolve "1" → option id
    _store_list_mapping(to, options)

    return await send_text(to, full_message)


async def send_list_content_api(
    to: str,
    content_sid: str,
    content_variables: dict,
):
    """
    Send a proper interactive list message using Twilio Content API.
    Same as send_buttons_content_api but for list templates.
    """
    import json
    if DRY_RUN:
        print(f"\n📤 DRY RUN LIST → {to} [template: {content_sid}]")
        print(f"   Variables: {content_variables}")
        return None

    try:
        message = client.messages.create(
            content_sid=content_sid,
            content_variables=json.dumps(content_variables),
            from_=FROM_NUMBER,
            to=_to_whatsapp(to),
        )
        print(f"📤 List to {to} [template: {content_sid}, sid: {message.sid}]")
        return message
    except Exception as e:
        print(f"❌ Failed to send list to {to}: {e}")
        return None


# ---------------------------------------------------------------------------
# 4. Location request
# ---------------------------------------------------------------------------

async def send_location_request(to: str, body: str | None = None):
    """
    Ask the user to share their location.

    WhatsApp doesn't have a native "request location" message type via API,
    so we send a text prompt instructing them to share manually.
    """
    if body is None:
        body = (
            "📍 Share your location so we can find the nearest "
            "hospitals with available beds.\n\n"
            "Tap the + button (or 📎) and select *Location*."
        )
    return await send_text(to, body)


# ---------------------------------------------------------------------------
# Button/List mapping cache
#
# When we send numbered options as text, we need to remember which
# number maps to which payload/id. This cache is keyed by phone number
# and overwritten each time we send new options to that number.
# ---------------------------------------------------------------------------

_button_mappings: dict[str, list[tuple[str, str]]] = {}
_list_mappings: dict[str, list[dict]] = {}


def _store_button_mapping(phone: str, buttons: list[tuple[str, str]]):
    """Store button options so we can resolve numeric replies later."""
    phone = phone.replace("whatsapp:", "").strip()
    _button_mappings[phone] = buttons


def _store_list_mapping(phone: str, options: list[dict]):
    """Store list options so we can resolve numeric replies later."""
    phone = phone.replace("whatsapp:", "").strip()
    _list_mappings[phone] = options


def resolve_numeric_reply(phone: str, number: int) -> dict | None:
    """
    When a user replies "1", "2", etc., look up what that maps to.

    Returns:
        {"type": "button", "label": str, "payload": str}
        {"type": "list", "id": str, "title": str}
        None if no mapping found

    Usage in the router:
        if body.strip().isdigit():
            choice = resolve_numeric_reply(phone, int(body.strip()))
            if choice and choice["type"] == "button":
                await handle_button(phone, choice["payload"])
            elif choice and choice["type"] == "list":
                await handle_list_reply(phone, choice["id"])
    """
    phone = phone.replace("whatsapp:", "").strip()
    idx = number - 1  # Convert 1-based to 0-based

    # Check button mappings first
    if phone in _button_mappings:
        buttons = _button_mappings[phone]
        if 0 <= idx < len(buttons):
            label, payload = buttons[idx]
            return {"type": "button", "label": label, "payload": payload}

    # Check list mappings
    if phone in _list_mappings:
        options = _list_mappings[phone]
        if 0 <= idx < len(options):
            return {"type": "list", "id": options[idx]["id"], "title": options[idx]["title"]}

    return None


# ---------------------------------------------------------------------------
# SETUP GUIDE: Twilio Content Templates
# ---------------------------------------------------------------------------
#
# If you want proper interactive buttons/lists (not the text fallback),
# you need to create Content Templates in Twilio:
#
# 1. Go to Twilio Console → Messaging → Content Editor
#    (https://www.twilio.com/console/content)
#
# 2. Click "Create New" → choose "WhatsApp"
#
# 3. For a BUTTON template:
#    - Template name: e.g. "bedsignal_handshake_request"
#    - Body: "🚨 Incoming Patient — Bed Hold Request\n..."
#    - Add variables: {{1}} for hospital name, {{2}} for transfer code, etc.
#    - Add buttons: "✅ Accept" and "❌ Decline"
#    - Each button has an "id" that becomes the ButtonPayload
#
# 4. For a LIST template:
#    - Template name: e.g. "bedsignal_hospital_list"
#    - Body: "🏥 Hospitals found near you:"
#    - Add list items with id, title, description
#
# 5. After creating, note the Content SID (starts with "HX")
#
# 6. Use send_buttons_content_api() or send_list_content_api()
#    with the Content SID
#
# For the hackathon, the text fallback approach (send_buttons, send_list)
# works fine and requires zero template setup. Switch to Content API
# for a more polished demo if time permits.
# ---------------------------------------------------------------------------