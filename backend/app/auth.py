"""
Authentication middleware for BedSignal.

Uses Supabase Auth JWTs. The frontend sends the token in the
Authorization header, and this module verifies it and checks
the user's role against the requested resource.

Usage:
    from app.auth import get_current_user, require_hospital_access, require_dispatch_access

    @router.get("/protected")
    async def protected_endpoint(user = Depends(get_current_user)):
        ...

    @router.get("/{slug}/data")
    async def hospital_endpoint(slug: str, user = Depends(require_hospital_access)):
        ...
"""

from time import monotonic
from fastapi import Depends, HTTPException, Request
from app.database import supabase, execute_async, auth_get_user_async
from app.config import settings

AUTH_CACHE_TTL_SEC = 30.0
_auth_profile_cache: dict[str, tuple[float, dict]] = {}


def _prune_auth_cache(now: float):
    expired_tokens = [
        token
        for token, (expires_at, _) in _auth_profile_cache.items()
        if expires_at <= now
    ]
    for token in expired_tokens:
        _auth_profile_cache.pop(token, None)


def _get_cached_profile(token: str) -> dict | None:
    now = monotonic()
    cached = _auth_profile_cache.get(token)
    if not cached:
        return None

    expires_at, profile = cached
    if expires_at <= now:
        _auth_profile_cache.pop(token, None)
        return None

    return dict(profile)


def _cache_profile(token: str, profile: dict):
    now = monotonic()
    _prune_auth_cache(now)
    _auth_profile_cache[token] = (now + AUTH_CACHE_TTL_SEC, dict(profile))


async def get_current_user(request: Request) -> dict:
    """
    Extract and verify the Supabase JWT from the Authorization header.
    Returns the user's profile (id, email, role, hospital_id, dispatch_company_id).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.replace("Bearer ", "")
    cached_profile = _get_cached_profile(token)
    if cached_profile is not None:
        return cached_profile

    try:
        # Verify the JWT with Supabase
        user_response = await auth_get_user_async(token)
        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user_id = user_response.user.id

        # Fetch the profile
        profile = await execute_async(
            supabase.table("profiles")
            .select("*")
            .eq("id", user_id)
        )

        if not profile.data:
            raise HTTPException(status_code=403, detail="No profile found. Please complete registration.")

        resolved_profile = profile.data[0]
        _cache_profile(token, resolved_profile)
        return dict(resolved_profile)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ AUTH: Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


def require_hospital_access(slug_param: str = "slug"):
    """
    Dependency that verifies the user is a hospital_admin
    and has access to the hospital identified by the slug.
    """
    async def _check(request: Request, user: dict = Depends(get_current_user)):
        if user["role"] not in ("hospital_admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Hospital admin access required")

        # Get the slug from the path
        slug = request.path_params.get(slug_param)
        if not slug:
            raise HTTPException(status_code=400, detail="Missing hospital slug")

        # Verify the user's hospital matches the slug
        if user.get("hospital_id"):
            hospital = await execute_async(
                supabase.table("hospitals")
                .select("id, slug")
                .eq("id", user["hospital_id"])
            )
            if hospital.data and hospital.data[0].get("slug") == slug:
                return user

        raise HTTPException(status_code=403, detail="You don't have access to this hospital")

    return _check


def require_dispatch_access(slug_param: str = "slug"):
    """
    Dependency that verifies the user is a dispatch_manager
    and has access to the dispatch company identified by the slug.
    """
    async def _check(request: Request, user: dict = Depends(get_current_user)):
        if user["role"] not in ("dispatch_manager", "super_admin"):
            raise HTTPException(status_code=403, detail="Dispatch manager access required")

        slug = request.path_params.get(slug_param)
        if not slug:
            raise HTTPException(status_code=400, detail="Missing dispatch slug")

        if user.get("dispatch_company_id"):
            company = await execute_async(
                supabase.table("dispatch_companies")
                .select("id, slug")
                .eq("id", user["dispatch_company_id"])
            )
            if company.data and company.data[0].get("slug") == slug:
                return user

        raise HTTPException(status_code=403, detail="You don't have access to this dispatch company")

    return _check


def require_any_auth():
    """Dependency that just requires the user to be logged in, any role."""
    async def _check(request: Request, user: dict = Depends(get_current_user)):
        return user
    return _check
