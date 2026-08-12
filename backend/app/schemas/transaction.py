from datetime import date

from pydantic import BaseModel


class TransactionResponse(BaseModel):
    id: int
    account_id: int
    account_name: str | None = None
    amount: float
    date: date
    merchant_name: str | None
    name: str | None
    category_primary: str | None
    category_detailed: str | None
    category_override: str | None
    effective_category: str | None
    payment_channel: str | None
    pending: bool
    is_flagged: bool = False

    model_config = {"from_attributes": True}


class PaginatedTransactions(BaseModel):
    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int


class TransactionCategoryUpdate(BaseModel):
    category_override: str | None = None
