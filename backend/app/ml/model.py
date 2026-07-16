import os

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from app.config import get_settings
from app.ml.features import FEATURE_COLUMNS

settings = get_settings()

RANDOM_STATE = 42


def _model_path(key: str) -> str:
    os.makedirs(settings.models_dir, exist_ok=True)
    return os.path.join(settings.models_dir, f"{key}.joblib")


def train_model(feature_df: pd.DataFrame, contamination: float) -> IsolationForest:
    contamination = min(max(contamination, 0.001), 0.5)
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=RANDOM_STATE,
    )
    model.fit(feature_df[FEATURE_COLUMNS].to_numpy())
    return model


def score(model: IsolationForest, feature_df: pd.DataFrame) -> np.ndarray:
    """Lower score = more anomalous (raw sklearn decision_function convention)."""
    return model.decision_function(feature_df[FEATURE_COLUMNS].to_numpy())


def save_model(model: IsolationForest, key: str) -> None:
    joblib.dump(model, _model_path(key))


def load_model(key: str) -> IsolationForest | None:
    path = _model_path(key)
    if not os.path.exists(path):
        return None
    return joblib.load(path)


def delete_model(key: str) -> None:
    path = _model_path(key)
    if os.path.exists(path):
        os.remove(path)
