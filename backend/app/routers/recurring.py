from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.recurring_series import RecurringSeries
from app.models.user import User
from app.schemas.recurring import (
    RecurringListResponse,
    RecurringMuteRequest,
    RecurringRecomputeResponse,
    RecurringSeriesResponse,
)
from app.services import recurring_service

router = APIRouter(prefix="/recurring", tags=["recurring"])


@router.get("", response_model=RecurringListResponse)
def list_recurring(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RecurringListResponse:
    """Returns every series (active, inactive, and muted) sorted so active/unmuted
    ones lead — the frontend sections the response rather than issuing repeat calls."""
    all_series = (
        db.query(RecurringSeries)
        .filter(RecurringSeries.user_id == current_user.id)
        .order_by(RecurringSeries.next_due_date.asc())
        .all()
    )
    billable = [s for s in all_series if s.status == "active" and not s.is_muted]
    return RecurringListResponse(
        series=[RecurringSeriesResponse.model_validate(s) for s in all_series],
        total_monthly_cost=recurring_service.total_monthly_cost(billable),
    )


@router.get("/upcoming", response_model=list[RecurringSeriesResponse])
def upcoming(
    days: int = Query(14, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RecurringSeriesResponse]:
    horizon = date.today() + timedelta(days=days)
    series = (
        db.query(RecurringSeries)
        .filter(
            RecurringSeries.user_id == current_user.id,
            RecurringSeries.status == "active",
            RecurringSeries.is_muted.is_(False),
            RecurringSeries.next_due_date <= horizon,
        )
        .order_by(RecurringSeries.next_due_date.asc())
        .all()
    )
    return [RecurringSeriesResponse.model_validate(s) for s in series]


@router.post("/refresh", response_model=RecurringRecomputeResponse)
def refresh(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RecurringRecomputeResponse:
    result = recurring_service.detect_and_persist(db, current_user.id)
    return RecurringRecomputeResponse(**result)


@router.post("/{series_id}/mute", response_model=RecurringSeriesResponse)
def mute(
    series_id: int,
    payload: RecurringMuteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RecurringSeriesResponse:
    series = (
        db.query(RecurringSeries)
        .filter(RecurringSeries.id == series_id, RecurringSeries.user_id == current_user.id)
        .first()
    )
    if series is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring series not found")
    series.is_muted = payload.is_muted
    db.commit()
    db.refresh(series)
    return RecurringSeriesResponse.model_validate(series)
