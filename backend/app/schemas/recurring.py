from datetime import date

from pydantic import BaseModel


class RecurringSeriesResponse(BaseModel):
    id: int
    display_name: str
    cadence: str
    median_gap_days: float
    expected_amount: float
    amount_stability: str
    occurrences: int
    first_seen: date
    last_seen: date
    next_due_date: date
    confidence: float
    status: str
    is_muted: bool

    model_config = {"from_attributes": True}


class RecurringListResponse(BaseModel):
    series: list[RecurringSeriesResponse]
    total_monthly_cost: float


class RecurringRecomputeResponse(BaseModel):
    active: int
    inactive: int
    total_candidates: int


class RecurringMuteRequest(BaseModel):
    is_muted: bool
