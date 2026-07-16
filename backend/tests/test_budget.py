from datetime import date

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction


def _get_user_id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def _seed_transactions(db_session, user_id: int, month: str = "2026-07"):
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

    year, mon = (int(p) for p in month.split("-"))
    txns = [
        Transaction(
            account_id=account.id,
            plaid_transaction_id=f"t-{user_id}-1",
            amount=45.0,
            date=date(year, mon, 3),
            category_primary="FOOD_AND_DRINK",
        ),
        Transaction(
            account_id=account.id,
            plaid_transaction_id=f"t-{user_id}-2",
            amount=60.0,
            date=date(year, mon, 10),
            category_primary="FOOD_AND_DRINK",
        ),
        Transaction(
            account_id=account.id,
            plaid_transaction_id=f"t-{user_id}-3",
            amount=1200.0,
            date=date(year, mon, 1),
            category_primary="RENT_AND_UTILITIES",
        ),
        Transaction(
            account_id=account.id,
            plaid_transaction_id=f"t-{user_id}-4",
            amount=-3000.0,
            date=date(year, mon, 1),
            category_primary="INCOME",
        ),
    ]
    db_session.add_all(txns)
    db_session.commit()


def test_upsert_and_get_budget(client, auth_headers):
    headers = auth_headers()
    resp = client.put("/budgets", json={"category": "FOOD_AND_DRINK", "monthly_limit": 300}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["monthly_limit"] == 300

    listed = client.get("/budgets", headers=headers)
    assert listed.status_code == 200
    assert any(b["category"] == "FOOD_AND_DRINK" for b in listed.json())


def test_spending_summary_excludes_income_and_aggregates_by_category(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    _seed_transactions(db_session, user_id, month="2026-07")

    resp = client.get("/spending/summary?month=2026-07", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    assert body["total_spent"] == 1305.0  # 45 + 60 + 1200, income excluded

    categories = {c["category"]: c["spent"] for c in body["by_category"]}
    assert categories["FOOD_AND_DRINK"] == 105.0
    assert categories["RENT_AND_UTILITIES"] == 1200.0
    assert "INCOME" not in categories


def test_budget_reflects_spend_in_list(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    _seed_transactions(db_session, user_id, month="2026-07")
    client.put("/budgets", json={"category": "FOOD_AND_DRINK", "monthly_limit": 200}, headers=headers)

    resp = client.get("/budgets?month=2026-07", headers=headers)
    budgets = {b["category"]: b for b in resp.json()}
    assert budgets["FOOD_AND_DRINK"]["spent"] == 105.0
    assert budgets["FOOD_AND_DRINK"]["monthly_limit"] == 200
