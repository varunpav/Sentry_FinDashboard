from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.insights import CategoryComparisonResponse, MonthlyTrendResponse
from app.services import insights_service

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/monthly-trend", response_model=MonthlyTrendResponse)
def monthly_trend(
    months: int = Query(6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonthlyTrendResponse:
    points = insights_service.get_monthly_trend(db, current_user.id, months=months)
    return MonthlyTrendResponse(points=points)


@router.get("/category-comparison", response_model=CategoryComparisonResponse)
def category_comparison(
    month: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CategoryComparisonResponse:
    return CategoryComparisonResponse(**insights_service.get_category_comparison(db, current_user.id, month))
