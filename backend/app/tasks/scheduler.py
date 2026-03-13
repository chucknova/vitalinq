"""
Background task scheduler — registers and runs all periodic tasks.

Tasks:
  - Handshake expiry checker (every 60 seconds)
  - More tasks will be added in Phases 7 and 10:
    - Ghost Bed Detection follow-ups (every 5 min)
    - Hospital check-in sender (every 15 min)
    - Freshness score updater (every 15 min)

Usage:
    Started and stopped via FastAPI's lifespan in app/main.py:

        from app.tasks.scheduler import start_scheduler, stop_scheduler

        @asynccontextmanager
        async def lifespan(app):
            start_scheduler()
            yield
            stop_scheduler()
"""

import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# The scheduler instance
scheduler = AsyncIOScheduler()


def start_scheduler():
    """Register all background tasks and start the scheduler."""

    # Import tasks here to avoid circular imports
    from app.tasks.expiry import check_expired_handshakes

    # ── Handshake expiry: every 60 seconds ────────────────────
    scheduler.add_job(
        check_expired_handshakes,
        trigger=IntervalTrigger(seconds=60),
        id="handshake_expiry",
        name="Check for expired handshakes",
        replace_existing=True,
    )

    # ── Future tasks (uncomment as you build them) ────────────
    #
    # from app.tasks.followup import send_followups
    # scheduler.add_job(
    #     send_followups,
    #     trigger=IntervalTrigger(minutes=5),
    #     id="ghost_bed_followup",
    #     name="Ghost Bed Detection follow-ups",
    #     replace_existing=True,
    # )
    #
    # from app.tasks.nudge import send_checkins
    # scheduler.add_job(
    #     send_checkins,
    #     trigger=IntervalTrigger(minutes=15),
    #     id="hospital_checkin",
    #     name="Hospital 6-hour check-in sender",
    #     replace_existing=True,
    # )
    #
    # from app.tasks.freshness import update_freshness_scores
    # scheduler.add_job(
    #     update_freshness_scores,
    #     trigger=IntervalTrigger(minutes=15),
    #     id="freshness_updater",
    #     name="Freshness score updater",
    #     replace_existing=True,
    # )

    scheduler.start()
    print("⏱️  Background scheduler started")
    print(f"   Jobs registered: {len(scheduler.get_jobs())}")
    for job in scheduler.get_jobs():
        print(f"   - {job.name} ({job.trigger})")


def stop_scheduler():
    """Shut down the scheduler gracefully."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("⏱️  Background scheduler stopped")
