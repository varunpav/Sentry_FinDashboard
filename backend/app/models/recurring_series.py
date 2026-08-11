from datetime import date as date_type
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class RecurringSeries(Base):
    __tablename__ = "recurring_series"
    __table_args__ = (
        UniqueConstraint("user_id", "merchant_key", name="uq_recurring_user_merchant"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    merchant_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # weekly | biweekly | monthly | quarterly | annual
    cadence: Mapped[str] = mapped_column(String(16), nullable=False)
    median_gap_days: Mapped[float] = mapped_column(Float, nullable=False)
    expected_amount: Mapped[float] = mapped_column(Float, nullable=False)
    # fixed | variable
    amount_stability: Mapped[str] = mapped_column(String(16), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer, nullable=False)

    first_seen: Mapped[date_type] = mapped_column(Date, nullable=False)
    last_seen: Mapped[date_type] = mapped_column(Date, nullable=False)
    next_due_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # active | inactive (no longer recurring, e.g. a cancelled subscription)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    is_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped["User"] = relationship(back_populates="recurring_series")
