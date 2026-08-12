from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.sync import AutoSyncRunResponse, SyncPreferencesResponse, SyncPreferencesUpdate
from app.services import autosync_service

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/preferences", response_model=SyncPreferencesResponse)
def get_preferences(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> SyncPreferencesResponse:
    prefs = autosync_service.get_or_create_preferences(db, current_user.id)
    return SyncPreferencesResponse.model_validate(prefs)


@router.put("/preferences", response_model=SyncPreferencesResponse)
def put_preferences(
    payload: SyncPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPreferencesResponse:
    prefs = autosync_service.update_preferences(
        db, current_user.id, payload.auto_sync_enabled, payload.interval_hours
    )
    return SyncPreferencesResponse.model_validate(prefs)


@router.post("/auto", response_model=AutoSyncRunResponse)
def run_auto_sync(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> AutoSyncRunResponse:
    result = autosync_service.run_for_user(db, current_user, datetime.now(timezone.utc))
    return AutoSyncRunResponse(
        synced=result["synced"],
        reason=result["reason"],
        next_due_at=result["next_due_at"],
        last_auto_sync_at=result["last_auto_sync_at"],
        status=result.get("status"),
        results=[
            {"item_id": r["item_id"], "ok": r["ok"], "detail": r["detail"]}
            for r in result.get("results", [])
        ],
    )
