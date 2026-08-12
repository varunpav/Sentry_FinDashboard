from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.transaction import Transaction
from app.services.budget_service import _month_bounds, _user_expense_query


def _month_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _shift_month(month: str, delta: int) -> str:
    year, mon = (int(p) for p in month.split("-"))
    total = (year * 12 + (mon - 1)) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def get_monthly_trend(db: Session, user_id: int, months: int = 6) -> list[dict]:
    current = _month_str(date.today())
    results = []
    for i in range(months - 1, -1, -1):
        month = _shift_month(current, -i)
        start, end = _month_bounds(month)
        total = (
            _user_expense_query(db, user_id, start, end).with_entities(func.sum(Transaction.amount)).scalar()
        )
        results.append({"month": month, "total_spent": round(float(total or 0.0), 2)})
    return results


def _category_totals(db: Session, user_id: int, start: date, end: date) -> dict[str, float]:
    rows = (
        _user_expense_query(db, user_id, start, end)
        .with_entities(Transaction.effective_category, func.sum(Transaction.amount))
        .group_by(Transaction.effective_category)
        .all()
    )
    totals: dict[str, float] = {}
    for category, total in rows:
        key = category or "OTHER"
        totals[key] = totals.get(key, 0.0) + float(total)
    return totals


def get_category_comparison(db: Session, user_id: int, month: str | None = None) -> dict:
    month = month or _month_str(date.today())
    prev_month = _shift_month(month, -1)

    cur_start, cur_end = _month_bounds(month)
    prev_start, prev_end = _month_bounds(prev_month)

    current_totals = _category_totals(db, user_id, cur_start, cur_end)
    previous_totals = _category_totals(db, user_id, prev_start, prev_end)

    # Outer join: a category present in only one of the two months is exactly the
    # interesting case (something new, or something you stopped spending on).
    categories = []
    for category in sorted(set(current_totals) | set(previous_totals)):
        current = round(current_totals.get(category, 0.0), 2)
        previous = round(previous_totals.get(category, 0.0), 2)
        delta = round(current - previous, 2)
        delta_pct = round((delta / previous) * 100, 1) if previous else None
        categories.append(
            {
                "category": category,
                "current": current,
                "previous": previous,
                "delta": delta,
                "delta_pct": delta_pct,
            }
        )
    categories.sort(key=lambda c: c["current"], reverse=True)

    return {"month": month, "previous_month": prev_month, "categories": categories}
