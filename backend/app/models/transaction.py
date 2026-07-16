from datetime import date as date_type
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.account import Account
    from app.models.fraud_flag import FraudFlag


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    plaid_transaction_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)

    # Positive amount = money out (expense), per Plaid convention.
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    # Intraday timestamp when Plaid provides one (or synthetic, from the seed script).
    # Null for real sandbox transactions that only carry a date — features fall back to date-level granularity.
    transacted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    merchant_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    category_primary: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    category_detailed: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    payment_channel: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    pending: Mapped[bool] = mapped_column(Boolean, default=False)

    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    account: Mapped["Account"] = relationship(back_populates="transactions")
    fraud_flag: Mapped[Optional["FraudFlag"]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", uselist=False
    )
