"""
BedSignal API — main application entry point.

Run:
    uvicorn app.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs
"""

from contextlib import asynccontextmanager
from time import perf_counter
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.telemetry import (
    current_request_age_ms,
    get_request_metrics,
    reset_request_metrics,
    start_request_metrics,
)
from app.tasks.scheduler import start_scheduler, stop_scheduler
from app.routers import search, hospitals, webhooks, handshakes, onboard, log, dashboard, broadcast, transport, dispatch
from app.routers import auth as auth_router



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
    app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "https://bedsignal.vercel.app",
        "https://vitalinq.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_timing_middleware(request, call_next):
    token = start_request_metrics()
    request_started = perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception:
        raise
    finally:
        total_ms = (perf_counter() - request_started) * 1000
        metrics = get_request_metrics()
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        handler_name = getattr(getattr(route, "endpoint", None), "__name__", "unknown")

        if metrics is not None:
            age_ms = current_request_age_ms() or total_ms
            print(
                "⏱️ REQUEST"
                f" method={request.method}"
                f" path={route_path}"
                f" handler={handler_name}"
                f" status={status_code}"
                f" total_ms={total_ms:.1f}"
                f" age_ms={age_ms:.1f}"
                f" db_ms={metrics.db_time_ms:.1f}"
                f" db_calls={metrics.db_calls}"
                f" notify_ms={metrics.notification_time_ms:.1f}"
                f" notify_calls={metrics.notification_calls}"
            )
        else:
            print(
                "⏱️ REQUEST"
                f" method={request.method}"
                f" path={route_path}"
                f" handler={handler_name}"
                f" status={status_code}"
                f" total_ms={total_ms:.1f}"
            )

        reset_request_metrics(token)


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
app.include_router(auth_router.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(hospitals.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(handshakes.router, prefix="/api")
app.include_router(onboard.router, prefix="/api")
app.include_router(log.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(broadcast.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
app.include_router(dispatch.router, prefix="/api")
# ---------------------------------------------------------------------------
