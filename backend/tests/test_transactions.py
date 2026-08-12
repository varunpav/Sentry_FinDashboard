from datetime import date

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction

CATEGORY_MONTH = "2026-07"


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


def test_search_matches_merchant_and_name_case_insensitively(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    db_session.add_all(
        [
            Transaction(
                account_id=account.id,
                plaid_transaction_id="t-1",
                amount=15.49,
                date=date(2026, 7, 1),
                merchant_name="Netflix",
                category_primary="ENTERTAINMENT",
            ),
            Transaction(
                account_id=account.id,
                plaid_transaction_id="t-2",
                amount=45.0,
                date=date(2026, 7, 3),
                merchant_name="Trader Joe's",
                category_primary="FOOD_AND_DRINK",
            ),
        ]
    )
    db_session.commit()

    resp = client.get("/transactions?search=netflix", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["merchant_name"] == "Netflix"

    resp = client.get("/transactions?search=joe", headers=headers)
    assert [i["merchant_name"] for i in resp.json()["items"]] == ["Trader Joe's"]

    resp = client.get("/transactions?search=nonexistent", headers=headers)
    assert resp.json()["items"] == []


def test_category_override_persists_and_takes_precedence(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    txn = Transaction(
        account_id=account.id,
        plaid_transaction_id="t-1",
        amount=45.0,
        date=date(2026, 7, 3),
        merchant_name="Ambiguous Store",
        category_primary="GENERAL_MERCHANDISE",
    )
    db_session.add(txn)
    db_session.commit()

    resp = client.patch(
        f"/transactions/{txn.id}", json={"category_override": "FOOD_AND_DRINK"}, headers=headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["category_override"] == "FOOD_AND_DRINK"
    assert body["category_primary"] == "GENERAL_MERCHANDISE"
    assert body["effective_category"] == "FOOD_AND_DRINK"

    listed = client.get("/transactions", headers=headers).json()["items"][0]
    assert listed["effective_category"] == "FOOD_AND_DRINK"

    # Clearing the override reverts to Plaid's category.
    resp = client.patch(f"/transactions/{txn.id}", json={"category_override": None}, headers=headers)
    assert resp.json()["effective_category"] == "GENERAL_MERCHANDISE"


def test_override_into_excluded_category_removes_from_spend(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    txn = Transaction(
        account_id=account.id,
        plaid_transaction_id="t-1",
        amount=200.0,
        date=date(2026, 7, 5),
        merchant_name="Misclassified Transfer",
        category_primary="GENERAL_MERCHANDISE",
    )
    db_session.add(txn)
    db_session.commit()

    before = client.get(f"/spending/summary?month={CATEGORY_MONTH}", headers=headers).json()
    assert before["total_spent"] == 200.0

    client.patch(f"/transactions/{txn.id}", json={"category_override": "TRANSFER_OUT"}, headers=headers)

    after = client.get(f"/spending/summary?month={CATEGORY_MONTH}", headers=headers).json()
    assert after["total_spent"] == 0.0


def test_patch_another_users_transaction_404s(client, auth_headers, db_session):
    owner_headers = auth_headers(email="owner@example.com")
    owner_id = _get_user_id(client, owner_headers)
    account = _seed_account(db_session, owner_id)
    txn = Transaction(
        account_id=account.id,
        plaid_transaction_id="t-1",
        amount=10.0,
        date=date(2026, 7, 1),
        merchant_name="Owner's Store",
        category_primary="GENERAL_MERCHANDISE",
    )
    db_session.add(txn)
    db_session.commit()

    intruder_headers = auth_headers(email="intruder@example.com")
    resp = client.patch(
        f"/transactions/{txn.id}", json={"category_override": "FOOD_AND_DRINK"}, headers=intruder_headers
    )
    assert resp.status_code == 404
