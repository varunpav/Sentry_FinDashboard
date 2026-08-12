import csv
import io
from datetime import date

from app.models.account import Account
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction


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


def test_csv_export_header_and_row_count(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    db_session.add_all(
        [
            Transaction(
                account_id=account.id,
                plaid_transaction_id="t-1",
                amount=45.0,
                date=date(2026, 7, 1),
                merchant_name="Trader Joe's",
                category_primary="FOOD_AND_DRINK",
            ),
            Transaction(
                account_id=account.id,
                plaid_transaction_id="t-2",
                amount=15.49,
                date=date(2026, 7, 5),
                merchant_name="Netflix",
                category_primary="ENTERTAINMENT",
            ),
            # Outside the requested range -- must not appear.
            Transaction(
                account_id=account.id,
                plaid_transaction_id="t-3",
                amount=100.0,
                date=date(2026, 8, 1),
                merchant_name="Out Of Range",
                category_primary="GENERAL_MERCHANDISE",
            ),
        ]
    )
    db_session.commit()

    resp = client.get(
        "/export/transactions.csv?start_date=2026-07-01&end_date=2026-07-31", headers=headers
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")

    rows = list(csv.reader(io.StringIO(resp.text)))
    assert rows[0] == [
        "Date",
        "Merchant",
        "Description",
        "Category",
        "Plaid Category",
        "Amount",
        "Account",
        "Pending",
        "Flagged",
    ]
    assert len(rows) == 3  # header + 2 in-range transactions
    merchants = {row[1] for row in rows[1:]}
    assert merchants == {"Trader Joe's", "Netflix"}


def test_pdf_export_returns_valid_pdf_bytes(client, auth_headers, db_session):
    headers = auth_headers()
    user_id = _get_user_id(client, headers)
    account = _seed_account(db_session, user_id)

    db_session.add(
        Transaction(
            account_id=account.id,
            plaid_transaction_id="t-1",
            amount=45.0,
            date=date(2026, 3, 1),
            merchant_name="Trader Joe's",
            category_primary="FOOD_AND_DRINK",
        )
    )
    db_session.commit()
    client.put("/budgets", json={"category": "FOOD_AND_DRINK", "monthly_limit": 300}, headers=headers)

    resp = client.get("/export/summary.pdf?year=2026", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")
    assert len(resp.content) > 0
