"""
Twilio webhook — single entry point for all incoming WhatsApp messages.

POST /api/webhooks/twilio/whatsapp

Receives form-encoded data from Twilio, validates the signature,
then passes everything to the message router for handling.
"""

from fastapi import APIRouter, Request, HTTPException, Form
from fastapi.responses import Response
from typing import Optional
from app.config import settings
from app.services.router import route_message

# Twilio signature validation
from twilio.request_validator import RequestValidator

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

# Initialize validator with your auth token
validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)


# ---------------------------------------------------------------------------
# Signature validation
# ---------------------------------------------------------------------------

async def verify_twilio_signature(request: Request) -> bool:
    """
    Check that the request actually came from Twilio, not someone
    spoofing your webhook URL.
    """
    if settings.APP_ENV == "development":
        return True

    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)

    form = await request.form()
    params = {key: form[key] for key in form}

    return validator.validate(url, params, signature)


# ---------------------------------------------------------------------------
# POST /api/webhooks/twilio/whatsapp
# ---------------------------------------------------------------------------

@router.post("/twilio/whatsapp")
async def whatsapp_webhook(
    request: Request,
    From: str = Form(default=""),
    Body: str = Form(default=""),
    Latitude: Optional[str] = Form(default=None),
    Longitude: Optional[str] = Form(default=None),
    ButtonPayload: Optional[str] = Form(default=None),
    ListReply: Optional[str] = Form(default=None),
    NumMedia: str = Form(default="0"),
    MediaUrl0: Optional[str] = Form(default=None),
    MediaContentType0: Optional[str] = Form(default=None),
    ProfileName: str = Form(default=""),
):
    """
    Receives all incoming WhatsApp messages from Twilio.
    Routes them to the appropriate handler via the message router.
    Returns empty 200 OK — all responses sent asynchronously via Twilio API.
    """

    # ── Validate signature ────────────────────────────────────
    is_valid = await verify_twilio_signature(request)
    if not is_valid:
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    # ── Clean up inputs ───────────────────────────────────────
    phone = From.replace("whatsapp:", "").strip()
    lat = float(Latitude) if Latitude else None
    lng = float(Longitude) if Longitude else None

    # ── Log the raw message ───────────────────────────────────
    print()
    print(f"📩 {phone} ({ProfileName}): {Body or '[no text]'}", end="")
    if ButtonPayload:
        print(f" [Button: {ButtonPayload}]", end="")
    if ListReply:
        print(f" [List: {ListReply}]", end="")
    if lat:
        print(f" [Location: {lat},{lng}]", end="")
    print()

    # ── Route the message ─────────────────────────────────────
    try:
        await route_message(
            phone=phone,
            body=Body,
            button_payload=ButtonPayload,
            list_reply=ListReply,
            lat=lat,
            lng=lng,
            profile_name=ProfileName,
        )
    except Exception as e:
        # Never let the webhook fail — Twilio retries on errors
        # and that causes duplicate messages
        print(f"❌ Router error: {e}")
        import traceback
        traceback.print_exc()

    # ── Return empty 200 OK ───────────────────────────────────
    return Response(content="", media_type="text/xml", status_code=200)
