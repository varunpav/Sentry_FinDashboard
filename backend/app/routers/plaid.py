import logging
from datetime import datetime as dt
from typing import NoReturn

import plaid
from cryptography.fernet import InvalidToken
from plaid.exceptions import OpenApiException
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.plaid import (
    AccountResponse,
    ExchangeRequest,
    ExchangeResponse,
    LinkTokenResponse,
    RefreshBalancesResponse,
    SyncResponse,
)
from app.services import balance_service, notification_service, plaid_service, recurring_service
from app.services.encryption import decrypt_token, encrypt_token

router = APIRouter(prefix="/plaid", tags=["plaid"])


def _extract_datetime(txn: dict) -> dt | None:
    raw = txn.get("datetime") or txn.get("authorized_datetime")
    if not raw:
        return None
    if isinstance(raw, dt):
        return raw
    try:
        return dt.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_category(txn: dict) -> tuple[str | None, str | None]:
    pfc = txn.get("personal_finance_category")
    if pfc:
        return pfc.get("primary"), pfc.get("detailed")
    legacy = txn.get("category") or []
    if legacy:
        return legacy[0], legacy[-1]
    return None, None


def _raise_plaid_unavailable(exc: Exception) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Unable to reach Plaid. Check your Plaid API credentials and try again.",
    ) from exc


@router.post("/link-token", response_model=LinkTokenResponse)
def link_token(current_user: User = Depends(get_current_user)) -> LinkTokenResponse:
    try:
        token = plaid_service.create_link_token(current_user.id)
    except OpenApiException as exc:
        _raise_plaid_unavailable(exc)
    return LinkTokenResponse(link_token=token)


@router.post("/exchange", response_model=ExchangeResponse)
def exchange(
    payload: ExchangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExchangeResponse:
    try:
        access_token, plaid_item_id = plaid_service.exchange_public_token(payload.public_token)
        accounts_data = plaid_service.get_accounts(access_token)
    except OpenApiException as exc:
        _raise_plaid_unavailable(exc)

    institution_name = None
    if accounts_data:
        institution_id = accounts_data[0].get("institution_id") if accounts_data else None
        institution_name = plaid_service.get_institution_name(institution_id)

    item = PlaidItem(
        user_id=current_user.id,
        plaid_item_id=plaid_item_id,
        access_token_encrypted=encrypt_token(access_token),
        institution_name=institution_name,
    )
    db.add(item)
    db.flush()

    for acct in accounts_data:
        db.add(
            Account(
                item_id=item.id,
                plaid_account_id=acct["account_id"],
                name=acct.get("name", "Account"),
                type=str(acct.get("type")) if acct.get("type") else None,
                subtype=str(acct.get("subtype")) if acct.get("subtype") else None,
                mask=acct.get("mask"),
                current_balance=(acct.get("balances") or {}).get("current"),
            )
        )
    db.commit()

    _run_sync_for_item(db, item)

    return ExchangeResponse(
        item_id=item.id,
        institution_name=institution_name,
        accounts_linked=len(accounts_data),
    )


def _run_sync_for_item(db: Session, item: PlaidItem) -> SyncResponse:
    try:
        access_token = decrypt_token(item.access_token_encrypted)
        result = plaid_service.sync_transactions(access_token, item.sync_cursor)
    except (OpenApiException, InvalidToken) as exc:
        _raise_plaid_unavailable(exc)

    account_by_plaid_id = {
        acct.plaid_account_id: acct
        for acct in db.query(Account).filter(Account.item_id == item.id).all()
    }

    new_transaction_ids: list[int] = []

    for txn in result["added"] + result["modified"]:
        account = account_by_plaid_id.get(txn["account_id"])
        if account is None:
            continue

        category_primary, category_detailed = _extract_category(txn)
        existing = (
            db.query(Transaction)
            .filter(Transaction.plaid_transaction_id == txn["transaction_id"])
            .first()
        )
        txn_date = txn.get("date")
        if isinstance(txn_date, str):
            txn_date = dt.strptime(txn_date, "%Y-%m-%d").date()

        if existing:
            existing.amount = txn["amount"]
            existing.date = txn_date
            existing.transacted_at = _extract_datetime(txn)
            existing.merchant_name = txn.get("merchant_name")
            existing.name = txn.get("name")
            existing.category_primary = category_primary
            existing.category_detailed = category_detailed
            existing.payment_channel = txn.get("payment_channel")
            existing.pending = txn.get("pending", False)
        else:
            new_txn = Transaction(
                account_id=account.id,
                plaid_transaction_id=txn["transaction_id"],
                amount=txn["amount"],
                date=txn_date,
                transacted_at=_extract_datetime(txn),
                merchant_name=txn.get("merchant_name"),
                name=txn.get("name"),
                category_primary=category_primary,
                category_detailed=category_detailed,
                payment_channel=txn.get("payment_channel"),
                pending=txn.get("pending", False),
                city=(txn.get("location") or {}).get("city"),
                region=(txn.get("location") or {}).get("region"),
            )
            db.add(new_txn)
            db.flush()
            new_transaction_ids.append(new_txn.id)

    removed_ids = {t["transaction_id"] for t in result["removed"]}
    if removed_ids:
        db.query(Transaction).filter(Transaction.plaid_transaction_id.in_(removed_ids)).delete(
            synchronize_session=False
        )

    item.sync_cursor = result["cursor"]
    db.commit()

    new_fraud_flags = 0
    if new_transaction_ids:
        from app.services import fraud_service

        new_fraud_flags = fraud_service.score_transactions_for_user(
            db, item.user_id, new_transaction_ids
        )

    if new_transaction_ids or result["removed"]:
        recurring_service.detect_and_persist(db, item.user_id)

    # Best-effort: a demo/seeded item carries a placeholder access token that Plaid
    # will reject, so a balance refresh failure here must not fail the whole sync.
    try:
        balances_refreshed = balance_service.refresh_balances_for_item(db, item)
    except (OpenApiException, InvalidToken):
        balances_refreshed = 0
    balance_service.snapshot_balances_for_user(db, item.user_id)

    try:
        notification_service.evaluate_and_send(db, item.user)
    except Exception:  # noqa: BLE001 - notification failures must never break a sync
        logging.getLogger(__name__).warning("Notification evaluation failed", exc_info=True)

    return SyncResponse(
        added=len(result["added"]),
        modified=len(result["modified"]),
        removed=len(result["removed"]),
        new_fraud_flags=new_fraud_flags,
        balances_refreshed=balances_refreshed,
    )


@router.post("/sync", response_model=list[SyncResponse])
def sync_all(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[SyncResponse]:
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No linked bank accounts")
    return [_run_sync_for_item(db, item) for item in items]


@router.get("/accounts", response_model=list[AccountResponse])
def list_accounts(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[AccountResponse]:
    accounts = (
        db.query(Account)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == current_user.id)
        .all()
    )
    results = []
    for acct in accounts:
        resp = AccountResponse.model_validate(acct)
        resp.institution_name = acct.item.institution_name
        results.append(resp)
    return results


@router.post("/refresh-balances", response_model=RefreshBalancesResponse)
def refresh_balances(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RefreshBalancesResponse:
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No linked bank accounts")

    accounts_updated = 0
    for item in items:
        try:
            accounts_updated += balance_service.refresh_balances_for_item(db, item)
        except (OpenApiException, InvalidToken) as exc:
            _raise_plaid_unavailable(exc)
    balance_service.snapshot_balances_for_user(db, current_user.id)

    return RefreshBalancesResponse(accounts_updated=accounts_updated)
