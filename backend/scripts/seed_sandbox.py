"""Generates ~6 months of realistic synthetic transactions (plus a few injected
anomalies) for a demo user, so the dashboard and fraud detection have
compelling data without waiting on sparse Plaid Sandbox transaction history.

Usage (from backend/, with the venv active and Postgres running):
    python scripts/seed_sandbox.py [--email demo@sentryapp.dev] [--password demo12345]
"""
import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models.account import Account  # noqa: E402
from app.models.balance_snapshot import AccountBalanceSnapshot  # noqa: E402
from app.models.budget import Budget  # noqa: E402
from app.models.plaid_item import PlaidItem  # noqa: E402
from app.models.transaction import Transaction  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import fraud_service, notification_service, recurring_service  # noqa: E402
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
FLIGHT_MERCHANTS = ["Delta Air Lines", "United Airlines", "Southwest Airlines"]
LODGING_MERCHANTS = ["Marriott Hotels", "Hilton Hotels", "Airbnb"]
FUN_MERCHANTS = ["AMC Theatres", "Ticketmaster", "Topgolf", "Local Escape Room"]


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
    friday_counter = 0
    while day <= now:
        # Biweekly salary deposit (negative = money in). Counts Fridays rather than
        # gating on days-since-start, since that offset only lands on a Friday if
        # `start` itself happened to be one -- otherwise the condition never fires
        # and no income gets generated at all.
        if day.weekday() == 4:
            if friday_counter % 2 == 0:
                dt = day.replace(hour=9, minute=0)
                txns.append(_tx(account_id, next_id(), -2800.0, dt, "Employer Payroll", "INCOME"))
            friday_counter += 1

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

    # --- A few trips, spread across the window (not recurring -- one-off travel) ---
    total_days = (now - start).days
    for frac in (0.82, 0.5, 0.18):
        trip_day = now - timedelta(days=int(total_days * frac))
        flight_dt = trip_day.replace(hour=RNG.randint(6, 20), minute=RNG.randint(0, 59))
        txns.append(
            _tx(
                account_id,
                next_id(),
                round(RNG.uniform(280, 650), 2),
                flight_dt,
                RNG.choice(FLIGHT_MERCHANTS),
                "TRAVEL",
                "TRAVEL_FLIGHTS",
                channel="online",
            )
        )
        hotel_dt = trip_day.replace(hour=RNG.randint(14, 22), minute=RNG.randint(0, 59))
        txns.append(
            _tx(
                account_id,
                next_id(),
                round(RNG.uniform(420, 950), 2),
                hotel_dt,
                RNG.choice(LODGING_MERCHANTS),
                "TRAVEL",
                "TRAVEL_LODGING",
                channel="online",
            )
        )

    # --- A handful of one-off "fun" outings, distinct from the recurring subscriptions ---
    for frac in (0.9, 0.7, 0.55, 0.35, 0.1):
        fun_day = now - timedelta(days=int(total_days * frac))
        dt = fun_day.replace(hour=RNG.randint(12, 22), minute=RNG.randint(0, 59))
        txns.append(
            _tx(
                account_id,
                next_id(),
                round(max(RNG.gauss(55, 20), 15), 2),
                dt,
                RNG.choice(FUN_MERCHANTS),
                "ENTERTAINMENT",
            )
        )

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


def generate_balance_snapshots(
    account_id: int, txns: list[Transaction], start: datetime, now: datetime, ending_balance: float
) -> list[AccountBalanceSnapshot]:
    """Back-solves a starting balance from the known ending balance and each day's net
    transaction flow, then walks forward day by day so the snapshot history ends exactly
    at the account's current balance and trends realistically (payroll bumps, gradual
    drawdown) rather than sitting flat."""
    net_flow_by_day: dict = {}
    for t in txns:
        net_flow_by_day[t.date] = net_flow_by_day.get(t.date, 0.0) - t.amount

    total_net_flow = sum(net_flow_by_day.values())
    running_balance = ending_balance - total_net_flow

    snapshots: list[AccountBalanceSnapshot] = []
    day = start.date()
    end_date = now.date()
    while day <= end_date:
        running_balance += net_flow_by_day.get(day, 0.0)
        snapshots.append(
            AccountBalanceSnapshot(
                account_id=account_id,
                date=day,
                current_balance=round(running_balance, 2),
                available_balance=round(running_balance, 2),
                credit_limit=None,
            )
        )
        day += timedelta(days=1)

    return snapshots


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="demo@sentryapp.dev")
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
                current_balance=10000.00,
                available_balance=10000.00,
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

        existing_snapshots = (
            db.query(AccountBalanceSnapshot).filter(AccountBalanceSnapshot.account_id == account.id).count()
        )
        if existing_snapshots > 0:
            print(f"Account already has {existing_snapshots} balance snapshots; skipping generation.")
        else:
            now = datetime.now(timezone.utc)
            start = now - timedelta(days=30 * args.months)
            all_txns = db.query(Transaction).filter(Transaction.account_id == account.id).all()
            snapshots = generate_balance_snapshots(account.id, all_txns, start, now, account.current_balance)
            db.add_all(snapshots)
            db.commit()
            print(f"Inserted {len(snapshots)} balance snapshots.")

        notification_service.get_or_create_preferences(db, user.id)
        print("Ensured default notification preferences.")

        recurring_result = recurring_service.detect_and_persist(db, user.id)
        print(
            f"Recurring detection: {recurring_result['active']} active, "
            f"{recurring_result['inactive']} inactive, "
            f"{recurring_result['total_candidates']} merchant group(s) considered."
        )

        print(f"\nDemo login -> email: {args.email}  password: {args.password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
