from typing import NoReturn

from cryptography.fernet import InvalidToken
from plaid.exceptions import OpenApiException
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.user import User
from app.schemas.plaid import (
    AccountResponse,
    ExchangeRequest,
    ExchangeResponse,
    LinkTokenResponse,
    RefreshBalancesResponse,
    SyncResponse,
)
from app.services import balance_service, plaid_service, sync_service
from app.services.encryption import encrypt_token

router = APIRouter(prefix="/plaid", tags=["plaid"])


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
        return sync_service.sync_item(db, item)
    except sync_service.SyncError as exc:
        _raise_plaid_unavailable(exc)


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
