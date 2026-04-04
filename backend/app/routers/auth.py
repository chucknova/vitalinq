"""
Auth API — signup, login, profile management.

POST /api/auth/signup     — create account + profile
POST /api/auth/login      — login and get token
GET  /api/auth/me         — get current user profile
POST /api/auth/link-hospital    — link user to a hospital
POST /api/auth/link-dispatch    — link user to a dispatch company
"""

from time import monotonic
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.database import (
    supabase,
    execute_async,
    auth_sign_in_with_password_async,
    auth_sign_up_async,
)
from app.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])

ME_CACHE_TTL_SEC = 30.0
_me_cache: dict[str, tuple[float, dict]] = {}


def _entity_cache_key(user: dict) -> str:
    return ":".join([
        user.get("id", ""),
        user.get("role", ""),
        user.get("hospital_id") or "",
        user.get("dispatch_company_id") or "",
    ])


def _get_cached_me(user: dict) -> dict | None:
    cache_key = _entity_cache_key(user)
    cached = _me_cache.get(cache_key)
    if not cached:
        return None

    expires_at, payload = cached
    now = monotonic()
    if expires_at <= now:
        _me_cache.pop(cache_key, None)
        return None

    return dict(payload)


def _set_cached_me(user: dict, payload: dict):
    now = monotonic()
    expired_keys = [key for key, (expires_at, _) in _me_cache.items() if expires_at <= now]
    for key in expired_keys:
        _me_cache.pop(key, None)
    _me_cache[_entity_cache_key(user)] = (now + ME_CACHE_TTL_SEC, dict(payload))


class SignupRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    role: str = "hospital_admin"  # hospital_admin or dispatch_manager
    hospital_id: Optional[str] = None
    dispatch_company_id: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class LinkHospitalRequest(BaseModel):
    hospital_id: str


class LinkDispatchRequest(BaseModel):
    dispatch_company_id: str


# ---------------------------------------------------------------------------
# POST /api/auth/signup
# ---------------------------------------------------------------------------

