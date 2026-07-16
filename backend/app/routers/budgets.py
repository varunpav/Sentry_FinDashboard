from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.budget import BudgetResponse, BudgetUpsertRequest, SpendingSummary
from app.services import budget_service

router = APIRouter(tags=["budgets"])


def _current_month() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


@router.get("/budgets", response_model=list[BudgetResponse])
def get_budgets(
    month: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BudgetResponse]:
    return budget_service.list_budgets_with_spend(db, current_user.id, month or _current_month())


@router.put("/budgets", response_model=BudgetResponse)
def upsert_budget(
    payload: BudgetUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetResponse:
    budget = budget_service.upsert_budget(db, current_user.id, payload.category, payload.monthly_limit)
    return BudgetResponse(id=budget.id, category=budget.category, monthly_limit=budget.monthly_limit)


@router.get("/spending/summary", response_model=SpendingSummary)
def spending_summary(
    month: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SpendingSummary:
    return budget_service.get_spending_summary(db, current_user.id, month or _current_month())
