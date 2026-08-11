"""Detects recurring charges (subscriptions, rent, bills) purely from transaction
history. See docs/design-decisions.md for the reasoning behind the thresholds below.
"""
import calendar
import re
from datetime import date, timedelta
from statistics import median, pstdev

from sqlalchemy.orm import Session

from app.models.recurring_series import RecurringSeries
from app.models.transaction import Transaction
from app.services.budget_service import _user_expense_query

MIN_OCCURRENCES = 3
CONFIDENCE_FLOOR = 0.35
STALE_MULTIPLIER = 2.0

# (cadence, min median-gap days, max median-gap days)
CADENCE_BUCKETS: list[tuple[str, float, float]] = [
    ("weekly", 6, 8),
    ("biweekly", 12, 16),
    ("monthly", 26, 35),
    ("quarterly", 85, 95),
    ("annual", 350, 380),
]

# How much median-absolute-deviation in the gaps between occurrences is tolerated
# before a merchant is judged too irregular to be "recurring."
REGULARITY_TOLERANCE_DAYS = {
    "weekly": 3,
    "biweekly": 3,
    "monthly": 5,
    "quarterly": 10,
    "annual": 20,
}
MONTHLY_DAY_OF_MONTH_STDEV_MAX = 3.0
AMOUNT_STABILITY_FIXED_THRESHOLD = 0.05
# Median-absolute-deviation is robust to a single skipped-cycle outlier, but with few
# samples it can miss a "majority cluster + a couple of wild outliers" pattern entirely
# (median/MAD both land on the cluster). This catches that case: a random weekly pick
# among several merchants can by chance land on the same one two cycles in a row a few
# times, which reads as "regular" to MAD alone even though most gaps are nothing alike.
GAP_RANGE_TOLERANCE_MULTIPLIER = 4

_PUNCT_RE = re.compile(r"[^a-z0-9\s]")
_TRAILING_DIGITS_RE = re.compile(r"\s*\d{2,}$")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_merchant(raw: str) -> str:
    s = raw.lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _TRAILING_DIGITS_RE.sub("", s)
    s = _WHITESPACE_RE.sub(" ", s).strip()
    return s


def _median_abs_deviation(values: list[float]) -> float:
    if not values:
        return 0.0
    med = median(values)
    return median([abs(v - med) for v in values])


def _classify_cadence(median_gap: float) -> str | None:
    for cadence, low, high in CADENCE_BUCKETS:
        if low <= median_gap <= high:
            return cadence
    return None


def _add_months_clamped(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last_day))


def _next_due_date(last_seen: date, cadence: str, median_gap: float) -> date:
    if cadence == "monthly":
        return _add_months_clamped(last_seen, 1)
    if cadence == "quarterly":
        return _add_months_clamped(last_seen, 3)
    if cadence == "annual":
        return _add_months_clamped(last_seen, 12)
    return last_seen + timedelta(days=round(median_gap))


def _build_candidate(txns: list[Transaction], today: date) -> dict | None:
    if len(txns) < MIN_OCCURRENCES:
        return None

    dated = sorted(
        ((t.date, t.amount, t.merchant_name or t.name) for t in txns), key=lambda row: row[0]
    )
    dates = [d for d, _, _ in dated]
    amounts = [a for _, a, _ in dated]

    gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    if not gaps:
        return None
    median_gap = median(gaps)

    cadence = _classify_cadence(median_gap)
    if cadence is None:
        return None

    tolerance = REGULARITY_TOLERANCE_DAYS[cadence]
    gap_mad = _median_abs_deviation(gaps)
    if gap_mad > tolerance:
        return None
    if (max(gaps) - min(gaps)) > GAP_RANGE_TOLERANCE_MULTIPLIER * tolerance:
        return None

    if cadence == "monthly":
        day_stdev = pstdev([d.day for d in dates]) if len(dates) > 1 else 0.0
        if day_stdev > MONTHLY_DAY_OF_MONTH_STDEV_MAX:
            return None

    median_amount = median(amounts)
    if median_amount == 0:
        return None
    spread = (max(amounts) - min(amounts)) / abs(median_amount)
    amount_stability = "fixed" if spread < AMOUNT_STABILITY_FIXED_THRESHOLD else "variable"
    # The most recent occurrences set the expectation, so a genuine price increase
    # (e.g. a subscription bump) is reflected rather than averaged away.
    expected_amount = median(amounts[-3:])

    interval_regularity = max(0.0, 1 - min(gap_mad / tolerance, 1.0))
    amount_stability_score = max(0.0, 1 - min(spread, 1.0))
    occurrence_score = min(len(dates) / 6, 1.0)
    confidence = round(
        0.4 * interval_regularity + 0.3 * amount_stability_score + 0.3 * occurrence_score, 3
    )
    if confidence < CONFIDENCE_FLOOR:
        return None

    last_seen = dates[-1]
    status = "active"
    if (today - last_seen).days > STALE_MULTIPLIER * median_gap:
        status = "inactive"

    return {
        "display_name": dated[-1][2] or "Unknown merchant",
        "cadence": cadence,
        "median_gap_days": round(median_gap, 1),
        "expected_amount": round(expected_amount, 2),
        "amount_stability": amount_stability,
        "occurrences": len(dates),
        "first_seen": dates[0],
        "last_seen": last_seen,
        "next_due_date": _next_due_date(last_seen, cadence, median_gap),
        "confidence": confidence,
        "status": status,
    }


def detect_and_persist(db: Session, user_id: int, today: date | None = None) -> dict:
    """Recomputes all recurring series for a user from scratch and upserts by
    merchant_key. Cheap enough at personal-finance transaction volumes to always
    fully recompute rather than maintain incremental state."""
    today = today or date.today()
    transactions = _user_expense_query(db, user_id, date(2000, 1, 1), today).all()

    groups: dict[str, list[Transaction]] = {}
    for txn in transactions:
        raw_name = txn.merchant_name or txn.name
        if not raw_name:
            continue
        key = normalize_merchant(raw_name)
        if not key:
            continue
        groups.setdefault(key, []).append(txn)

    existing = {
        row.merchant_key: row
        for row in db.query(RecurringSeries).filter(RecurringSeries.user_id == user_id).all()
    }

    seen_keys: set[str] = set()
    active_count = 0
    inactive_count = 0

    for key, txns in groups.items():
        candidate = _build_candidate(txns, today)
        if candidate is None:
            continue
        seen_keys.add(key)

        row = existing.get(key)
        if row is None:
            row = RecurringSeries(user_id=user_id, merchant_key=key)
            db.add(row)
        for field, value in candidate.items():
            setattr(row, field, value)
        # is_muted is a user preference and is intentionally left untouched here.

        if row.status == "active":
            active_count += 1
        else:
            inactive_count += 1

    # A merchant that used to qualify but no longer does (e.g. a cancelled
    # subscription drops out of the candidate set): mark inactive, don't delete,
    # so mute preference and history survive.
    for key, row in existing.items():
        if key not in seen_keys and row.status != "inactive":
            row.status = "inactive"
            inactive_count += 1

    db.commit()
    return {"active": active_count, "inactive": inactive_count, "total_candidates": len(groups)}


def total_monthly_cost(series: list[RecurringSeries]) -> float:
    multiplier = {"weekly": 4.345, "biweekly": 2.17, "monthly": 1.0, "quarterly": 1 / 3, "annual": 1 / 12}
    return round(sum(s.expected_amount * multiplier.get(s.cadence, 1.0) for s in series), 2)
