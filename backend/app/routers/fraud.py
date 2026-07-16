from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.fraud_flag import FraudFlag
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fraud import FraudFlagResponse, FraudFlagStatusUpdate, RetrainResponse
from app.services import fraud_service

router = APIRouter(prefix="/fraud", tags=["fraud"])

VALID_STATUSES = {"pending", "confirmed", "dismissed"}


def _to_response(flag: FraudFlag) -> FraudFlagResponse:
    txn = flag.transaction
    return FraudFlagResponse(
        id=flag.id,
        transaction_id=txn.id,
        amount=txn.amount,
        date=txn.date,
        merchant_name=txn.merchant_name,
        category_primary=txn.category_primary,
        anomaly_score=flag.anomaly_score,
        reasons=flag.reasons,
        status=flag.status,
    )


@router.get("/flags", response_model=list[FraudFlagResponse])
def list_flags(
    status_filter: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FraudFlagResponse]:
    query = (
        db.query(FraudFlag)
        .join(Transaction, FraudFlag.transaction_id == Transaction.id)
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .options(joinedload(FraudFlag.transaction))
        .filter(PlaidItem.user_id == current_user.id)
    )
    if status_filter:
        query = query.filter(FraudFlag.status == status_filter)

    flags = query.order_by(FraudFlag.anomaly_score.asc()).all()
    return [_to_response(f) for f in flags]


@router.post("/flags/{flag_id}", response_model=FraudFlagResponse)
def update_flag_status(
    flag_id: int,
    payload: FraudFlagStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FraudFlagResponse:
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")

    flag = (
        db.query(FraudFlag)
        .join(Transaction, FraudFlag.transaction_id == Transaction.id)
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .options(joinedload(FraudFlag.transaction))
        .filter(FraudFlag.id == flag_id, PlaidItem.user_id == current_user.id)
        .first()
    )
    if flag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fraud flag not found")

    flag.status = payload.status
    db.commit()
    db.refresh(flag)
    return _to_response(flag)


@router.post("/retrain", response_model=RetrainResponse)
def retrain(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RetrainResponse:
    trained = fraud_service.retrain_all_models(db)
    return RetrainResponse(trained_users=trained, message=f"Retrained models for {trained} user(s)")
