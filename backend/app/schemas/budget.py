from pydantic import BaseModel, Field


class BudgetUpsertRequest(BaseModel):
    category: str
    monthly_limit: float = Field(gt=0)


class BudgetResponse(BaseModel):
    id: int
    category: str
    monthly_limit: float
    spent: float = 0.0

    model_config = {"from_attributes": True}


class CategorySpend(BaseModel):
    category: str
    spent: float
    budget: float | None = None


class DailySpendPoint(BaseModel):
    date: str
    amount: float


class SpendingSummary(BaseModel):
    month: str
    total_spent: float
    total_budget: float
    by_category: list[CategorySpend]
    daily_spend: list[DailySpendPoint]
