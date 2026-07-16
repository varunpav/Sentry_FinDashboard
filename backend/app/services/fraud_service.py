import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ml import model as ml_model
from app.ml.features import FEATURE_COLUMNS, build_feature_frame
from app.models.account import Account
from app.models.fraud_flag import FraudFlag
from app.models.plaid_item import PlaidItem
from app.models.transaction import Transaction
from app.models.user import User
from app.services.budget_service import EXCLUDED_CATEGORIES

settings = get_settings()

GLOBAL_MODEL_KEY = "global"


def _fetch_expense_df(db: Session, user_id: int) -> pd.DataFrame:
    rows = (
        db.query(
            Transaction.id,
            Transaction.amount,
            Transaction.date,
            Transaction.transacted_at,
            Transaction.merchant_name,
            Transaction.category_primary,
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(Transaction.amount > 0)
        .filter(
            Transaction.category_primary.is_(None)
            | Transaction.category_primary.notin_(EXCLUDED_CATEGORIES)
        )
        .all()
    )
    if not rows:
        return pd.DataFrame(
            columns=["id", "amount", "date", "transacted_at", "merchant_name", "category_primary"]
        )
    return pd.DataFrame(
        rows, columns=["id", "amount", "date", "transacted_at", "merchant_name", "category_primary"]
    )


def get_feature_matrix_for_user(db: Session, user_id: int) -> pd.DataFrame:
    raw = _fetch_expense_df(db, user_id)
    return build_feature_frame(raw)


def _train_global_model(db: Session) -> ml_model.IsolationForest | None:
    all_user_ids = [row[0] for row in db.query(User.id).all()]
    frames = []
    for uid in all_user_ids:
        fdf = get_feature_matrix_for_user(db, uid)
        if not fdf.empty:
            frames.append(fdf)
    if not frames:
        return None

    combined = pd.concat(frames, ignore_index=True)
    trained = ml_model.train_model(combined, settings.fraud_anomaly_threshold_percentile / 100)
    ml_model.save_model(trained, GLOBAL_MODEL_KEY)
    return trained


def _get_model_for_user(db: Session, user_id: int, feature_df: pd.DataFrame) -> ml_model.IsolationForest | None:
    if len(feature_df) >= settings.fraud_min_transactions_for_personal_model:
        trained = ml_model.train_model(feature_df, settings.fraud_anomaly_threshold_percentile / 100)
        ml_model.save_model(trained, f"user_{user_id}")
        return trained

    global_model = ml_model.load_model(GLOBAL_MODEL_KEY)
    if global_model is None:
        global_model = _train_global_model(db)
    return global_model


def _generate_reasons(row: pd.Series) -> list[str]:
    reasons: list[str] = []

    if row["category_zscore"] >= 2.0 and row["cat_mean"] and row["cat_mean"] > 0:
        multiplier = row["amount"] / row["cat_mean"]
        category_label = (row["category_primary"] or "this category").replace("_", " ").title()
        reasons.append(f"Amount is {multiplier:.1f}x your typical {category_label} spend")

    if row["new_merchant"] == 1:
        merchant = row["merchant_name"] or "this merchant"
        reasons.append(f"First transaction at {merchant}")

    if row["hour_of_day"] < 5 or row["hour_of_day"] >= 23:
        reasons.append(f"Unusual time of day ({int(row['hour_of_day']):02d}:00)")

    if row["velocity_24h"] >= 5:
        reasons.append(f"{int(row['velocity_24h'])} transactions in the last 24 hours")

    if row["category_rarity"] >= 0.95:
        category_label = (row["category_primary"] or "this category").replace("_", " ").title()
        reasons.append(f"Rare category for you: {category_label}")

    if not reasons:
        reasons.append("Statistically unusual compared to your typical spending pattern")

    return reasons


def score_transactions_for_user(db: Session, user_id: int, transaction_ids: list[int]) -> int:
    feature_df = get_feature_matrix_for_user(db, user_id)
    if feature_df.empty:
        return 0

    model = _get_model_for_user(db, user_id, feature_df)
    if model is None:
        return 0

    scores = model.decision_function(feature_df[FEATURE_COLUMNS].to_numpy())
    feature_df = feature_df.assign(anomaly_score=scores)

    cutoff = np.percentile(scores, settings.fraud_anomaly_threshold_percentile)

    target_ids = set(transaction_ids)
    candidates = feature_df[
        feature_df["id"].isin(target_ids) & (feature_df["anomaly_score"] <= cutoff)
    ]

    existing_flagged_ids = {
        row[0]
        for row in db.query(FraudFlag.transaction_id)
        .filter(FraudFlag.transaction_id.in_(target_ids))
        .all()
    }

    created = 0
    for _, row in candidates.iterrows():
        if row["id"] in existing_flagged_ids:
            continue
        flag = FraudFlag(
            transaction_id=int(row["id"]),
            anomaly_score=float(row["anomaly_score"]),
            reasons=_generate_reasons(row),
            status="pending",
        )
        db.add(flag)
        created += 1

    if created:
        db.commit()

    return created


def retrain_all_models(db: Session) -> int:
    ml_model.delete_model(GLOBAL_MODEL_KEY)
    user_ids = [row[0] for row in db.query(User.id).all()]
    trained_count = 0
    for uid in user_ids:
        feature_df = get_feature_matrix_for_user(db, uid)
        if feature_df.empty:
            continue
        _get_model_for_user(db, uid, feature_df)
        trained_count += 1
    return trained_count
