import random
from datetime import date, datetime, timedelta, timezone

import numpy as np

from app.models.account import Account
from app.models.fraud_flag import FraudFlag
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


# ---- Feedback-driven retraining ----


def _seed_normal_transactions(db_session, user_id: int):
    """Same recipe as _seed_normal_and_anomalous_transactions but without the injected
    anomaly, so callers can add their own at controlled offsets."""
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

    db_session.commit()
    return account, start, normal_ids


def _add_txn(db_session, account, user_id, ext_id, amount, dt, merchant, category):
    txn = Transaction(
        account_id=account.id,
        plaid_transaction_id=ext_id,
        amount=amount,
        date=dt.date(),
        transacted_at=dt,
        merchant_name=merchant,
        category_primary=category,
    )
    db_session.add(txn)
    db_session.commit()
    db_session.refresh(txn)
    return txn.id


class _FakeModel:
    """Stand-in for IsolationForest with fully controlled, deterministic scores.

    Used only for tests that pin down the merchant-suppression cutoff LOGIC itself
    (fraud_service.score_transactions_for_user) independent of IsolationForest's actual
    (stochastic, sample-size-sensitive) scoring behavior -- verified empirically while
    building this feature that small synthetic populations make exact real-model
    percentile outcomes unreliable to hardcode into a test.
    """

    def __init__(self, ids, id_to_score, default_score=1.0):
        self._ids = ids
        self._id_to_score = id_to_score
        self._default_score = default_score

    def decision_function(self, X):
        return np.array([self._id_to_score.get(i, self._default_score) for i in self._ids])


def _patch_fake_scores(monkeypatch, id_to_score, default_score=1.0):
    def fake_get_model_for_user(db, user_id, feature_df):
        return _FakeModel(feature_df["id"].tolist(), id_to_score, default_score)

    monkeypatch.setattr(fraud_service, "_get_model_for_user", fake_get_model_for_user)


