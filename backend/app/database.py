"""
Supabase client — single instance shared across the entire app.

Usage anywhere:
    from app.database import supabase

    result = supabase.table("hospitals").select("*, location::text").execute()
"""

import asyncio
from time import perf_counter
from supabase import create_client
from app.config import settings
from app.telemetry import record_db_time

supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


async def execute_async(query):
    """Run a blocking Supabase query builder in a worker thread."""
    started = perf_counter()
    try:
        return await asyncio.to_thread(query.execute)
    finally:
        record_db_time((perf_counter() - started) * 1000)


async def auth_get_user_async(token: str):
    """Run blocking Supabase auth token verification off the event loop."""
    started = perf_counter()
    try:
        return await asyncio.to_thread(supabase.auth.get_user, token)
    finally:
        record_db_time((perf_counter() - started) * 1000)


async def auth_sign_up_async(payload: dict):
    """Run blocking Supabase signup off the event loop."""
    started = perf_counter()
    try:
        return await asyncio.to_thread(supabase.auth.sign_up, payload)
    finally:
        record_db_time((perf_counter() - started) * 1000)


async def auth_sign_in_with_password_async(payload: dict):
    """Run blocking Supabase password login off the event loop."""
    started = perf_counter()
    try:
        return await asyncio.to_thread(supabase.auth.sign_in_with_password, payload)
    finally:
        record_db_time((perf_counter() - started) * 1000)
