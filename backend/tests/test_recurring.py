from datetime import date, timedelta

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.recurring_series import RecurringSeries
from app.models.transaction import Transaction
from app.services import recurring_service
from app.services.recurring_service import _add_months_clamped, normalize_merchant

TODAY = date(2026, 8, 15)


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


def _txn(account_id, ext_id, amount, d, merchant, category="GENERAL_MERCHANDISE"):
    return Transaction(
        account_id=account_id,
        plaid_transaction_id=ext_id,
        amount=amount,
        date=d,
        merchant_name=merchant,
        category_primary=category,
    )


def test_normalize_merchant_strips_punctuation_digits_and_whitespace():
    assert normalize_merchant("Trader Joe's #4521") == "trader joe s"
    assert normalize_merchant("  Multiple   Spaces  ") == "multiple spaces"
    assert normalize_merchant("Store 12") == "store"
    assert normalize_merchant("Shell Gas Station") == "shell gas station"


def test_add_months_clamped_handles_short_months():
    assert _add_months_clamped(date(2026, 1, 31), 1) == date(2026, 2, 28)  # 2026 not a leap year
    assert _add_months_clamped(date(2026, 1, 15), 1) == date(2026, 2, 15)


def test_detects_monthly_fixed_subscription(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    for k in range(5, -1, -1):
        d = _add_months_clamped(TODAY, -k)
        db_session.add(_txn(account.id, f"netflix-{k}", 15.49, d, "Netflix", "ENTERTAINMENT"))
    db_session.commit()

    result = recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    assert result["active"] == 1

    series = db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).one()
    assert series.cadence == "monthly"
    assert series.amount_stability == "fixed"
    assert series.expected_amount == 15.49
    assert series.status == "active"
    assert series.confidence > 0.8


def test_detects_weekly_variable_charge(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    amounts = [45.0, 52.0, 38.0, 60.0, 41.0, 55.0]
    for i, amount in enumerate(amounts):
        d = TODAY - timedelta(days=(len(amounts) - 1 - i) * 7)
        db_session.add(_txn(account.id, f"gas-{i}", amount, d, "Shell Gas Station", "TRANSPORTATION"))
    db_session.commit()

    result = recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    assert result["active"] == 1

    series = db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).one()
    assert series.cadence == "weekly"
    assert series.amount_stability == "variable"
    assert series.status == "active"


def test_rejects_irregular_merchant(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    for i, offset in enumerate([0, 5, 47, 61]):
        d = TODAY - timedelta(days=offset)
        db_session.add(_txn(account.id, f"irregular-{i}", 25.0, d, "Random Diner"))
    db_session.commit()

    result = recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    assert result["active"] == 0
    assert db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).count() == 0


def test_rejects_under_min_occurrences(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    for k in range(1, -1, -1):  # only 2 occurrences
        d = _add_months_clamped(TODAY, -k)
        db_session.add(_txn(account.id, f"onetime-{k}", 10.0, d, "Two Timer"))
    db_session.commit()

    result = recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    assert result["active"] == 0
    assert result["inactive"] == 0
    assert db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).count() == 0


def test_expected_amount_tracks_price_increase(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    amounts = [10.99, 10.99, 10.99, 10.99, 12.99, 12.99]
    for k, amount in zip(range(5, -1, -1), amounts):
        d = _add_months_clamped(TODAY, -k)
        db_session.add(_txn(account.id, f"sub-{k}", amount, d, "Streaming Co", "ENTERTAINMENT"))
    db_session.commit()

    recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    series = db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).one()
    assert series.expected_amount == 12.99


def test_stale_series_marked_inactive(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    # Regular monthly history that stopped 4 months before `today` -- a cancelled subscription.
    reference = _add_months_clamped(TODAY, -4)
    for k in range(5, -1, -1):
        d = _add_months_clamped(reference, -k)
        db_session.add(_txn(account.id, f"cancelled-{k}", 9.99, d, "Cancelled Sub", "ENTERTAINMENT"))
    db_session.commit()

    result = recurring_service.detect_and_persist(db_session, user_id, today=TODAY)
    assert result["inactive"] == 1
    series = db_session.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).one()
    assert series.status == "inactive"
