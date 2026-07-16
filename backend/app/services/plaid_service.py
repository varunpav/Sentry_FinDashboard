from functools import lru_cache

import plaid
from plaid.api import plaid_api
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from app.config import get_settings

settings = get_settings()

_ENV_HOSTS = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


@lru_cache
def get_plaid_client() -> plaid_api.PlaidApi:
    configuration = plaid.Configuration(
        host=_ENV_HOSTS.get(settings.plaid_env, plaid.Environment.Sandbox),
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    api_client = plaid.ApiClient(configuration)
    return plaid_api.PlaidApi(api_client)


def create_link_token(user_id: int) -> str:
    client = get_plaid_client()
    request = LinkTokenCreateRequest(
        products=[Products("transactions")],
        client_name="FinTrack",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=str(user_id)),
    )
    response = client.link_token_create(request)
    return response.link_token


def exchange_public_token(public_token: str) -> tuple[str, str]:
    """Returns (access_token, plaid_item_id)."""
    client = get_plaid_client()
    request = ItemPublicTokenExchangeRequest(public_token=public_token)
    response = client.item_public_token_exchange(request)
    return response.access_token, response.item_id


def get_accounts(access_token: str) -> list[dict]:
    from plaid.model.accounts_get_request import AccountsGetRequest

    client = get_plaid_client()
    request = AccountsGetRequest(access_token=access_token)
    response = client.accounts_get(request)
    return [account.to_dict() for account in response.accounts]


def get_institution_name(institution_id: str | None) -> str | None:
    if not institution_id:
        return None
    from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest

    client = get_plaid_client()
    request = InstitutionsGetByIdRequest(
        institution_id=institution_id, country_codes=[CountryCode("US")]
    )
    try:
        response = client.institutions_get_by_id(request)
        return response.institution.name
    except plaid.ApiException:
        return None


def sync_transactions(access_token: str, cursor: str | None) -> dict:
    """Wraps /transactions/sync, paginating until has_more is False."""
    client = get_plaid_client()
    added: list[dict] = []
    modified: list[dict] = []
    removed: list[dict] = []
    next_cursor = cursor

    while True:
        request_kwargs = {"access_token": access_token}
        if next_cursor:
            request_kwargs["cursor"] = next_cursor
        response = client.transactions_sync(TransactionsSyncRequest(**request_kwargs))
        added.extend(t.to_dict() for t in response.added)
        modified.extend(t.to_dict() for t in response.modified)
        removed.extend(t.to_dict() for t in response.removed)
        next_cursor = response.next_cursor
        if not response.has_more:
            break

    return {
        "added": added,
        "modified": modified,
        "removed": removed,
        "cursor": next_cursor,
    }
