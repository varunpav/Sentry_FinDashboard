import csv
import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.account import Account
from app.models.budget import Budget
from app.models.fraud_flag import FraudFlag
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.services.budget_service import _user_expense_query

CSV_HEADERS = [
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


def build_transactions_csv(db: Session, user_id: int, start: date, end: date) -> str:
    rows = (
        db.query(Transaction)
        .options(joinedload(Transaction.account), joinedload(Transaction.fraud_flag))
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(Transaction.date >= start, Transaction.date <= end)
        .order_by(Transaction.date.asc())
        .all()
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADERS)
    for txn in rows:
        writer.writerow(
            [
                txn.date.isoformat(),
                txn.merchant_name or "",
                txn.name or "",
                txn.effective_category or "",
                txn.category_primary or "",
                f"{txn.amount:.2f}",
                txn.account.name if txn.account else "",
                "yes" if txn.pending else "no",
                "yes" if txn.fraud_flag is not None else "no",
            ]
        )
    return buffer.getvalue()


def _year_expense_totals_by_category(db: Session, user_id: int, year: int) -> dict[str, float]:
    start, end = date(year, 1, 1), date(year, 12, 31)
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


def _year_income_total(db: Session, user_id: int, year: int) -> float:
    start, end = date(year, 1, 1), date(year, 12, 31)
    total = (
        db.query(func.sum(Transaction.amount))
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(Transaction.date >= start, Transaction.date <= end)
        .filter(Transaction.amount < 0)
        .scalar()
    )
    return abs(float(total or 0.0))


def build_summary_pdf(db: Session, user_id: int, year: int) -> bytes:
    category_totals = _year_expense_totals_by_category(db, user_id, year)
    total_income = _year_income_total(db, user_id, year)
    total_expenses = round(sum(category_totals.values()), 2)
    budgets = db.query(Budget).filter(Budget.user_id == user_id).all()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"Sentry — Annual Spending Summary ({year})", styles["Title"]),
        Spacer(1, 12),
        Paragraph(f"Total income: ${total_income:,.2f}", styles["Normal"]),
        Paragraph(f"Total expenses: ${total_expenses:,.2f}", styles["Normal"]),
        Paragraph(f"Net: ${total_income - total_expenses:,.2f}", styles["Normal"]),
        Spacer(1, 18),
        Paragraph("Spend by category", styles["Heading2"]),
    ]

    category_rows = [["Category", "Amount"]]
    for category, total in sorted(category_totals.items(), key=lambda kv: kv[1], reverse=True):
        category_rows.append([category.replace("_", " ").title(), f"${total:,.2f}"])
    story.append(_styled_table(category_rows))
    story.append(Spacer(1, 18))

    story.append(Paragraph("Budget vs. actual (annualized)", styles["Heading2"]))
    if budgets:
        budget_rows = [["Category", "Annual Budget", "Actual", "Difference"]]
        for b in budgets:
            annual_budget = b.monthly_limit * 12
            actual = category_totals.get(b.category, 0.0)
            budget_rows.append(
                [
                    b.category.replace("_", " ").title(),
                    f"${annual_budget:,.2f}",
                    f"${actual:,.2f}",
                    f"${annual_budget - actual:,.2f}",
                ]
            )
        story.append(_styled_table(budget_rows))
    else:
        story.append(Paragraph("No budgets set.", styles["Normal"]))

    doc.build(story)
    return buffer.getvalue()


def _styled_table(rows: list[list[str]]) -> Table:
    table = Table(rows, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2a78d6")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e1e0d9")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fcfcfb")]),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table
