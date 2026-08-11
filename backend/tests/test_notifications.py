from datetime import date

from app.models.account import Account
from app.models.notification import NotificationLog
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.models.user import User
from app.services import budget_service, notification_service


def _get_user(client, headers, db_session) -> User:
    user_id = client.get("/auth/me", headers=headers).json()["id"]
    return db_session.get(User, user_id)


def test_preferences_created_with_defaults_on_first_read(client, auth_headers):
    headers = auth_headers()
    resp = client.get("/notifications/preferences", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["budget_alerts_enabled"] is True
    assert body["budget_threshold_pct"] == 80.0
    assert body["weekly_digest_enabled"] is False


def test_send_email_skips_without_api_key(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    result = notification_service.send_email("someone@example.com", "Subject", "<p>body</p>")
    assert result == "skipped"


def test_send_email_sends_when_configured(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    get_settings.cache_clear()

    class FakeResponse:
        def raise_for_status(self):
            return None

    def fake_post(url, headers=None, json=None, timeout=None):
        assert "test-key" in headers["Authorization"]
        return FakeResponse()

    monkeypatch.setattr(notification_service.httpx, "post", fake_post)

    result = notification_service.send_email("someone@example.com", "Subject", "<p>body</p>")
    assert result == "sent"
    get_settings.cache_clear()


def test_budget_alert_dedup_blocks_repeat_send(client, auth_headers, db_session):
    headers = auth_headers()
    user = _get_user(client, headers, db_session)

    item = PlaidItem(
        user_id=user.id, plaid_item_id="item-1", access_token_encrypted="unused", institution_name="Bank"
    )
    db_session.add(item)
    db_session.flush()
    account = Account(item_id=item.id, plaid_account_id="acct-1", name="Checking")
    db_session.add(account)
    db_session.flush()

    today = date.today()
    db_session.add(
        Transaction(
            account_id=account.id,
            plaid_transaction_id="t-1",
            amount=90.0,
            date=today,
            category_primary="FOOD_AND_DRINK",
        )
    )
    db_session.commit()
    budget_service.upsert_budget(db_session, user.id, "FOOD_AND_DRINK", 100.0)  # 90% -> crosses default 80%

    first = notification_service.evaluate_and_send(db_session, user)
    assert first["budget"] == 1

    second = notification_service.evaluate_and_send(db_session, user)
    assert second["budget"] == 0

    logged = db_session.query(NotificationLog).filter(NotificationLog.user_id == user.id).count()
    assert logged == 1
