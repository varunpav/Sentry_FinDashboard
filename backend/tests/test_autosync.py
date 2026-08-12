from datetime import datetime, timedelta, timezone

import pytest

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.sync_preference import SyncPreference
from app.models.user import User
from app.services import autosync_service, sync_service

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)


def _get_user(client, headers, db_session) -> User:
    user_id = client.get("/auth/me", headers=headers).json()["id"]
    return db_session.get(User, user_id)


def _seed_item(db_session, user_id: int, plaid_item_id: str = "item-1") -> PlaidItem:
    item = PlaidItem(
        user_id=user_id,
        plaid_item_id=plaid_item_id,
        access_token_encrypted="unused",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.flush()
    db_session.add(Account(item_id=item.id, plaid_account_id=f"acct-{plaid_item_id}", name="Checking"))
    db_session.commit()
    return item


# ---- is_due boundaries ----


def test_is_due_false_when_disabled():
    prefs = SyncPreference(user_id=1, auto_sync_enabled=False, interval_hours=1, last_auto_sync_at=None)
    assert autosync_service.is_due(prefs, NOW) is False


def test_is_due_true_when_never_synced():
    prefs = SyncPreference(user_id=1, auto_sync_enabled=True, interval_hours=24, last_auto_sync_at=None)
    assert autosync_service.is_due(prefs, NOW) is True


def test_is_due_false_immediately_after_sync():
    prefs = SyncPreference(
        user_id=1, auto_sync_enabled=True, interval_hours=6, last_auto_sync_at=NOW - timedelta(minutes=1)
    )
    assert autosync_service.is_due(prefs, NOW) is False


def test_is_due_true_exactly_at_interval_boundary():
    prefs = SyncPreference(
        user_id=1, auto_sync_enabled=True, interval_hours=6, last_auto_sync_at=NOW - timedelta(hours=6)
    )
    assert autosync_service.is_due(prefs, NOW) is True


def test_is_due_false_just_under_interval():
    prefs = SyncPreference(
        user_id=1,
        auto_sync_enabled=True,
        interval_hours=6,
        last_auto_sync_at=NOW - timedelta(hours=6) + timedelta(minutes=1),
    )
    assert autosync_service.is_due(prefs, NOW) is False


# ---- run_for_user ----


def test_run_for_user_updates_last_synced_and_second_call_is_not_due(client, auth_headers, db_session):
    headers = auth_headers()
    user = _get_user(client, headers, db_session)
    autosync_service.update_preferences(db_session, user.id, auto_sync_enabled=True, interval_hours=1)

    first = autosync_service.run_for_user(db_session, user, NOW)
    assert first["synced"] is True
    assert first["last_auto_sync_at"] is not None

    second = autosync_service.run_for_user(db_session, user, NOW + timedelta(minutes=5))
    assert second["synced"] is False
    assert second["reason"] == "not_due"


def test_run_for_user_with_no_items_is_ok(client, auth_headers, db_session):
    headers = auth_headers()
    user = _get_user(client, headers, db_session)
    autosync_service.update_preferences(db_session, user.id, auto_sync_enabled=True, interval_hours=1)

    result = autosync_service.run_for_user(db_session, user, NOW)
    assert result["synced"] is True
    assert result["status"] == "ok"
    assert result["results"] == []


def test_failing_item_does_not_abort_the_batch(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user = _get_user(client, headers, db_session)
    _seed_item(db_session, user.id, "item-ok")
    _seed_item(db_session, user.id, "item-bad")
    autosync_service.update_preferences(db_session, user.id, auto_sync_enabled=True, interval_hours=1)

    def fake_sync_item(db, item):
        if item.plaid_item_id == "item-bad":
            raise sync_service.SyncError("simulated Plaid failure")
        from app.schemas.plaid import SyncResponse

        return SyncResponse(added=0, modified=0, removed=0, new_fraud_flags=0, balances_refreshed=0)

    monkeypatch.setattr(sync_service, "sync_item", fake_sync_item)

    result = autosync_service.run_for_user(db_session, user, NOW)

    assert result["synced"] is True
    assert result["status"] == "partial"
    assert len(result["results"]) == 2
    ok_flags = {r["item_id"]: r["ok"] for r in result["results"]}
    assert sum(ok_flags.values()) == 1

    prefs = autosync_service.get_or_create_preferences(db_session, user.id)
    assert prefs.last_auto_sync_status == "partial"


def test_all_items_failing_records_failed_status(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    user = _get_user(client, headers, db_session)
    _seed_item(db_session, user.id, "item-bad")
    autosync_service.update_preferences(db_session, user.id, auto_sync_enabled=True, interval_hours=1)

    def always_fails(db, item):
        raise sync_service.SyncError("simulated Plaid failure")

    monkeypatch.setattr(sync_service, "sync_item", always_fails)

    result = autosync_service.run_for_user(db_session, user, NOW)
    assert result["status"] == "failed"


def test_run_all_due_isolates_failing_user(client, auth_headers, db_session, monkeypatch):
    good_headers = auth_headers(email="good@example.com")
    good_user = _get_user(client, good_headers, db_session)
    autosync_service.update_preferences(db_session, good_user.id, auto_sync_enabled=True, interval_hours=1)

    bad_headers = auth_headers(email="bad@example.com")
    bad_user = _get_user(client, bad_headers, db_session)
    autosync_service.update_preferences(db_session, bad_user.id, auto_sync_enabled=True, interval_hours=1)

    real_run_for_user = autosync_service.run_for_user

    def flaky_run_for_user(db, user, now, force=False):
        if user.id == bad_user.id:
            raise RuntimeError("boom")
        return real_run_for_user(db, user, now, force=force)

    monkeypatch.setattr(autosync_service, "run_for_user", flaky_run_for_user)

    summary = autosync_service.run_all_due(db_session, NOW)
    assert summary["checked"] == 2
    assert summary["synced"] == 1
    assert summary["failed_users"] == [bad_user.id]


# ---- API surface ----


def test_get_preferences_creates_defaults(client, auth_headers):
    headers = auth_headers()
    resp = client.get("/sync/preferences", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["auto_sync_enabled"] is False
    assert body["interval_hours"] == 24
    assert body["last_auto_sync_at"] is None


def test_put_preferences_rejects_interval_outside_allowed_stops(client, auth_headers):
    headers = auth_headers()
    resp = client.put(
        "/sync/preferences", json={"auto_sync_enabled": True, "interval_hours": 5}, headers=headers
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("hours", [1, 3, 6, 12, 24, 48])
def test_put_preferences_accepts_every_allowed_stop(client, auth_headers, hours):
    headers = auth_headers()
    resp = client.put(
        "/sync/preferences", json={"auto_sync_enabled": True, "interval_hours": hours}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["interval_hours"] == hours


def test_preferences_are_isolated_per_user(client, auth_headers):
    a_headers = auth_headers(email="a@example.com")
    b_headers = auth_headers(email="b@example.com")

    client.put("/sync/preferences", json={"auto_sync_enabled": True, "interval_hours": 1}, headers=a_headers)

    b_prefs = client.get("/sync/preferences", headers=b_headers).json()
    assert b_prefs["auto_sync_enabled"] is False
    assert b_prefs["interval_hours"] == 24


def test_run_auto_sync_endpoint_respects_disabled_default(client, auth_headers):
    headers = auth_headers()
    resp = client.post("/sync/auto", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["synced"] is False
    assert body["reason"] == "disabled"
