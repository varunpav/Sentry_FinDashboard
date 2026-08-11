from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.notification import NotificationLog
from app.models.user import User
from app.schemas.notification import (
    NotificationLogEntry,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    NotificationRunResult,
)
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/preferences", response_model=NotificationPreferencesResponse)
def get_preferences(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> NotificationPreferencesResponse:
    prefs = notification_service.get_or_create_preferences(db, current_user.id)
    return NotificationPreferencesResponse.model_validate(prefs)


@router.put("/preferences", response_model=NotificationPreferencesResponse)
def put_preferences(
    payload: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPreferencesResponse:
    prefs = notification_service.update_preferences(db, current_user.id, payload.model_dump())
    return NotificationPreferencesResponse.model_validate(prefs)


@router.get("/log", response_model=list[NotificationLogEntry])
def get_log(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[NotificationLogEntry]:
    rows = (
        db.query(NotificationLog)
        .filter(NotificationLog.user_id == current_user.id)
        .order_by(NotificationLog.sent_at.desc())
        .limit(limit)
        .all()
    )
    return [NotificationLogEntry.model_validate(r) for r in rows]


@router.post("/run", response_model=NotificationRunResult)
def run(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> NotificationRunResult:
    counts = notification_service.evaluate_and_send(db, current_user)
    return NotificationRunResult(
        **counts, resend_configured=bool(get_settings().resend_api_key)
    )
