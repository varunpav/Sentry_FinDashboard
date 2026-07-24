"""Generates ~6 months of realistic synthetic transactions (plus a few injected
anomalies) for a demo user, so the dashboard and fraud detection have
compelling data without waiting on sparse Plaid Sandbox transaction history.

Usage (from backend/, with the venv active and Postgres running):
    python scripts/seed_sandbox.py [--email demo@fintrackapp.dev] [--password demo12345]
"""
import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models.account import Account  # noqa: E402
from app.models.budget import Budget  # noqa: E402
from app.models.plaid_item import PlaidItem  # noqa: E402
from app.models.transaction import Transaction  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import fraud_service  # noqa: E402
from app.services.budget_service import upsert_budget  # noqa: E402
from app.services.encryption import encrypt_token  # noqa: E402
from app.services.security import hash_password  # noqa: E402

RNG = random.Random(7)

# Picked to span the Meter's good/warning/critical states against the seeded
# transaction volume: transportation comes in comfortably under, food & drink
# sits in the warning band, and general merchandise blows way past its limit
# because that's the category the injected fraud transactions land in —
# ties the budget story directly to the fraud alerts.
DEMO_BUDGETS = [
    ("TRANSPORTATION", 250.0),
    ("FOOD_AND_DRINK", 500.0),
    ("GENERAL_MERCHANDISE", 600.0),
]

GROCERY_MERCHANTS = ["Trader Joe's", "Whole Foods", "Safeway", "Kroger"]
RESTAURANT_MERCHANTS = ["Chipotle", "Local Diner", "Sushi House", "Corner Cafe", "Pizza Place"]
SUBSCRIPTIONS = [
    ("Netflix", 15.49, "ENTERTAINMENT"),
    ("Spotify", 11.99, "ENTERTAINMENT"),
    ("Gym Membership", 39.99, "PERSONAL_CARE"),
]


def _tx(account_id, ext_id, amount, dt, merchant, category, detailed=None, channel="in store"):
    return Transaction(
        account_id=account_id,
        plaid_transaction_id=ext_id,
        amount=amount,
        date=dt.date(),
        transacted_at=dt,
        merchant_name=merchant,
        name=merchant,
        category_primary=category,
        category_detailed=detailed or category,
        payment_channel=channel,
        pending=False,
    )


