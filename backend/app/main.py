"""
BedSignal API — main application entry point.

Run:
    uvicorn app.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.tasks.scheduler import start_scheduler, stop_scheduler
from app.routers import search, hospitals, webhooks, handshakes, onboard, log, dashboard, broadcast, transport


# ---------------------------------------------------------------------------
# Lifespan — runs on startup and shutdown
# This is where background tasks (APScheduler) will be started later.
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    print("🟢 BedSignal API starting up...")
    print(f"   Environment: {settings.APP_ENV}")
    print(f"   Frontend:    {settings.FRONTEND_URL}")
    start_scheduler()
    yield
    # ── Shutdown ──
    stop_scheduler()
    print("🔴 BedSignal API shutting down...")


# ---------------------------------------------------------------------------
# App instance
# ---------------------------------------------------------------------------
app = FastAPI(
    title="BedSignal API",
    description="Real-time hospital bed availability for Lagos",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# CORS — let the frontend talk to this backend
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "https://bedsignal.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/")
async def health_check():
    return {"status": "ok", "service": "bedsignal-api"}

# ---------------------------------------------------------------------------
# Routers will be added here as you build them:
#
# from app.routers import search, webhooks, handshakes, hospitals, dispatch
app.include_router(search.router, prefix="/api")
app.include_router(hospitals.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(handshakes.router, prefix="/api")
app.include_router(onboard.router, prefix="/api")
app.include_router(log.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(broadcast.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
# ---------------------------------------------------------------------------
