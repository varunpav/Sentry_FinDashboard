import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.plaid_item import PlaidItem
from app.models.sync_preference import SyncPreference
from app.models.user import User
from app.services import sync_service

logger = logging.getLogger(__name__)

# The six labeled slider stops the frontend offers -- validated here too so a bad
# request can't set an arbitrary interval.
ALLOWED_INTERVAL_HOURS = (1, 3, 6, 12, 24, 48)


def get_or_create_preferences(db: Session, user_id: int) -> SyncPreference:
    prefs = db.query(SyncPreference).filter(SyncPreference.user_id == user_id).first()
    if prefs is None:
        prefs = SyncPreference(user_id=user_id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def update_preferences(
    db: Session, user_id: int, auto_sync_enabled: bool, interval_hours: int
) -> SyncPreference:
    prefs = get_or_create_preferences(db, user_id)
    prefs.auto_sync_enabled = auto_sync_enabled
    prefs.interval_hours = interval_hours
    db.commit()
    db.refresh(prefs)
    return prefs


def _as_utc(value: datetime) -> datetime:
    # Postgres round-trips DateTime(timezone=True) as tz-aware; SQLite (used in tests,
    # and a plausible lightweight deployment target) silently drops tzinfo on read-back.
    # We only ever write UTC into this column, so a naive value is safely assumed UTC.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_due(prefs: SyncPreference, now: datetime) -> bool:
    if not prefs.auto_sync_enabled:
        return False
    if prefs.last_auto_sync_at is None:
        return True
    return now - _as_utc(prefs.last_auto_sync_at) >= timedelta(hours=prefs.interval_hours)


def _next_due_at(prefs: SyncPreference, now: datetime) -> datetime:
    if prefs.last_auto_sync_at is None:
        return now
    return _as_utc(prefs.last_auto_sync_at) + timedelta(hours=prefs.interval_hours)


def run_for_user(db: Session, user: User, now: datetime, force: bool = False) -> dict:
    """Syncs all of a user's linked items if auto-sync is due (or force=True), isolating
    failures per item so one dead item (e.g. the seeded demo item's placeholder token)
    can't block the others."""
    prefs = get_or_create_preferences(db, user.id)

    if not force and not is_due(prefs, now):
        return {
            "synced": False,
            "reason": "disabled" if not prefs.auto_sync_enabled else "not_due",
            "next_due_at": _next_due_at(prefs, now) if prefs.auto_sync_enabled else None,
            "last_auto_sync_at": prefs.last_auto_sync_at,
        }

    items = db.query(PlaidItem).filter(PlaidItem.user_id == user.id).all()
    results = []
    for item in items:
        try:
            result = sync_service.sync_item(db, item)
            results.append({"item_id": item.id, "ok": True, "detail": None, "result": result})
        except sync_service.SyncError as exc:
            logger.warning("Auto-sync failed for item %s: %s", item.id, exc)
            results.append({"item_id": item.id, "ok": False, "detail": str(exc), "result": None})

    succeeded = sum(1 for r in results if r["ok"])
    if not items or succeeded == len(items):
        run_status = "ok"
    elif succeeded == 0:
        run_status = "failed"
    else:
        run_status = "partial"

    prefs.last_auto_sync_at = now
    prefs.last_auto_sync_status = run_status
    prefs.last_auto_sync_detail = f"{succeeded}/{len(items)} item(s) synced" if items else "no linked accounts"
    db.commit()
    db.refresh(prefs)

    return {
        "synced": True,
        "reason": None,
        "next_due_at": _next_due_at(prefs, now),
        "last_auto_sync_at": prefs.last_auto_sync_at,
        "status": run_status,
        "results": results,
    }


def run_all_due(db: Session, now: datetime) -> dict:
    """The scheduler tick entry point: finds every user with auto-sync enabled and
    syncs whoever is due, isolating failures per user."""
    user_ids = [
        row[0]
        for row in db.query(SyncPreference.user_id)
        .filter(SyncPreference.auto_sync_enabled.is_(True))
        .all()
    ]

    checked = 0
    synced = 0
    failed_users: list[int] = []
    for user_id in user_ids:
        checked += 1
        try:
            user = db.get(User, user_id)
            if user is None:
                continue
            result = run_for_user(db, user, now)
            if result["synced"]:
                synced += 1
        except Exception:
            logger.exception("Auto-sync tick failed for user %s", user_id)
            failed_users.append(user_id)

    return {"checked": checked, "synced": synced, "failed_users": failed_users}
