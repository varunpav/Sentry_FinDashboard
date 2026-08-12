from datetime import date

from sqlalchemy import case
from sqlalchemy.orm import Session

from app.models.savings_goal import SavingsGoal

_STATUS_ORDER = case(
    (SavingsGoal.status == "active", 0),
    (SavingsGoal.status == "achieved", 1),
    (SavingsGoal.status == "archived", 2),
    else_=3,
)


def list_goals(db: Session, user_id: int) -> list[SavingsGoal]:
    return (
        db.query(SavingsGoal)
        .filter(SavingsGoal.user_id == user_id)
        .order_by(_STATUS_ORDER, SavingsGoal.target_date.is_(None), SavingsGoal.target_date.asc())
        .all()
    )


def create_goal(
    db: Session, user_id: int, name: str, target_amount: float, target_date: date | None
) -> SavingsGoal:
    goal = SavingsGoal(
        user_id=user_id,
        name=name,
        target_amount=target_amount,
        current_amount=0.0,
        target_date=target_date,
        status="active",
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def get_goal(db: Session, user_id: int, goal_id: int) -> SavingsGoal | None:
    return (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id)
        .first()
    )


def update_goal(
    db: Session,
    goal: SavingsGoal,
    name: str | None = None,
    target_amount: float | None = None,
    target_date: date | None = None,
) -> SavingsGoal:
    if name is not None:
        goal.name = name
    if target_amount is not None:
        goal.target_amount = target_amount
    if target_date is not None:
        goal.target_date = target_date
    _sync_status(goal)
    db.commit()
    db.refresh(goal)
    return goal


def delete_goal(db: Session, goal: SavingsGoal) -> None:
    db.delete(goal)
    db.commit()


def contribute(db: Session, goal: SavingsGoal, amount: float) -> SavingsGoal:
    goal.current_amount = round(goal.current_amount + amount, 2)
    _sync_status(goal)
    db.commit()
    db.refresh(goal)
    return goal


def _sync_status(goal: SavingsGoal) -> None:
    if goal.status == "archived":
        return
    goal.status = "achieved" if goal.current_amount >= goal.target_amount else "active"
