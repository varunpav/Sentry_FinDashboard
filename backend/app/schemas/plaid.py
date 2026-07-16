from pydantic import BaseModel


class LinkTokenResponse(BaseModel):
    link_token: str


class ExchangeRequest(BaseModel):
    public_token: str


class ExchangeResponse(BaseModel):
    item_id: int
    institution_name: str | None
    accounts_linked: int


class SyncResponse(BaseModel):
    added: int
    modified: int
    removed: int
    new_fraud_flags: int


class AccountResponse(BaseModel):
    id: int
    name: str
    type: str | None
    subtype: str | None
    mask: str | None
    current_balance: float | None
    institution_name: str | None = None

    model_config = {"from_attributes": True}
