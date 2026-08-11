from datetime import date as date_type
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.balance_snapshot import AccountBalanceSnapshot
from app.models.plaid_item import PlaidItem
from app.services import plaid_service
from app.services.encryption import decrypt_token


def refresh_balances_for_item(db: Session, item: PlaidItem) -> int:
    """Re-fetches balances from Plaid and updates each linked Account. Returns count updated."""
    access_token = decrypt_token(item.access_token_encrypted)
    accounts_data = plaid_service.get_accounts(access_token)

    accounts_by_plaid_id = {
        acct.plaid_account_id: acct
        for acct in db.query(Account).filter(Account.item_id == item.id).all()
    }

    updated = 0
    for acct in accounts_data:
        account = accounts_by_plaid_id.get(acct["account_id"])
        if account is None:
            continue
        balances = acct.get("balances") or {}
        account.current_balance = balances.get("current")
        account.available_balance = balances.get("available")
        account.credit_limit = balances.get("limit")
        updated += 1

    db.commit()
    return updated


def snapshot_balances_for_user(db: Session, user_id: int, on_date: date_type | None = None) -> int:
    """Upserts today's (or on_date's) balance snapshot for every account the user has linked."""
    snapshot_date = on_date or datetime.now(timezone.utc).date()

    accounts = (
        db.query(Account)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .all()
    )

    existing_by_account = {
        snap.account_id: snap
        for snap in db.query(AccountBalanceSnapshot)
        .filter(
            AccountBalanceSnapshot.account_id.in_([a.id for a in accounts]),
            AccountBalanceSnapshot.date == snapshot_date,
        )
        .all()
    }

    written = 0
    for account in accounts:
        snap = existing_by_account.get(account.id)
        if snap is None:
            snap = AccountBalanceSnapshot(account_id=account.id, date=snapshot_date)
            db.add(snap)
        snap.current_balance = account.current_balance
        snap.available_balance = account.available_balance
        snap.credit_limit = account.credit_limit
        snap.captured_at = datetime.now(timezone.utc)
        written += 1

    db.commit()
    return written
