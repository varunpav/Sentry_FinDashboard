from datetime import date, timedelta

from app.models.account import Account
from app.models.balance_snapshot import AccountBalanceSnapshot
from app.models.plaid_item import PlaidItem
from app.services import networth_service


def _get_user_id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def _seed_item(db_session, user_id: int) -> PlaidItem:
    item = PlaidItem(
        user_id=user_id,
        plaid_item_id=f"item-{user_id}",
        access_token_encrypted="unused",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.flush()
    return item


def test_classifies_asset_and_liability_and_unknown_type_defaults_asset():
    assert networth_service._classify("depository") == "asset"
    assert networth_service._classify("investment") == "asset"
    assert networth_service._classify("credit") == "liability"
    assert networth_service._classify("loan") == "liability"
    assert networth_service._classify(None) == "asset"
    assert networth_service._classify("some_future_plaid_type") == "asset"


def test_summary_nets_assets_and_liabilities(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    item = _seed_item(db_session, user_id)

    db_session.add(
        Account(
            item_id=item.id, plaid_account_id="checking", name="Checking", type="depository",
            current_balance=5000.0,
        )
    )
    db_session.add(
        Account(
            item_id=item.id, plaid_account_id="credit", name="Credit Card", type="credit",
            current_balance=1200.0,
        )
    )
    db_session.commit()

    summary = networth_service.get_networth_summary(db_session, user_id)
    assert summary["assets"] == 5000.0
    assert summary["liabilities"] == 1200.0
    assert summary["net_worth"] == 3800.0


def test_history_forward_fills_gaps_between_snapshots(db_session, client, auth_headers):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    item = _seed_item(db_session, user_id)

    account = Account(
        item_id=item.id, plaid_account_id="checking", name="Checking", type="depository",
        current_balance=1000.0,
    )
    db_session.add(account)
    db_session.flush()

    # get_networth_history windows relative to the real wall-clock date, so the test
    # must anchor to date.today() rather than a fixed constant to stay deterministic.
    today = date.today()
    # Only two snapshots, five days apart -- the days between must forward-fill.
    db_session.add(
        AccountBalanceSnapshot(account_id=account.id, date=today - timedelta(days=5), current_balance=800.0)
    )
    db_session.add(
        AccountBalanceSnapshot(account_id=account.id, date=today, current_balance=1000.0)
    )
    db_session.commit()

    history = networth_service.get_networth_history(db_session, user_id, months=1)
    by_date = {p["date"]: p for p in history}

    gap_day = (today - timedelta(days=3)).isoformat()
    assert by_date[gap_day]["net_worth"] == 800.0  # forward-filled from the day-5 snapshot
    assert by_date[today.isoformat()]["net_worth"] == 1000.0

    before_first = (today - timedelta(days=6)).isoformat()
    assert by_date[before_first]["net_worth"] == 0.0  # before any snapshot exists
