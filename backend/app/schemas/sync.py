from datetime import datetime

from pydantic import BaseModel, field_validator

from app.services.autosync_service import ALLOWED_INTERVAL_HOURS


class SyncPreferencesResponse(BaseModel):
    auto_sync_enabled: bool
    interval_hours: int
    last_auto_sync_at: datetime | None
    last_auto_sync_status: str | None
    last_auto_sync_detail: str | None

    model_config = {"from_attributes": True}


class SyncPreferencesUpdate(BaseModel):
    auto_sync_enabled: bool
    interval_hours: int

    @field_validator("interval_hours")
    @classmethod
    def _validate_interval(cls, value: int) -> int:
        if value not in ALLOWED_INTERVAL_HOURS:
            raise ValueError(f"interval_hours must be one of {ALLOWED_INTERVAL_HOURS}")
        return value


class AutoSyncItemResult(BaseModel):
    item_id: int
    ok: bool
    detail: str | None = None


class AutoSyncRunResponse(BaseModel):
    synced: bool
    reason: str | None
    next_due_at: datetime | None
    last_auto_sync_at: datetime | None
    status: str | None = None
    results: list[AutoSyncItemResult] = []
