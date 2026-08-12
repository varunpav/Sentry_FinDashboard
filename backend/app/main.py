import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import SessionLocal
from app.routers import (
    auth,
    budgets,
    export,
    fraud,
    goals,
    insights,
    networth,
    notifications,
    plaid,
    recurring,
    sync,
    transactions,
)
from app.services import autosync_service

logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = BackgroundScheduler()


def _run_autosync_tick() -> None:
    """The scheduler's only job: ask autosync_service who's due and sync them. Runs
    in its own DB session since it's outside any request's get_db lifecycle. Never
    lets one bad tick kill future ticks -- APScheduler would otherwise drop the job
    after a few consecutive exceptions."""
    db = SessionLocal()
    try:
        summary = autosync_service.run_all_due(db, datetime.now(timezone.utc))
        if summary["checked"]:
            logger.info("Auto-sync tick: %s", summary)
    except Exception:
        logger.exception("Auto-sync tick crashed")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.scheduler_enabled:
        scheduler.add_job(
            _run_autosync_tick,
            "interval",
            minutes=settings.scheduler_tick_minutes,
            id="autosync_tick",
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Sentry API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(plaid.router)
app.include_router(transactions.router)
app.include_router(budgets.router)
app.include_router(fraud.router)
app.include_router(networth.router)
app.include_router(recurring.router)
app.include_router(notifications.router)
app.include_router(insights.router)
app.include_router(goals.router)
app.include_router(export.router)
app.include_router(sync.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
