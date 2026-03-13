"""
Application configuration loaded from environment variables.

Usage anywhere in the app:
    from app.config import settings
    print(settings.SUPABASE_URL)

Reads from backend/.env automatically.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    All environment variables in one place.
    Pydantic validates them on startup — if a required key is missing,
    the app crashes immediately with a clear error instead of failing
    mysteriously later.
    """

    model_config = SettingsConfigDict(
        env_file=".env",       # Reads from backend/.env
        env_file_encoding="utf-8",
        extra="ignore",        # Don't crash on extra env vars
    )

    # ── Supabase ──────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # ── Twilio ────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_WHATSAPP_NUMBER: str = "whatsapp:+14155238886"
    TWILIO_SMS_NUMBER: str = ""

    # ── Anthropic ─────────────────────────────────────────────
    ANTHROPIC_API_KEY: str

    # ── Google Maps (optional — needed for Dispatch ETA) ──────
    GOOGLE_MAPS_API_KEY: str = ""

    # ── App ───────────────────────────────────────────────────
    APP_ENV: str = "development"
    BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:5173"
    DRY_RUN: str = "false"


# Single instance — import this everywhere
settings = Settings()