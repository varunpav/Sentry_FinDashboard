from datetime import datetime, time

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "log_amount",
    "category_zscore",
    "new_merchant",
    "days_since_last_at_merchant",
    "hour_of_day",
    "day_of_week",
    "velocity_24h",
    "category_rarity",
]


def _as_timestamp(row: pd.Series) -> pd.Timestamp:
    if pd.notna(row.get("transacted_at")):
        return pd.Timestamp(row["transacted_at"])
    return pd.Timestamp(datetime.combine(row["date"], time(hour=12)))


def build_feature_frame(transactions: pd.DataFrame) -> pd.DataFrame:
    """Engineers anomaly-detection features from a user's raw expense transactions.

    Expects columns: id, amount, date, transacted_at (nullable), merchant_name,
    category_primary. Only expenses (amount > 0) should be passed in — the caller
    is responsible for filtering out income/transfers before calling this.
    """
    if transactions.empty:
        return pd.DataFrame(columns=["id", *FEATURE_COLUMNS])

    df = transactions.copy()
    df["merchant_name"] = df["merchant_name"].fillna("UNKNOWN_MERCHANT")
    df["category_primary"] = df["category_primary"].fillna("OTHER")
    df["timestamp"] = df.apply(_as_timestamp, axis=1)
    df = df.sort_values("timestamp").reset_index(drop=True)

    df["log_amount"] = np.log1p(df["amount"].clip(lower=0))

    cat_stats = df.groupby("category_primary")["amount"].agg(["mean", "std"]).rename(
        columns={"mean": "cat_mean", "std": "cat_std"}
    )
    df = df.merge(cat_stats, left_on="category_primary", right_index=True, how="left")
    df["cat_std"] = df["cat_std"].replace(0, np.nan)
    df["category_zscore"] = ((df["amount"] - df["cat_mean"]) / df["cat_std"]).fillna(0.0)

    first_seen = df.groupby("merchant_name")["timestamp"].transform("min")
    df["new_merchant"] = (df["timestamp"] == first_seen).astype(int)

    df["prev_at_merchant"] = df.groupby("merchant_name")["timestamp"].shift(1)
    gap_days = (df["timestamp"] - df["prev_at_merchant"]).dt.total_seconds() / 86400.0
    df["days_since_last_at_merchant"] = gap_days.fillna(365.0).clip(upper=365.0)

    df["hour_of_day"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek

    df = df.set_index("timestamp")
    rolling_counts = []
    times = df.index.to_list()
    for i, t in enumerate(times):
        window_start = t - pd.Timedelta(hours=24)
        count = sum(1 for other in times[: i + 1] if other > window_start)
        rolling_counts.append(count)
    df["velocity_24h"] = rolling_counts
    df = df.reset_index()

    category_counts = df["category_primary"].value_counts()
    total = len(df)
    df["category_rarity"] = df["category_primary"].map(lambda c: 1.0 - (category_counts[c] / total))

    descriptive_columns = ["id", "amount", "category_primary", "merchant_name", "cat_mean"]
    return df[[*descriptive_columns, *FEATURE_COLUMNS]]
