from datetime import date, datetime

from pydantic import BaseModel, Field


class GoalCreate(BaseModel):
    name: str
    target_amount: float = Field(gt=0)
    target_date: date | None = None


class GoalUpdate(BaseModel):
    name: str | None = None
    target_amount: float | None = Field(default=None, gt=0)
    target_date: date | None = None


class GoalContributeRequest(BaseModel):
    amount: float = Field(gt=0)


class GoalResponse(BaseModel):
    id: int
    name: str
    target_amount: float
    current_amount: float
    target_date: date | None
    status: str
    progress_pct: float
    created_at: datetime

    model_config = {"from_attributes": True}


class GoalListResponse(BaseModel):
    goals: list[GoalResponse]
    total_saved: float
    total_target: float