def test_confirmed_flag_excluded_from_training_frame(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    normal_ids, anomaly_ids = _seed_normal_and_anomalous_transactions(db_session, user_id)
    fraud_service.score_transactions_for_user(db_session, user_id, normal_ids + anomaly_ids)

    flag = db_session.query(FraudFlag).filter(FraudFlag.transaction_id == anomaly_ids[0]).one()
    flag.status = "confirmed"
    db_session.commit()

    feature_df = fraud_service.get_feature_matrix_for_user(db_session, user_id)
    training_df = fraud_service._curate_training_frame(feature_df)

    assert anomaly_ids[0] in feature_df["id"].tolist()
    assert anomaly_ids[0] not in training_df["id"].tolist()


def test_dismissed_flag_repeated_in_training_frame(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    normal_ids, anomaly_ids = _seed_normal_and_anomalous_transactions(db_session, user_id)
    fraud_service.score_transactions_for_user(db_session, user_id, normal_ids + anomaly_ids)

    flag = db_session.query(FraudFlag).filter(FraudFlag.transaction_id == anomaly_ids[0]).one()
    flag.status = "dismissed"
    db_session.commit()

    feature_df = fraud_service.get_feature_matrix_for_user(db_session, user_id)
    training_df = fraud_service._curate_training_frame(feature_df)

    repeat_count = int((training_df["id"] == anomaly_ids[0]).sum())
    assert repeat_count == fraud_service.settings.fraud_dismissed_repeat_count


def test_dismissed_merchant_suppresses_future_similar_transaction(client, auth_headers, db_session):
    """The end-to-end proof: a merchant dismissed twice stops re-flagging a new, similar
    transaction, while an identical control user who never dismissed anything still gets
    flagged for the same transaction. Uses the real IsolationForest pipeline throughout.
    """
    control_headers = auth_headers("control-suppression@example.com", "hunter2pass")
    control_user_id = _get_user_id(client, control_headers)
    control_account, control_start, control_normal_ids = _seed_normal_transactions(
        db_session, control_user_id
    )
    control_new_id = _add_txn(
        db_session,
        control_account,
        control_user_id,
        f"new-{control_user_id}",
        4800.0,
        control_start + timedelta(days=170, hours=3),
        "Suspicious Electronics Outlet",
        "GENERAL_MERCHANDISE",
    )
    created = fraud_service.score_transactions_for_user(
        db_session, control_user_id, control_normal_ids + [control_new_id]
    )
    assert created >= 1
    control_flagged = {
        f["transaction_id"] for f in client.get("/fraud/flags", headers=control_headers).json()
    }
    assert control_new_id in control_flagged

    test_headers = auth_headers("test-suppression@example.com", "hunter2pass")
    test_user_id = _get_user_id(client, test_headers)
    test_account, test_start, test_normal_ids = _seed_normal_transactions(db_session, test_user_id)
    anomaly1_id = _add_txn(
        db_session,
        test_account,
        test_user_id,
        f"anomaly1-{test_user_id}",
        4800.0,
        test_start + timedelta(days=150, hours=3),
        "Suspicious Electronics Outlet",
        "GENERAL_MERCHANDISE",
    )
    anomaly2_id = _add_txn(
        db_session,
        test_account,
        test_user_id,
        f"anomaly2-{test_user_id}",
        4900.0,
        test_start + timedelta(days=160, hours=3),
        "Suspicious Electronics Outlet",
        "GENERAL_MERCHANDISE",
    )
    fraud_service.score_transactions_for_user(
        db_session, test_user_id, test_normal_ids + [anomaly1_id, anomaly2_id]
    )
    flags = client.get("/fraud/flags", headers=test_headers).json()
    flagged_before_dismissal = {f["transaction_id"] for f in flags}
    assert {anomaly1_id, anomaly2_id} <= flagged_before_dismissal  # both flag before any dismissal

    for f in flags:
        if f["transaction_id"] in (anomaly1_id, anomaly2_id):
            resp = client.post(
                f"/fraud/flags/{f['id']}", json={"status": "dismissed"}, headers=test_headers
            )
            assert resp.status_code == 200

    # A brand-new, similar transaction at the same merchant -- must NOT be flagged,
    # unlike the control user's identical-in-substance transaction above.
    new_id = _add_txn(
        db_session,
        test_account,
        test_user_id,
        f"new-{test_user_id}",
        4800.0,
        test_start + timedelta(days=170, hours=3),
        "Suspicious Electronics Outlet",
        "GENERAL_MERCHANDISE",
    )
    fraud_service.score_transactions_for_user(db_session, test_user_id, [new_id])
    test_flagged = {
        f["transaction_id"] for f in client.get("/fraud/flags", headers=test_headers).json()
    }
    assert new_id not in test_flagged


def test_single_dismissal_does_not_suppress(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account, start, _normal_ids = _seed_normal_transactions(db_session, user_id)

    dismissed_id = _add_txn(
        db_session, account, user_id, f"d1-{user_id}", 500.0,
        start + timedelta(days=150, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    new_id = _add_txn(
        db_session, account, user_id, f"new-{user_id}", 500.0,
        start + timedelta(days=160, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    db_session.add(
        FraudFlag(transaction_id=dismissed_id, anomaly_score=-0.06, reasons=["test"], status="dismissed")
    )
    db_session.commit()

    _patch_fake_scores(monkeypatch, {dismissed_id: -0.06, new_id: -0.03})

    created = fraud_service.score_transactions_for_user(db_session, user_id, [new_id])
    assert created == 1  # only one dismissal on record -- floor not met, normal cutoff applies


def test_suppression_is_raised_bar_not_whitelist(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account, start, _normal_ids = _seed_normal_transactions(db_session, user_id)

    d1_id = _add_txn(
        db_session, account, user_id, f"d1-{user_id}", 500.0,
        start + timedelta(days=150, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    d2_id = _add_txn(
        db_session, account, user_id, f"d2-{user_id}", 520.0,
        start + timedelta(days=155, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    moderate_id = _add_txn(
        db_session, account, user_id, f"mod-{user_id}", 510.0,
        start + timedelta(days=160, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    wild_id = _add_txn(
        db_session, account, user_id, f"wild-{user_id}", 99999.0,
        start + timedelta(days=165, hours=3), "Repeat Offender Merchant", "GENERAL_MERCHANDISE",
    )
    for tid in (d1_id, d2_id):
        db_session.add(
            FraudFlag(transaction_id=tid, anomaly_score=-0.05, reasons=["test"], status="dismissed")
        )
    db_session.commit()

    _patch_fake_scores(
        monkeypatch, {d1_id: -0.06, d2_id: -0.05, moderate_id: -0.03, wild_id: -1000.0}
    )

    fraud_service.score_transactions_for_user(db_session, user_id, [moderate_id, wild_id])
    flagged_ids = {
        row[0]
        for row in db_session.query(FraudFlag.transaction_id)
        .filter(FraudFlag.transaction_id.in_([moderate_id, wild_id]))
        .all()
    }
    assert wild_id in flagged_ids, "a genuinely extreme charge must still flag despite suppression"
    assert moderate_id not in flagged_ids, "suppression should raise the bar, not remove it"


def test_feedback_summary_counts(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    normal_ids, anomaly_ids = _seed_normal_and_anomalous_transactions(db_session, user_id)
    fraud_service.score_transactions_for_user(db_session, user_id, normal_ids + anomaly_ids)

    flags = client.get("/fraud/flags", headers=headers).json()
    total = len(flags)
    assert total >= 1
    anomaly_flag = next(f for f in flags if f["transaction_id"] == anomaly_ids[0])
    resp = client.post(
        f"/fraud/flags/{anomaly_flag['id']}", json={"status": "dismissed"}, headers=headers
    )
    assert resp.status_code == 200

    resp = client.get("/fraud/feedback", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["dismissed_count"] == 1
    assert body["confirmed_count"] == 0
    assert body["pending_count"] == total - 1
    assert body["suppressed_merchants"] == []  # one dismissal is below the suppression floor
