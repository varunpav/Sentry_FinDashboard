"""Core Plaid sync logic, extracted from app/routers/plaid.py so it can be called from
a non-HTTP context (the auto-sync scheduler in autosync_service.py) as well as from the
router. Raises SyncError on failure instead of HTTPException -- the router wraps that
back into the existing 502 response, keeping /plaid/sync and /plaid/exchange behavior
unchanged.
"""
import logging
from datetime import datetime as dt

from cryptography.fernet import InvalidToken
from plaid.exceptions import OpenApiException
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.schemas.plaid import SyncResponse
from app.services import balance_service, notification_service, plaid_service, recurring_service
from app.services.encryption import decrypt_token

logger = logging.getLogger(__name__)


class SyncError(Exception):
    """A Plaid or token failure during sync. No HTTP coupling -- callers (the router,
    the scheduler) decide how to surface it."""


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


def sync_item(db: Session, item: PlaidItem) -> SyncResponse:
    try:
        access_token = decrypt_token(item.access_token_encrypted)
        result = plaid_service.sync_transactions(access_token, item.sync_cursor)
    except (OpenApiException, InvalidToken) as exc:
        raise SyncError(str(exc)) from exc

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
        logger.warning("Notification evaluation failed", exc_info=True)

    return SyncResponse(
        added=len(result["added"]),
        modified=len(result["modified"]),
        removed=len(result["removed"]),
        new_fraud_flags=new_fraud_flags,
        balances_refreshed=balances_refreshed,
    )
