from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class NotificationPreferences(Base):
    __tablename__ = "notification_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)

    budget_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    budget_threshold_pct: Mapped[float] = mapped_column(Float, default=80.0)
    budget_alert_at_100: Mapped[bool] = mapped_column(Boolean, default=True)

    bill_reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    bill_lead_days: Mapped[int] = mapped_column(Integer, default=3)

    fraud_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    weekly_digest_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    weekly_digest_day: Mapped[int] = mapped_column(Integer, default=0)  # 0=Monday .. 6=Sunday

    email_override: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notification_preferences")


class NotificationLog(Base):
    __tablename__ = "notification_log"
    __table_args__ = (UniqueConstraint("user_id", "dedup_key", name="uq_notification_dedup"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # budget | bill | fraud | digest
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    dedup_key: Mapped[str] = mapped_column(String(255), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # sent | skipped | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notification_logs")