def generate_transactions(account_id: int, months: int = 6) -> list[Transaction]:
    txns: list[Transaction] = []
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=30 * months)
    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"seed-{account_id}-{counter}"

    day = start
    while day <= now:
        # Biweekly salary deposit (negative = money in)
        if day.weekday() == 4 and (day - start).days % 14 == 0:
            dt = day.replace(hour=9, minute=0)
            txns.append(_tx(account_id, next_id(), -2800.0, dt, "Employer Payroll", "INCOME"))

        # Rent on the 1st of each month
        if day.day == 1:
            dt = day.replace(hour=8, minute=0)
            txns.append(
                _tx(account_id, next_id(), 1450.0, dt, "Skyline Apartments", "RENT_AND_UTILITIES")
            )
            for name, amount, category in SUBSCRIPTIONS:
                sub_dt = day.replace(hour=10, minute=RNG.randint(0, 59))
                txns.append(_tx(account_id, next_id(), amount, sub_dt, name, category, channel="online"))

        # Groceries ~2x/week
        if day.weekday() in (1, 5):
            dt = day.replace(hour=RNG.randint(9, 19), minute=RNG.randint(0, 59))
            amount = round(max(RNG.gauss(85, 18), 20), 2)
            merchant = RNG.choice(GROCERY_MERCHANTS)
            txns.append(_tx(account_id, next_id(), amount, dt, merchant, "FOOD_AND_DRINK", "GROCERIES"))

        # Restaurant ~1x/week
        if day.weekday() == 5:
            dt = day.replace(hour=RNG.randint(18, 21), minute=RNG.randint(0, 59))
            amount = round(max(RNG.gauss(32, 9), 10), 2)
            merchant = RNG.choice(RESTAURANT_MERCHANTS)
            txns.append(
                _tx(account_id, next_id(), amount, dt, merchant, "FOOD_AND_DRINK", "RESTAURANTS")
            )

        # Gas / transportation weekly
        if day.weekday() == 2:
            dt = day.replace(hour=RNG.randint(7, 18), minute=RNG.randint(0, 59))
            amount = round(max(RNG.gauss(45, 8), 15), 2)
            txns.append(
                _tx(account_id, next_id(), amount, dt, "Shell Gas Station", "TRANSPORTATION")
            )

        day += timedelta(days=1)

    # --- Injected anomalies ---
    anomaly_day = now - timedelta(days=12)
    txns.append(
        _tx(
            account_id,
            next_id(),
            3200.0,
            anomaly_day.replace(hour=3, minute=12),
            "Global Electronics Bazaar",
            "GENERAL_MERCHANDISE",
        )
    )

    burst_start = now - timedelta(days=5)
    for i in range(6):
        dt = burst_start.replace(hour=1, minute=0) + timedelta(minutes=15 * i)
        txns.append(
            _tx(
                account_id,
                next_id(),
                round(RNG.uniform(80, 220), 2),
                dt,
                f"Unfamiliar Merchant {i}",
                "GENERAL_MERCHANDISE",
            )
        )

    dup_day = now - timedelta(days=8)
    dup_dt = dup_day.replace(hour=14, minute=30)
    txns.append(_tx(account_id, next_id(), 189.99, dup_dt, "TechMart Online", "GENERAL_MERCHANDISE"))
    txns.append(
        _tx(account_id, next_id(), 189.99, dup_dt + timedelta(minutes=4), "TechMart Online", "GENERAL_MERCHANDISE")
    )

    return txns


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="demo@fintrackapp.dev")
    parser.add_argument("--password", default="demo12345")
    parser.add_argument("--months", type=int, default=6)
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == args.email).first()
        if user is None:
            user = User(email=args.email, password_hash=hash_password(args.password))
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created demo user: {args.email} / {args.password}")
        else:
            print(f"Using existing demo user: {args.email}")

        item = (
            db.query(PlaidItem)
            .filter(PlaidItem.user_id == user.id, PlaidItem.plaid_item_id == "seed-item")
            .first()
        )
        if item is None:
            item = PlaidItem(
                user_id=user.id,
                plaid_item_id="seed-item",
                access_token_encrypted=encrypt_token("seeded-not-a-real-token"),
                institution_name="Demo Bank",
            )
            db.add(item)
            db.flush()

        account = db.query(Account).filter(Account.item_id == item.id).first()
        if account is None:
            account = Account(
                item_id=item.id,
                plaid_account_id="seed-account",
                name="Seeded Checking",
                type="depository",
                subtype="checking",
                mask="0000",
                current_balance=4200.00,
            )
            db.add(account)
            db.commit()
            db.refresh(account)

        existing_count = db.query(Transaction).filter(Transaction.account_id == account.id).count()
        if existing_count > 0:
            print(f"Account already has {existing_count} transactions; skipping generation.")
        else:
            txns = generate_transactions(account.id, months=args.months)
            db.add_all(txns)
            db.commit()
            print(f"Inserted {len(txns)} synthetic transactions.")

        all_txn_ids = [
            row[0]
            for row in db.query(Transaction.id).filter(Transaction.account_id == account.id).all()
        ]
        created_flags = fraud_service.score_transactions_for_user(db, user.id, all_txn_ids)
        print(f"Fraud scoring created {created_flags} new flag(s).")

        existing_budget_categories = {
            b.category for b in db.query(Budget).filter(Budget.user_id == user.id).all()
        }
        seeded_budgets = 0
        for category, monthly_limit in DEMO_BUDGETS:
            if category not in existing_budget_categories:
                upsert_budget(db, user.id, category, monthly_limit)
                seeded_budgets += 1
        print(f"Seeded {seeded_budgets} budget(s).")

        print(f"\nDemo login -> email: {args.email}  password: {args.password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
