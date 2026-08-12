from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.fraud_flag import FraudFlag
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import (
    PaginatedTransactions,
    TransactionCategoryUpdate,
    TransactionResponse,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _to_response(txn: Transaction) -> TransactionResponse:
    resp = TransactionResponse.model_validate(txn)
    resp.account_name = txn.account.name if txn.account else None
    resp.is_flagged = txn.fraud_flag is not None
    return resp


@router.get("", response_model=PaginatedTransactions)
def list_transactions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    category: str | None = None,
    account_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    flagged_only: bool = False,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
) -> PaginatedTransactions:
    query = (
        db.query(Transaction)
        .options(joinedload(Transaction.account), joinedload(Transaction.fraud_flag))
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == current_user.id)
    )

    if category:
        query = query.filter(Transaction.effective_category == category)
    if account_id:
        query = query.filter(Transaction.account_id == account_id)
    if start_date:
        query = query.filter(Transaction.date >= start_date)
    if end_date:
        query = query.filter(Transaction.date <= end_date)
    if flagged_only:
        query = query.join(FraudFlag, FraudFlag.transaction_id == Transaction.id)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            Transaction.merchant_name.ilike(pattern) | Transaction.name.ilike(pattern)
        )

    total = query.count()
    items = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    response_items = [_to_response(txn) for txn in items]

    return PaginatedTransactions(items=response_items, total=total, page=page, page_size=page_size)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def update_category(
    transaction_id: int,
    payload: TransactionCategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    txn = (
        db.query(Transaction)
        .options(joinedload(Transaction.account), joinedload(Transaction.fraud_flag))
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(Transaction.id == transaction_id, PlaidItem.user_id == current_user.id)
        .first()
    )
    if txn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    txn.category_override = payload.category_override
    db.commit()
    db.refresh(txn)
    return _to_response(txn)
