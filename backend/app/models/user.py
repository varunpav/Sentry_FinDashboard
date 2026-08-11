from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.plaid_item import PlaidItem
    from app.models.budget import Budget
    from app.models.notification import NotificationLog, NotificationPreferences
    from app.models.recurring_series import RecurringSeries


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    plaid_items: Mapped[list["PlaidItem"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    budgets: Mapped[list["Budget"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    recurring_series: Mapped[list["RecurringSeries"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    notification_preferences: Mapped[Optional["NotificationPreferences"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    notification_logs: Mapped[list["NotificationLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
