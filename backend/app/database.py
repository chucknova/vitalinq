"""
Supabase client — single instance shared across the entire app.

Usage anywhere:
    from app.database import supabase

    result = supabase.table("hospitals").select("*").execute()
"""

from supabase import create_client
from app.config import settings

supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
