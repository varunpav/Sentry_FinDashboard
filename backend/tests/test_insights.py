from datetime import date

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.services import insights_service


def _get_user_id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def _seed_account(db_session, user_id: int) -> Account:
    item = PlaidItem(
        user_id=user_id,
        plaid_item_id=f"item-{user_id}",
        access_token_encrypted="unused",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.flush()
    account = Account(item_id=item.id, plaid_account_id=f"acct-{user_id}", name="Checking")
    db_session.add(account)
    db_session.flush()
    return account


def _txn(account_id, ext_id, amount, d, category, merchant="Store"):
    return Transaction(
        account_id=account_id,
        plaid_transaction_id=ext_id,
        amount=amount,
        date=d,
        merchant_name=merchant,
        category_primary=category,
    )


def test_category_comparison_includes_categories_present_in_only_one_month(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    db_session.add_all(
        [
            # Present in both months.
            _txn(account.id, "t-1", 100.0, date(2026, 6, 5), "FOOD_AND_DRINK"),
            _txn(account.id, "t-2", 150.0, date(2026, 7, 5), "FOOD_AND_DRINK"),
            # Present only in the current month (new spending).
            _txn(account.id, "t-3", 80.0, date(2026, 7, 10), "TRAVEL"),
            # Present only in the previous month (stopped spending).
            _txn(account.id, "t-4", 50.0, date(2026, 6, 10), "ENTERTAINMENT"),
        ]
    )
    db_session.commit()

    result = insights_service.get_category_comparison(db_session, user_id, month="2026-07")
    assert result["previous_month"] == "2026-06"

    by_category = {c["category"]: c for c in result["categories"]}

    assert by_category["FOOD_AND_DRINK"]["current"] == 150.0
    assert by_category["FOOD_AND_DRINK"]["previous"] == 100.0
    assert by_category["FOOD_AND_DRINK"]["delta"] == 50.0
    assert by_category["FOOD_AND_DRINK"]["delta_pct"] == 50.0

    assert by_category["TRAVEL"]["current"] == 80.0
    assert by_category["TRAVEL"]["previous"] == 0.0
    assert by_category["TRAVEL"]["delta_pct"] is None  # prior month zero -- no divide-by-zero

    assert by_category["ENTERTAINMENT"]["current"] == 0.0
    assert by_category["ENTERTAINMENT"]["previous"] == 50.0
    assert by_category["ENTERTAINMENT"]["delta"] == -50.0


def test_monthly_trend_covers_requested_window_oldest_first(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    db_session.add(_txn(account.id, "t-1", 100.0, date.today(), "FOOD_AND_DRINK"))
    db_session.commit()

    trend = insights_service.get_monthly_trend(db_session, user_id, months=3)
    assert len(trend) == 3
    months = [p["month"] for p in trend]
    assert months == sorted(months)  # oldest first
    assert trend[-1]["total_spent"] == 100.0  # current month has the seeded transaction
