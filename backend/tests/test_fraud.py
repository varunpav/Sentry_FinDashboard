import random
from datetime import date, datetime, timedelta, timezone

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.services import fraud_service


def _get_user_id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def _seed_normal_and_anomalous_transactions(db_session, user_id: int) -> tuple[list[int], list[int]]:
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

    rng = random.Random(42)
    start = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    normal_ids = []
    for i in range(80):
        ts = start + timedelta(days=i * 2, hours=rng.randint(8, 20))
        amount = round(rng.gauss(35, 5), 2)
        txn = Transaction(
            account_id=account.id,
            plaid_transaction_id=f"normal-{user_id}-{i}",
            amount=max(amount, 5.0),
            date=ts.date(),
            transacted_at=ts,
            merchant_name="Regular Grocery Co",
            category_primary="FOOD_AND_DRINK",
        )
        db_session.add(txn)
        db_session.flush()
        normal_ids.append(txn.id)

    anomaly_ts = start + timedelta(days=170, hours=3)
    anomaly = Transaction(
        account_id=account.id,
        plaid_transaction_id=f"anomaly-{user_id}-1",
        amount=4800.0,
        date=anomaly_ts.date(),
        transacted_at=anomaly_ts,
        merchant_name="Suspicious Electronics Outlet",
        category_primary="GENERAL_MERCHANDISE",
    )
    db_session.add(anomaly)
    db_session.commit()

    return normal_ids, [anomaly.id]


def test_anomalous_transaction_gets_flagged(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    normal_ids, anomaly_ids = _seed_normal_and_anomalous_transactions(db_session, user_id)

    all_ids = normal_ids + anomaly_ids
    created = fraud_service.score_transactions_for_user(db_session, user_id, all_ids)

    assert created >= 1

    resp = client.get("/fraud/flags", headers=headers)
    assert resp.status_code == 200
    flagged_txn_ids = {f["transaction_id"] for f in resp.json()}

    assert anomaly_ids[0] in flagged_txn_ids


def test_confirm_and_dismiss_flag(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    normal_ids, anomaly_ids = _seed_normal_and_anomalous_transactions(db_session, user_id)
    fraud_service.score_transactions_for_user(db_session, user_id, normal_ids + anomaly_ids)

    flags = client.get("/fraud/flags", headers=headers).json()
    assert len(flags) >= 1
    flag_id = flags[0]["id"]

    resp = client.post(f"/fraud/flags/{flag_id}", json={"status": "confirmed"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "confirmed"
