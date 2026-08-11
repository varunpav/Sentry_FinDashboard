from datetime import datetime

from pydantic import BaseModel, Field


class NotificationPreferencesResponse(BaseModel):
    budget_alerts_enabled: bool
    budget_threshold_pct: float
    budget_alert_at_100: bool
    bill_reminders_enabled: bool
    bill_lead_days: int
    fraud_alerts_enabled: bool
    weekly_digest_enabled: bool
    weekly_digest_day: int
    email_override: str | None

    model_config = {"from_attributes": True}


class NotificationPreferencesUpdate(BaseModel):
    budget_alerts_enabled: bool
    budget_threshold_pct: float = Field(gt=0, le=100)
    budget_alert_at_100: bool
    bill_reminders_enabled: bool
    bill_lead_days: int = Field(ge=0, le=30)
    fraud_alerts_enabled: bool
    weekly_digest_enabled: bool
    weekly_digest_day: int = Field(ge=0, le=6)
    email_override: str | None = None


class NotificationLogEntry(BaseModel):
    id: int
    type: str
    dedup_key: str
    sent_at: datetime
    status: str
    detail: str | None

    model_config = {"from_attributes": True}


class NotificationRunResult(BaseModel):
    budget: int
    bill: int
    fraud: int
    digest: int
    resend_configured: bool
