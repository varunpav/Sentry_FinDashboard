import calendar
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.budget import Budget
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.schemas.budget import CategorySpend, DailySpendPoint, SpendingSummary

# Plaid personal_finance_category.primary values that represent money movement
# rather than real spending (excluded from budget/spend totals).
EXCLUDED_CATEGORIES = {"TRANSFER_IN", "TRANSFER_OUT", "INCOME", "LOAN_PAYMENTS"}


def _month_bounds(month: str) -> tuple[date, date]:
    year, mon = (int(part) for part in month.split("-"))
    start = date(year, mon, 1)
    last_day = calendar.monthrange(year, mon)[1]
    end = date(year, mon, last_day)
    return start, end


def _user_expense_query(db: Session, user_id: int, start: date, end: date):
    return (
        db.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(Transaction.date >= start, Transaction.date <= end)
        .filter(Transaction.amount > 0)
        .filter(
            Transaction.effective_category.is_(None)
            | Transaction.effective_category.notin_(EXCLUDED_CATEGORIES)
        )
    )


def get_spending_summary(db: Session, user_id: int, month: str) -> SpendingSummary:
    start, end = _month_bounds(month)

    category_rows = (
        _user_expense_query(db, user_id, start, end)
        .with_entities(
            Transaction.effective_category,
            func.sum(Transaction.amount).label("total"),
        )
        .group_by(Transaction.effective_category)
        .all()
    )

    budgets = {b.category: b.monthly_limit for b in db.query(Budget).filter(Budget.user_id == user_id)}

    by_category = [
        CategorySpend(
            category=row.effective_category or "OTHER",
            spent=round(float(row.total), 2),
            budget=budgets.get(row.effective_category or "OTHER"),
        )
        for row in category_rows
    ]
    by_category.sort(key=lambda c: c.spent, reverse=True)

    daily_rows = (
        _user_expense_query(db, user_id, start, end)
        .with_entities(Transaction.date, func.sum(Transaction.amount).label("total"))
        .group_by(Transaction.date)
        .order_by(Transaction.date)
        .all()
    )
    daily_spend = [
        DailySpendPoint(date=row.date.isoformat(), amount=round(float(row.total), 2))
        for row in daily_rows
    ]

    total_spent = round(sum(c.spent for c in by_category), 2)
    total_budget = round(sum(budgets.values()), 2)

    return SpendingSummary(
        month=month,
        total_spent=total_spent,
        total_budget=total_budget,
        by_category=by_category,
        daily_spend=daily_spend,
    )


def upsert_budget(db: Session, user_id: int, category: str, monthly_limit: float) -> Budget:
    budget = (
        db.query(Budget).filter(Budget.user_id == user_id, Budget.category == category).first()
    )
    if budget is None:
        budget = Budget(user_id=user_id, category=category, monthly_limit=monthly_limit)
        db.add(budget)
    else:
        budget.monthly_limit = monthly_limit
    db.commit()
    db.refresh(budget)
    return budget


def list_budgets_with_spend(db: Session, user_id: int, month: str) -> list[dict]:
    start, end = _month_bounds(month)
    spent_by_category = {
        row.effective_category or "OTHER": float(row.total)
        for row in _user_expense_query(db, user_id, start, end)
        .with_entities(Transaction.effective_category, func.sum(Transaction.amount).label("total"))
        .group_by(Transaction.effective_category)
        .all()
    }

    budgets = db.query(Budget).filter(Budget.user_id == user_id).all()
    return [
        {
            "id": b.id,
            "category": b.category,
            "monthly_limit": b.monthly_limit,
            "spent": round(spent_by_category.get(b.category, 0.0), 2),
        }
        for b in budgets
    ]
