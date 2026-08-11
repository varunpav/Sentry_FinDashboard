from typing import TYPE_CHECKING, Optional

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.balance_snapshot import AccountBalanceSnapshot
    from app.models.plaid_item import PlaidItem
    from app.models.transaction import Transaction


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("plaid_items.id"), nullable=False, index=True)
    plaid_account_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    subtype: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mask: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    current_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    available_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    credit_limit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    item: Mapped["PlaidItem"] = relationship(back_populates="accounts")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    balance_snapshots: Mapped[list["AccountBalanceSnapshot"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
