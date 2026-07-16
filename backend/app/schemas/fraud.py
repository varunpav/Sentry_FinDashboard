from datetime import date

from pydantic import BaseModel


class FraudFlagResponse(BaseModel):
    id: int
    transaction_id: int
    amount: float
    date: date
    merchant_name: str | None
    category_primary: str | None
    anomaly_score: float
    reasons: list[str]
    status: str

    model_config = {"from_attributes": True}


class FraudFlagStatusUpdate(BaseModel):
    status: str  # confirmed | dismissed


class RetrainResponse(BaseModel):
    trained_users: int
    message: str
