from datetime import date as date_type
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, DateTime, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.account import Account


class AccountBalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "date", name="uq_snapshot_account_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    current_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    available_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    credit_limit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    account: Mapped["Account"] = relationship(back_populates="balance_snapshots")
