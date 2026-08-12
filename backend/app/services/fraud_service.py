import numpy as np
import pandas as pd
from sqlalchemy import func
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
from app.services.recurring_service import normalize_merchant

settings = get_settings()

GLOBAL_MODEL_KEY = "global"


_EXPENSE_COLUMNS = [
    "id",
    "amount",
    "date",
    "transacted_at",
    "merchant_name",
    "category_primary",
    "flag_status",
]


def _fetch_expense_df(db: Session, user_id: int) -> pd.DataFrame:
    # The feature matrix (and thus what the fraud model learns as "normal") uses the
    # user's corrected category when one exists -- a recategorized transaction should
    # shift the model's notion of that category's typical spend on the next scoring pass.
    # flag_status is a LEFT JOIN (most transactions have no fraud flag at all) and feeds
    # training-set curation -- see _curate_training_frame.
    rows = (
        db.query(
            Transaction.id,
            Transaction.amount,
            Transaction.date,
            Transaction.transacted_at,
            Transaction.merchant_name,
            Transaction.effective_category,
            FraudFlag.status,
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .outerjoin(FraudFlag, FraudFlag.transaction_id == Transaction.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(Transaction.amount > 0)
        .filter(
            Transaction.effective_category.is_(None)
            | Transaction.effective_category.notin_(EXCLUDED_CATEGORIES)
        )
        .all()
    )
    if not rows:
        return pd.DataFrame(columns=_EXPENSE_COLUMNS)
    return pd.DataFrame(rows, columns=_EXPENSE_COLUMNS)


def get_feature_matrix_for_user(db: Session, user_id: int) -> pd.DataFrame:
    raw = _fetch_expense_df(db, user_id)
    feature_df = build_feature_frame(raw)
    # build_feature_frame is deliberately feedback-unaware (pure feature engineering);
    # merge the flag status back on by id here so training-set curation can use it.
    if feature_df.empty:
        feature_df["flag_status"] = pd.Series(dtype=object)
        return feature_df
    return feature_df.merge(raw[["id", "flag_status"]], on="id", how="left")


def _curate_training_frame(feature_df: pd.DataFrame) -> pd.DataFrame:
    """Curates the raw feature matrix into what actually gets fit.

    Confirmed-fraud rows are dropped outright -- they're not examples of "normal" and
    today silently contaminate the very distribution the model calls normal. Dismissed
    rows are upweighted: the user has explicitly said "this is fine," so it should count
    for more when the model learns the shape of normal.

    "Upweighted" means physically repeated in the training frame, not IsolationForest's
    sample_weight param -- verified empirically that sample_weight has no measurable
    effect on this estimator's decision_function (its splitter picks a random threshold
    from each node's actual data range regardless of weight), whereas repeating a row
    does change the fitted trees.
    """
    if feature_df.empty or "flag_status" not in feature_df.columns:
        return feature_df

    curated = feature_df[feature_df["flag_status"] != "confirmed"]
    if curated.empty:
        # Degenerate case: every row for this user is confirmed fraud. Fall back to the
        # unfiltered frame rather than training on nothing.
        curated = feature_df

    dismissed = curated[curated["flag_status"] == "dismissed"]
    repeat = max(settings.fraud_dismissed_repeat_count, 1)
    if not dismissed.empty and repeat > 1:
        curated = pd.concat([curated] + [dismissed] * (repeat - 1), ignore_index=True)

    return curated


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
    training_df = _curate_training_frame(combined)
    trained = ml_model.train_model(training_df, settings.fraud_anomaly_threshold_percentile / 100)
    ml_model.save_model(trained, GLOBAL_MODEL_KEY)
    return trained


def _get_model_for_user(db: Session, user_id: int, feature_df: pd.DataFrame) -> ml_model.IsolationForest | None:
    if len(feature_df) >= settings.fraud_min_transactions_for_personal_model:
        training_df = _curate_training_frame(feature_df)
        trained = ml_model.train_model(training_df, settings.fraud_anomaly_threshold_percentile / 100)
        ml_model.save_model(trained, f"user_{user_id}")
        return trained

    global_model = ml_model.load_model(GLOBAL_MODEL_KEY)
    if global_model is None:
        global_model = _train_global_model(db)
    return global_model


def _dismissed_merchant_stats(db: Session, user_id: int) -> dict[str, dict]:
    """Per normalized merchant, how many times this user has dismissed a flag there.

    Reuses recurring_service.normalize_merchant for the grouping key so "Netflix" and
    "NETFLIX #123" collapse together the same way they already do for recurring
    detection, rather than introducing a second normalizer.
    """
    rows = (
        db.query(Transaction.merchant_name)
        .join(FraudFlag, FraudFlag.transaction_id == Transaction.id)
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .filter(FraudFlag.status == "dismissed")
        .all()
    )
    stats: dict[str, dict] = {}
    for (merchant_name,) in rows:
        display = merchant_name or "Unknown merchant"
        key = normalize_merchant(display)
        entry = stats.setdefault(key, {"display": display, "count": 0})
        entry["count"] += 1
    return stats


def feedback_summary(db: Session, user_id: int) -> dict:
    status_counts = dict(
        db.query(FraudFlag.status, func.count(FraudFlag.id))
        .join(Transaction, FraudFlag.transaction_id == Transaction.id)
        .join(Account, Transaction.account_id == Account.id)
        .join(PlaidItem, Account.item_id == PlaidItem.id)
        .filter(PlaidItem.user_id == user_id)
        .group_by(FraudFlag.status)
        .all()
    )
    merchant_stats = _dismissed_merchant_stats(db, user_id)
    suppressed_merchants = sorted(
        (
            {"merchant": v["display"], "dismissals": v["count"]}
            for v in merchant_stats.values()
            if v["count"] >= settings.fraud_merchant_suppression_min_dismissals
        ),
        key=lambda m: -m["dismissals"],
    )
    return {
        "dismissed_count": status_counts.get("dismissed", 0),
        "confirmed_count": status_counts.get("confirmed", 0),
        "pending_count": status_counts.get("pending", 0),
        "suppressed_merchants": suppressed_merchants,
    }


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

    threshold_pct = settings.fraud_anomaly_threshold_percentile
    cutoff = np.percentile(scores, threshold_pct)
    # A merchant the user has dismissed enough times needs a stricter (lower, since
    # decision_function is negative for anomalies) cutoff to flag again -- a raised bar,
    # not a whitelist. Extreme charges at that merchant still clear it and get flagged.
    suppressed_cutoff = np.percentile(
        scores, threshold_pct * settings.fraud_merchant_suppression_percentile_ratio
    )
    dismissed_merchants = _dismissed_merchant_stats(db, user_id)
    min_dismissals = settings.fraud_merchant_suppression_min_dismissals

    target_ids = set(transaction_ids)
    candidates = feature_df[feature_df["id"].isin(target_ids)]

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

        merchant_key = normalize_merchant(row["merchant_name"] or "")
        is_suppressed = dismissed_merchants.get(merchant_key, {}).get("count", 0) >= min_dismissals
        effective_cutoff = suppressed_cutoff if is_suppressed else cutoff
        if row["anomaly_score"] > effective_cutoff:
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
