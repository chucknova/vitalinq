"""
WhatsApp conversation session manager.

Tracks multi-step flows per phone number. When a nurse is mid-way
through a bed update, the session remembers which bed type she picked
and what step she's on.

Key = phone number (e.g. "+2348012345678")
Value = {flow, step, data, created_at, expires_at}

Sessions auto-expire after 10 minutes of inactivity.
For the hackathon this is an in-memory dict (fine for a single server).
For production, swap this out for Redis.

Usage:
    from app.services.sessions import get_session, set_session, clear_session

    # Start a new flow
    set_session("+234...", flow="bed_update", step="select_type", data={"hospital_id": "uuid"})

    # Check if someone is mid-flow
    session = get_session("+234...")
    if session and session["flow"] == "bed_update":
        ...

    # Done with the flow
    clear_session("+234...")
"""

from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# The store — just a Python dict. That's it.
# ---------------------------------------------------------------------------
_sessions: dict[str, dict] = {}

# How long before a session expires if nobody interacts
SESSION_TIMEOUT_MINUTES = 10


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_session(phone: str) -> dict | None:
    """
    Get the current session for a phone number.
    Returns None if no session exists or it's expired.
    """
    session = _sessions.get(phone)

    if session is None:
        return None

    # Check expiry
    if datetime.now(timezone.utc) > session["expires_at"]:
        # Expired — clean it up and return nothing
        del _sessions[phone]
        return None

    return session


def set_session(phone: str, flow: str, step: str, data: dict | None = None) -> dict:
    """
    Create or update a session. Resets the expiry timer.

    Args:
        phone: The WhatsApp phone number (without "whatsapp:" prefix)
        flow:  Which conversation flow — "bed_update", "panic_mode", "triage", "handshake"
        step:  Current step within the flow — "select_type", "awaiting_available", etc.
        data:  Any accumulated data for this flow (hospital_id, bed_type, counts, etc.)

    Returns:
        The session dict.
    """
    now = datetime.now(timezone.utc)

    session = {
        "flow": flow,
        "step": step,
        "data": data or {},
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(minutes=SESSION_TIMEOUT_MINUTES),
    }

    _sessions[phone] = session
    return session


def update_session(phone: str, step: str = None, data_updates: dict = None) -> dict | None:
    """
    Update an existing session without replacing it entirely.
    Resets the expiry timer.

    Useful when you just need to advance the step or add a field
    to data without losing everything else.

    Returns None if no active session exists.
    """
    session = get_session(phone)
    if session is None:
        return None

    if step is not None:
        session["step"] = step

    if data_updates:
        session["data"].update(data_updates)

    # Reset expiry
    session["expires_at"] = datetime.now(timezone.utc) + timedelta(minutes=SESSION_TIMEOUT_MINUTES)

    _sessions[phone] = session
    return session


def clear_session(phone: str) -> None:
    """Remove a session entirely. Call this when a flow completes."""
    _sessions.pop(phone, None)


def get_all_sessions() -> dict[str, dict]:
    """
    Return all active sessions. Useful for debugging.
    Cleans up expired ones while iterating.
    """
    now = datetime.now(timezone.utc)
    expired = [phone for phone, s in _sessions.items() if now > s["expires_at"]]
    for phone in expired:
        del _sessions[phone]
    return dict(_sessions)
