from datetime import date as date_type
from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.balance_snapshot import AccountBalanceSnapshot
from app.models.plaid_item import PlaidItem

# Plaid account types that represent money owned vs. money owed. An unrecognized/None
# type is conservatively treated as an asset rather than silently excluded.
LIABILITY_TYPES = {"credit", "loan"}


def _classify(account_type: str | None) -> str:
    return "liability" if account_type in LIABILITY_TYPES else "asset"


def _user_accounts(db: Session, user_id: int) -> list[Account]:
    return (
        db.query(Account)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .all()
    )


def get_networth_summary(db: Session, user_id: int) -> dict:
    accounts = _user_accounts(db, user_id)
    assets = sum(a.current_balance or 0.0 for a in accounts if _classify(a.type) == "asset")
    liabilities = sum(a.current_balance or 0.0 for a in accounts if _classify(a.type) == "liability")
    net_worth = assets - liabilities

    history = get_networth_history(db, user_id, months=2)
    thirty_days_ago = datetime.now(timezone.utc).date() - timedelta(days=30)
    past_point = next((p for p in history if p["date"] >= thirty_days_ago.isoformat()), None)
    change_30d = round(net_worth - past_point["net_worth"], 2) if past_point else None
    change_30d_pct = (
        round((change_30d / abs(past_point["net_worth"])) * 100, 1)
        if past_point and change_30d is not None and past_point["net_worth"] != 0
        else None
    )

    return {
        "assets": round(assets, 2),
        "liabilities": round(liabilities, 2),
        "net_worth": round(net_worth, 2),
        "change_30d": change_30d,
        "change_30d_pct": change_30d_pct,
    }


def get_networth_history(db: Session, user_id: int, months: int = 6) -> list[dict]:
    accounts = _user_accounts(db, user_id)
    if not accounts:
        return []

    account_type = {a.id: _classify(a.type) for a in accounts}
    account_ids = list(account_type.keys())

    window_start = datetime.now(timezone.utc).date() - timedelta(days=months * 30)
    today = datetime.now(timezone.utc).date()

    snapshots = (
        db.query(AccountBalanceSnapshot)
        .filter(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.date >= window_start,
        )
        .all()
    )
    if not snapshots:
        return []

    rows = [
        {"date": s.date, "account_id": s.account_id, "balance": s.current_balance or 0.0}
        for s in snapshots
    ]
    df = pd.DataFrame(rows)
    pivot = df.pivot_table(index="date", columns="account_id", values="balance", aggfunc="last")

    earliest = min(pivot.index.min(), window_start)
    full_range = pd.date_range(earliest, today, freq="D").date
    pivot = pivot.reindex(full_range)
    # Forward-fill within each account's observed history; balances before an account's
    # first snapshot stay NaN (it didn't exist yet) and are treated as zero contribution.
    pivot = pivot.ffill().fillna(0.0)

    points = []
    for day, row in pivot.iterrows():
        assets = sum(bal for acct_id, bal in row.items() if account_type.get(acct_id) == "asset")
        liabilities = sum(
            bal for acct_id, bal in row.items() if account_type.get(acct_id) == "liability"
        )
        points.append(
            {
                "date": day.isoformat() if isinstance(day, date_type) else str(day),
                "assets": round(float(assets), 2),
                "liabilities": round(float(liabilities), 2),
                "net_worth": round(float(assets - liabilities), 2),
            }
        )
    return points
