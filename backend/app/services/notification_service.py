import logging
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.models.account import Account
from app.models.fraud_flag import FraudFlag
from app.models.notification import NotificationLog, NotificationPreferences
from app.models.plaid_item import PlaidItem
from app.models.recurring_series import RecurringSeries
from app.models.transaction import Transaction
from app.models.user import User
from app.services import budget_service, networth_service

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def _current_month_str() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def get_or_create_preferences(db: Session, user_id: int) -> NotificationPreferences:
    prefs = (
        db.query(NotificationPreferences)
        .filter(NotificationPreferences.user_id == user_id)
        .first()
    )
    if prefs is None:
        prefs = NotificationPreferences(user_id=user_id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def update_preferences(db: Session, user_id: int, fields: dict) -> NotificationPreferences:
    prefs = get_or_create_preferences(db, user_id)
    for key, value in fields.items():
        setattr(prefs, key, value)
    db.commit()
    db.refresh(prefs)
    return prefs


def send_email(to: str, subject: str, html: str) -> str:
    """Returns 'sent', 'skipped' (no API key configured), or 'failed'."""
    settings = get_settings()
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY not set; skipping email %r to %s", subject, to)
        return "skipped"

    try:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.notification_from_email,
                "to": [to],
                "subject": subject,
                "html": html,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return "sent"
    except httpx.HTTPError:
        logger.warning("Resend send failed for %r to %s", subject, to, exc_info=True)
        return "failed"


def _budget_alert_email(category: str, spent: float, limit: float, pct_label: str) -> tuple[str, str]:
    subject = f"Sentry: {category.replace('_', ' ').title()} budget at {pct_label}%"
    html = (
        f"<p>You've spent <b>${spent:,.2f}</b> of your <b>${limit:,.2f}</b> "
        f"{category.replace('_', ' ').title()} budget this month ({pct_label}%+).</p>"
    )
    return subject, html


def _bill_reminder_email(display_name: str, amount: float, due_date: date) -> tuple[str, str]:
    subject = f"Sentry: {display_name} due {due_date.isoformat()}"
    html = f"<p><b>{display_name}</b> (~${amount:,.2f}) is due on {due_date.isoformat()}.</p>"
    return subject, html


def _fraud_alert_email(merchant: str, amount: float, reasons: list[str]) -> tuple[str, str]:
    subject = f"Sentry: possible fraud — {merchant}"
    reason_list = "".join(f"<li>{r}</li>" for r in reasons)
    html = f"<p>A ${amount:,.2f} charge at <b>{merchant}</b> was flagged:</p><ul>{reason_list}</ul>"
    return subject, html


def _weekly_digest_email(db: Session, user: User) -> tuple[str, str]:
    summary = budget_service.get_spending_summary(db, user.id, _current_month_str())
    net_worth = networth_service.get_networth_summary(db, user.id)
    upcoming = (
        db.query(RecurringSeries)
        .filter(
            RecurringSeries.user_id == user.id,
            RecurringSeries.status == "active",
            RecurringSeries.is_muted.is_(False),
            RecurringSeries.next_due_date <= date.today() + timedelta(days=7),
        )
        .order_by(RecurringSeries.next_due_date.asc())
        .all()
    )
    subject = "Sentry: your weekly summary"
    bills_html = "".join(
        f"<li>{s.display_name} — ${s.expected_amount:,.2f} on {s.next_due_date.isoformat()}</li>"
        for s in upcoming
    ) or "<li>None</li>"
    html = (
        f"<p>Spent this month: <b>${summary.total_spent:,.2f}</b> of ${summary.total_budget:,.2f} budgeted.</p>"
        f"<p>Net worth: <b>${net_worth['net_worth']:,.2f}</b></p>"
        f"<p>Bills due in the next 7 days:</p><ul>{bills_html}</ul>"
    )
    return subject, html


def _already_logged_keys(db: Session, user_id: int) -> set[str]:
    return {
        row.dedup_key
        for row in db.query(NotificationLog.dedup_key).filter(NotificationLog.user_id == user_id).all()
    }


def _record(db: Session, user_id: int, type_: str, dedup_key: str, status: str, detail: str | None) -> None:
    db.add(
        NotificationLog(
            user_id=user_id,
            type=type_,
            dedup_key=dedup_key,
            status=status,
            detail=detail,
            sent_at=datetime.now(timezone.utc),
        )
    )


def evaluate_and_send(db: Session, user: User) -> dict:
    prefs = get_or_create_preferences(db, user.id)
    to_email = prefs.email_override or user.email
    already_logged = _already_logged_keys(db, user.id)
    counts = {"budget": 0, "bill": 0, "fraud": 0, "digest": 0}

    if prefs.budget_alerts_enabled:
        month = _current_month_str()
        budgets = budget_service.list_budgets_with_spend(db, user.id, month)
        for b in budgets:
            if b["monthly_limit"] <= 0:
                continue
            ratio_pct = (b["spent"] / b["monthly_limit"]) * 100
            thresholds: list[str] = []
            if ratio_pct >= prefs.budget_threshold_pct:
                thresholds.append(str(int(prefs.budget_threshold_pct)))
            if prefs.budget_alert_at_100 and ratio_pct >= 100 and "100" not in thresholds:
                thresholds.append("100")
            for label in thresholds:
                dedup_key = f"budget:{b['category']}:{month}:{label}"
                if dedup_key in already_logged:
                    continue
                already_logged.add(dedup_key)
                subject, html = _budget_alert_email(b["category"], b["spent"], b["monthly_limit"], label)
                result = send_email(to_email, subject, html)
                _record(db, user.id, "budget", dedup_key, result, subject)
                counts["budget"] += 1

    if prefs.bill_reminders_enabled:
        horizon = date.today() + timedelta(days=prefs.bill_lead_days)
        due_series = (
            db.query(RecurringSeries)
            .filter(
                RecurringSeries.user_id == user.id,
                RecurringSeries.status == "active",
                RecurringSeries.is_muted.is_(False),
                RecurringSeries.next_due_date <= horizon,
            )
            .all()
        )
        for series in due_series:
            dedup_key = f"bill:{series.id}:{series.next_due_date.isoformat()}"
            if dedup_key in already_logged:
                continue
            already_logged.add(dedup_key)
            subject, html = _bill_reminder_email(
                series.display_name, series.expected_amount, series.next_due_date
            )
            result = send_email(to_email, subject, html)
            _record(db, user.id, "bill", dedup_key, result, subject)
            counts["bill"] += 1

    if prefs.fraud_alerts_enabled:
        pending_flags = (
            db.query(FraudFlag)
            .join(Transaction, FraudFlag.transaction_id == Transaction.id)
            .join(Account, Transaction.account_id == Account.id)
            .join(PlaidItem, Account.item_id == PlaidItem.id)
            .options(joinedload(FraudFlag.transaction))
            .filter(PlaidItem.user_id == user.id, FraudFlag.status == "pending")
            .all()
        )
        for flag in pending_flags:
            dedup_key = f"fraud:{flag.id}"
            if dedup_key in already_logged:
                continue
            already_logged.add(dedup_key)
            txn = flag.transaction
            subject, html = _fraud_alert_email(
                txn.merchant_name or txn.name or "Unknown merchant", txn.amount, flag.reasons
            )
            result = send_email(to_email, subject, html)
            _record(db, user.id, "fraud", dedup_key, result, subject)
            counts["fraud"] += 1

    if prefs.weekly_digest_enabled:
        iso_year, iso_week, _ = date.today().isocalendar()
        dedup_key = f"digest:{iso_year}-W{iso_week:02d}"
        if dedup_key not in already_logged:
            subject, html = _weekly_digest_email(db, user)
            result = send_email(to_email, subject, html)
            _record(db, user.id, "digest", dedup_key, result, subject)
            counts["digest"] += 1

    db.commit()
    return counts
