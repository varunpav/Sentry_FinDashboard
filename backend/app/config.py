from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg2://sentry:sentry@localhost:5432/sentry"

    jwt_secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    token_encryption_key: str = ""

    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"

    frontend_origin: str = "http://localhost:3000"

    fraud_anomaly_threshold_percentile: float = 3.0
    fraud_min_transactions_for_personal_model: int = 50

    # Feedback-driven retraining (see docs/design-decisions.md). IsolationForest's
    # sample_weight is accepted but has no measurable effect on decision_function
    # (verified empirically), so "upweighting" a dismissed row means repeating it in
    # the training frame this many times, not literal sample_weight.
    fraud_dismissed_repeat_count: int = 4
    fraud_merchant_suppression_min_dismissals: int = 2
    fraud_merchant_suppression_percentile_ratio: float = 0.33

    models_dir: str = "models"

    resend_api_key: str = ""
    notification_from_email: str = "onboarding@resend.dev"

    # Off in tests (see conftest.py) so pytest never starts a live background thread.
    scheduler_enabled: bool = True
    scheduler_tick_minutes: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