@router.post("/signup")
async def signup(request: SignupRequest):
    """Create a new user account and profile."""

    # Validate role
    if request.role not in ("hospital_admin", "dispatch_manager"):
        raise HTTPException(status_code=400, detail="Role must be 'hospital_admin' or 'dispatch_manager'")

    # Validate entity linkage
    if request.role == "hospital_admin" and request.hospital_id:
        h = await execute_async(supabase.table("hospitals").select("id, name").eq("id", request.hospital_id))
        if not h.data:
            raise HTTPException(status_code=400, detail="Hospital not found")

    if request.role == "dispatch_manager" and request.dispatch_company_id:
        d = await execute_async(supabase.table("dispatch_companies").select("id, name").eq("id", request.dispatch_company_id))
        if not d.data:
            raise HTTPException(status_code=400, detail="Dispatch company not found")

    try:
        # Create the Supabase auth user
        auth_response = await auth_sign_up_async({
            "email": request.email,
            "password": request.password,
        })

        if not auth_response.user:
            raise HTTPException(status_code=400, detail="Signup failed — email may already be registered")

        user_id = auth_response.user.id

        # Create the profile
        await execute_async(supabase.table("profiles").insert({
            "id": user_id,
            "email": request.email,
            "full_name": request.full_name,
            "role": request.role,
            "hospital_id": request.hospital_id,
            "dispatch_company_id": request.dispatch_company_id,
        }))

        print(f"✅ AUTH: New {request.role} account: {request.email}")

        # Return the session token
        session = auth_response.session
        return {
            "user_id": user_id,
            "email": request.email,
            "role": request.role,
            "access_token": session.access_token if session else None,
            "refresh_token": session.refresh_token if session else None,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ AUTH: Signup failed: {e}")
        raise HTTPException(status_code=400, detail=f"Signup failed: {str(e)}")


# ---------------------------------------------------------------------------
# POST /api/auth/login
# ---------------------------------------------------------------------------

@router.post("/login")
async def login(request: LoginRequest):
    """Login and get access token."""
    try:
        auth_response = await auth_sign_in_with_password_async({
            "email": request.email,
            "password": request.password,
        })

        if not auth_response.user:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        user_id = auth_response.user.id

        # Get profile
        profile = await execute_async(supabase.table("profiles").select("*").eq("id", user_id))
        if not profile.data:
            raise HTTPException(status_code=403, detail="No profile found")

        p = profile.data[0]
        session = auth_response.session

        # Get linked entity name
        entity_name = None
        entity_slug = None
        if p.get("hospital_id"):
            h = await execute_async(supabase.table("hospitals").select("name, slug").eq("id", p["hospital_id"]))
            if h.data:
                entity_name = h.data[0]["name"]
                entity_slug = h.data[0]["slug"]
        elif p.get("dispatch_company_id"):
            d = await execute_async(supabase.table("dispatch_companies").select("name, slug").eq("id", p["dispatch_company_id"]))
            if d.data:
                entity_name = d.data[0]["name"]
                entity_slug = d.data[0]["slug"]

        return {
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "user": {
                "id": user_id,
                "email": p["email"],
                "full_name": p.get("full_name", ""),
                "role": p["role"],
                "hospital_id": p.get("hospital_id"),
                "dispatch_company_id": p.get("dispatch_company_id"),
                "entity_name": entity_name,
                "entity_slug": entity_slug,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ AUTH: Login failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")


# ---------------------------------------------------------------------------
# GET /api/auth/me
# ---------------------------------------------------------------------------

@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get the current user's profile."""
    cached = _get_cached_me(user)
    if cached is not None:
        return cached

    # Enrich with entity info
    entity_name = None
    entity_slug = None
    if user.get("hospital_id"):
        h = await execute_async(supabase.table("hospitals").select("name, slug").eq("id", user["hospital_id"]))
        if h.data:
            entity_name = h.data[0]["name"]
            entity_slug = h.data[0]["slug"]
    elif user.get("dispatch_company_id"):
        d = await execute_async(supabase.table("dispatch_companies").select("name, slug").eq("id", user["dispatch_company_id"]))
        if d.data:
            entity_name = d.data[0]["name"]
            entity_slug = d.data[0]["slug"]

    payload = {
        "id": user["id"],
        "email": user["email"],
        "full_name": user.get("full_name", ""),
        "role": user["role"],
        "hospital_id": user.get("hospital_id"),
        "dispatch_company_id": user.get("dispatch_company_id"),
        "entity_name": entity_name,
        "entity_slug": entity_slug,
    }
    _set_cached_me(user, payload)
    return payload


# ---------------------------------------------------------------------------
# POST /api/auth/link-hospital — link user to a hospital
# ---------------------------------------------------------------------------

@router.post("/link-hospital")
async def link_hospital(request: LinkHospitalRequest, user: dict = Depends(get_current_user)):
    """Link the current user to a hospital (for hospital admins)."""
    h = await execute_async(supabase.table("hospitals").select("id, name").eq("id", request.hospital_id))
    if not h.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    await execute_async(supabase.table("profiles").update({
        "hospital_id": request.hospital_id,
        "role": "hospital_admin",
    }).eq("id", user["id"]))

    return {"linked": True, "hospital": h.data[0]["name"]}


# ---------------------------------------------------------------------------
# POST /api/auth/link-dispatch — link user to a dispatch company
# ---------------------------------------------------------------------------

@router.post("/link-dispatch")
async def link_dispatch(request: LinkDispatchRequest, user: dict = Depends(get_current_user)):
    """Link the current user to a dispatch company."""
    d = await execute_async(supabase.table("dispatch_companies").select("id, name").eq("id", request.dispatch_company_id))
    if not d.data:
        raise HTTPException(status_code=404, detail="Dispatch company not found")

    await execute_async(supabase.table("profiles").update({
        "dispatch_company_id": request.dispatch_company_id,
        "role": "dispatch_manager",
    }).eq("id", user["id"]))

    return {"linked": True, "company": d.data[0]["name"]}
