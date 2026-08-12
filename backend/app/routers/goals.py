from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.savings_goal import SavingsGoal
from app.models.user import User
from app.schemas.goal import (
    GoalContributeRequest,
    GoalCreate,
    GoalListResponse,
    GoalResponse,
    GoalUpdate,
)
from app.services import goal_service

router = APIRouter(prefix="/goals", tags=["goals"])


def _to_response(goal: SavingsGoal) -> GoalResponse:
    progress_pct = round(min(goal.current_amount / goal.target_amount, 1.0) * 100, 1) if goal.target_amount else 0.0
    return GoalResponse(
        id=goal.id,
        name=goal.name,
        target_amount=goal.target_amount,
        current_amount=goal.current_amount,
        target_date=goal.target_date,
        status=goal.status,
        progress_pct=progress_pct,
        created_at=goal.created_at,
    )


def _get_or_404(db: Session, user_id: int, goal_id: int) -> SavingsGoal:
    goal = goal_service.get_goal(db, user_id, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.get("", response_model=GoalListResponse)
def list_goals(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> GoalListResponse:
    goals = goal_service.list_goals(db, current_user.id)
    return GoalListResponse(
        goals=[_to_response(g) for g in goals],
        total_saved=round(sum(g.current_amount for g in goals), 2),
        total_target=round(sum(g.target_amount for g in goals), 2),
    )


@router.post("", response_model=GoalResponse)
def create_goal(
    payload: GoalCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GoalResponse:
    goal = goal_service.create_goal(
        db, current_user.id, payload.name, payload.target_amount, payload.target_date
    )
    return _to_response(goal)


@router.put("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    payload: GoalUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GoalResponse:
    goal = _get_or_404(db, current_user.id, goal_id)
    updated = goal_service.update_goal(
        db, goal, name=payload.name, target_amount=payload.target_amount, target_date=payload.target_date
    )
    return _to_response(updated)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    goal = _get_or_404(db, current_user.id, goal_id)
    goal_service.delete_goal(db, goal)


@router.post("/{goal_id}/contribute", response_model=GoalResponse)
def contribute(
    goal_id: int,
    payload: GoalContributeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GoalResponse:
    goal = _get_or_404(db, current_user.id, goal_id)
    updated = goal_service.contribute(db, goal, payload.amount)
    return _to_response(updated)
