from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.networth import NetWorthHistory, NetWorthSummary
from app.services import networth_service

router = APIRouter(prefix="/networth", tags=["networth"])


@router.get("/summary", response_model=NetWorthSummary)
def summary(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> NetWorthSummary:
    return NetWorthSummary(**networth_service.get_networth_summary(db, current_user.id))


@router.get("/history", response_model=NetWorthHistory)
def history(
    months: int = Query(6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NetWorthHistory:
    points = networth_service.get_networth_history(db, current_user.id, months=months)
    return NetWorthHistory(points=points)
