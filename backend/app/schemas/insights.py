from pydantic import BaseModel


class MonthlyTrendPoint(BaseModel):
    month: str
    total_spent: float


class MonthlyTrendResponse(BaseModel):
    points: list[MonthlyTrendPoint]


class CategoryComparisonRow(BaseModel):
    category: str
    current: float
    previous: float
    delta: float
    delta_pct: float | None


class CategoryComparisonResponse(BaseModel):
    month: str
    previous_month: str
    categories: list[CategoryComparisonRow]
