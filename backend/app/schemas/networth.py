from pydantic import BaseModel


class NetWorthSummary(BaseModel):
    assets: float
    liabilities: float
    net_worth: float
    change_30d: float | None
    change_30d_pct: float | None


class NetWorthPoint(BaseModel):
    date: str
    assets: float
    liabilities: float
    net_worth: float


class NetWorthHistory(BaseModel):
    points: list[NetWorthPoint]
