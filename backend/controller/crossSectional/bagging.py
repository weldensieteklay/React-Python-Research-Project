from sklearn.ensemble import BaggingRegressor, BaggingClassifier
from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier
from sklearn.metrics import (
    r2_score, mean_squared_error, mean_absolute_error,
    accuracy_score, roc_auc_score, log_loss,
    confusion_matrix, classification_report, brier_score_loss,
)
from sklearn.model_selection import train_test_split, KFold, StratifiedKFold
from fastapi.responses import JSONResponse
import numpy as np
import pandas as pd
import math

from controller.crossSectional.helpers import prepare_dataset

RANDOM_STATE = 42
N_ESTIMATORS = 100

# Folds for the supplementary external k-fold CV robustness check (see
# run_kfold_cv_* below). Kept separate from OOB scoring, which is the
# primary/cheap CV-equivalent for bagging ensembles.
CV_FOLDS = 5
# Bagging with 100 trees per fold, times CV_FOLDS folds, is meaningfully
# more expensive than a single fit. Using fewer trees during the CV loop
# keeps runtime reasonable while still giving a representative estimate of
# performance stability — the PRIMARY reported model below still uses the
# full N_ESTIMATORS.
CV_N_ESTIMATORS = 50


# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────

def sanitize(obj):
    """Recursively replace nan/inf/numpy types with JSON-safe equivalents."""
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, (np.floating, np.float32, np.float64)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    return obj


def build_feature_importances(estimators, columns):
    importances = np.mean([tree.feature_importances_ for tree in estimators], axis=0)
    importance_std = np.std([tree.feature_importances_ for tree in estimators], axis=0)
    feature_importances = {str(k): round(float(v), 6) for k, v in zip(columns, importances)}
    feature_importances_std = {str(k): round(float(v), 6) for k, v in zip(columns, importance_std)}
    ranked = sorted(feature_importances.items(), key=lambda x: x[1], reverse=True)
    return feature_importances, feature_importances_std, ranked


def build_classification_metrics(y_true, y_pred, y_prob):
    """
    Wrapped in try/except (mirroring the Logit handler's pattern): with a
    small or heavily imbalanced test fold, roc_auc_score/log_loss can fail
    if only one class is present in y_true — report an explicit error for
    that metric rather than crashing the whole response.
    """
    try:
        return {
            "accuracy":              round(float(accuracy_score(y_true, y_pred)), 4),
            "roc_auc":               round(float(roc_auc_score(y_true, y_prob)), 4),
            "log_loss":              round(float(log_loss(y_true, y_prob)), 4),
            "brier_score":           round(float(brier_score_loss(y_true, y_prob)), 4),
            "confusion_matrix":      confusion_matrix(y_true, y_pred).tolist(),
            "classification_report": classification_report(y_true, y_pred, output_dict=True),
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────
# PRIMARY MODEL PATHS
# ─────────────────────────────────────────

def _run_continuous(X_train, X_test, y_train, y_test):
    """Bagging regression path, with OOB score added as a free CV-equivalent."""
    base_model = DecisionTreeRegressor(random_state=RANDOM_STATE)
    model = BaggingRegressor(
        estimator=base_model,
        n_estimators=N_ESTIMATORS,
        oob_score=True,   # enables the free out-of-bag estimate below
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    feature_importances, feature_importances_std, ranked = build_feature_importances(
        model.estimators_, X_train.columns
    )

    try:
        oob_score = round(float(model.oob_score_), 4)
    except Exception:
        # oob_score_ can be unavailable if bootstrap sampling happened to
        # leave some training rows with zero out-of-bag predictions
        # (rare, but possible with small datasets or few estimators).
        oob_score = None

    return {
        "model":        "BAGGING",
        "target_type":  "continuous",
        "n_estimators": N_ESTIMATORS,
        "r2_score":     round(float(r2_score(y_test, predictions)), 4),
        "mse":          round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":          round(float(mean_absolute_error(y_test, predictions)), 4),
        # Out-of-bag R^2 — computed on training rows using only the trees
        # that did NOT see that row during bootstrap sampling. This is a
        # near-free cross-validation-style estimate that comes from the
        # single model fit above, with no extra training required.
        "oob_r2_score": oob_score,
        "feature_importances":        feature_importances,
        "feature_importances_std":    feature_importances_std,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        # Keep old key for backward compatibility with existing frontend
        "feature_importance": feature_importances,
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    """
    Bagging classifier for binary (0/1) targets, with OOB accuracy added
    as a free CV-equivalent. No scaling needed — tree models are
    scale-invariant.
    """
    base_model = DecisionTreeClassifier(random_state=RANDOM_STATE)
    model = BaggingClassifier(
        estimator=base_model,
        n_estimators=N_ESTIMATORS,
        oob_score=True,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= threshold).astype(int)

    feature_importances, feature_importances_std, ranked = build_feature_importances(
        model.estimators_, X_train.columns
    )

    try:
        oob_score = round(float(model.oob_score_), 4)
    except Exception:
        oob_score = None

    classification = build_classification_metrics(y_test, y_pred, y_prob)

    return {
        "model":        "BAGGING_CLASSIFIER",
        "target_type":  "binary",
        "threshold":    threshold,
        "n_estimators": N_ESTIMATORS,
        # Out-of-bag accuracy — see note in _run_continuous above.
        "oob_accuracy": oob_score,
        **classification,
        "feature_importances":        feature_importances,
        "feature_importances_std":    feature_importances_std,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        "feature_importance": feature_importances,
    }


# ─────────────────────────────────────────
# SUPPLEMENTARY EXTERNAL K-FOLD CROSS-VALIDATION
# ─────────────────────────────────────────

def run_kfold_cv_continuous(X, y, k=CV_FOLDS, random_state=RANDOM_STATE):
    """
    Independent robustness check, separate from OOB scoring above: refits
    a (lighter, CV_N_ESTIMATORS-tree) Bagging regressor across k different
    train/validation partitions of the full dataset and reports the
    spread of out-of-sample R^2/RMSE/MAE. OOB and k-fold CV can disagree
    somewhat since OOB estimates performance from bootstrap resampling of
    a single training set, while k-fold CV re-partitions the data
    entirely — reporting both gives a fuller picture.
    """
    min_rows_needed = k * 5
    if len(X) < min_rows_needed:
        return {"error": f"Dataset too small for {k}-fold CV (need at least {min_rows_needed} rows, have {len(X)})."}

    kf = KFold(n_splits=k, shuffle=True, random_state=random_state)
    X_reset, y_reset = X.reset_index(drop=True), y.reset_index(drop=True)
    fold_results, fold_r2, fold_rmse, fold_mae = [], [], [], []

    for fold_idx, (train_idx, val_idx) in enumerate(kf.split(X_reset), start=1):
        X_tr, X_val = X_reset.iloc[train_idx], X_reset.iloc[val_idx]
        y_tr, y_val = y_reset.iloc[train_idx], y_reset.iloc[val_idx]
        try:
            fold_model = BaggingRegressor(
                estimator=DecisionTreeRegressor(random_state=random_state),
                n_estimators=CV_N_ESTIMATORS,
                random_state=random_state,
                n_jobs=-1,
            )
            fold_model.fit(X_tr, y_tr)
            preds = fold_model.predict(X_val)
            r2 = r2_score(y_val, preds)
            rmse = mean_squared_error(y_val, preds) ** 0.5
            mae = mean_absolute_error(y_val, preds)
        except Exception as e:
            return {"error": f"Fold {fold_idx} failed: {str(e)}"}

        fold_r2.append(r2); fold_rmse.append(rmse); fold_mae.append(mae)
        fold_results.append({
            "fold": fold_idx, "n_train": len(X_tr), "n_val": len(X_val),
            "r2": round(float(r2), 4), "rmse": round(float(rmse), 4), "mae": round(float(mae), 4),
        })

    return {
        "k_folds": k,
        "n_estimators_per_fold": CV_N_ESTIMATORS,
        "fold_results": fold_results,
        "r2_mean": round(float(np.mean(fold_r2)), 4),
        "r2_std":  round(float(np.std(fold_r2)), 4),
        "rmse_mean": round(float(np.mean(fold_rmse)), 4),
        "rmse_std":  round(float(np.std(fold_rmse)), 4),
        "mae_mean": round(float(np.mean(fold_mae)), 4),
        "mae_std":  round(float(np.std(fold_mae)), 4),
        "note": (
            f"Uses {CV_N_ESTIMATORS} trees per fold (vs. {N_ESTIMATORS} for the "
            f"primary reported model above) to keep runtime reasonable. "
            f"Supplementary robustness check — compare r2_mean/r2_std here "
            f"and oob_r2_score above against the single-split r2_score to "
            f"gauge how stable the model's performance is."
        ),
    }


def run_kfold_cv_binary(X, y, k=CV_FOLDS, random_state=RANDOM_STATE, threshold=0.5):
    min_rows_needed = k * 5
    if len(X) < min_rows_needed:
        return {"error": f"Dataset too small for {k}-fold CV (need at least {min_rows_needed} rows, have {len(X)})."}
    class_counts = y.value_counts()
    if class_counts.min() < k:
        return {"error": f"Minority class has only {int(class_counts.min())} observation(s), fewer than {k} folds."}

    skf = StratifiedKFold(n_splits=k, shuffle=True, random_state=random_state)
    X_reset, y_reset = X.reset_index(drop=True), y.reset_index(drop=True)
    fold_results, fold_acc, fold_auc, fold_ll = [], [], [], []

    for fold_idx, (train_idx, val_idx) in enumerate(skf.split(X_reset, y_reset), start=1):
        X_tr, X_val = X_reset.iloc[train_idx], X_reset.iloc[val_idx]
        y_tr, y_val = y_reset.iloc[train_idx], y_reset.iloc[val_idx]
        try:
            fold_model = BaggingClassifier(
                estimator=DecisionTreeClassifier(random_state=random_state),
                n_estimators=CV_N_ESTIMATORS,
                random_state=random_state,
                n_jobs=-1,
            )
            fold_model.fit(X_tr, y_tr)
            prob = fold_model.predict_proba(X_val)[:, 1]
            pred = (prob >= threshold).astype(int)
            acc = accuracy_score(y_val, pred)
            auc = roc_auc_score(y_val, prob)
            ll = log_loss(y_val, prob)
        except Exception as e:
            return {"error": f"Fold {fold_idx} failed: {str(e)}"}

        fold_acc.append(acc); fold_auc.append(auc); fold_ll.append(ll)
        fold_results.append({
            "fold": fold_idx, "n_train": len(X_tr), "n_val": len(X_val),
            "accuracy": round(float(acc), 4), "roc_auc": round(float(auc), 4),
            "log_loss": round(float(ll), 4),
        })

    return {
        "k_folds": k,
        "n_estimators_per_fold": CV_N_ESTIMATORS,
        "fold_results": fold_results,
        "accuracy_mean": round(float(np.mean(fold_acc)), 4),
        "accuracy_std":  round(float(np.std(fold_acc)), 4),
        "roc_auc_mean": round(float(np.mean(fold_auc)), 4),
        "roc_auc_std":  round(float(np.std(fold_auc)), 4),
        "log_loss_mean": round(float(np.mean(fold_ll)), 4),
        "log_loss_std":  round(float(np.std(fold_ll)), 4),
        "note": (
            f"Uses {CV_N_ESTIMATORS} trees per fold (vs. {N_ESTIMATORS} for the "
            f"primary reported model above) to keep runtime reasonable. "
            f"Compare against oob_accuracy above and the single-split "
            f"accuracy/roc_auc to gauge performance stability."
        ),
    }


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_bagging_cross_sectional_prediction(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        remove_outliers  = payload.get("outliers", False)
        threshold        = float(payload.get("threshold", 0.5))

        # ── Validation (previously missing) ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")

        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        if len(X) < 5:
            raise ValueError("Dataset too small for Bagging")

        # ── Auto-detect binary vs continuous ──
        is_binary = set(y.unique()).issubset({0, 1})

        # Guard: stratified split needs enough rows per class (previously
        # missing — train_test_split would otherwise fail with a less
        # helpful sklearn-internal error message).
        if is_binary:
            class_counts = y.value_counts()
            if class_counts.min() < 2:
                raise ValueError(
                    f"Minority class has only {int(class_counts.min())} "
                    f"observation(s) — need at least 2 to create a "
                    f"stratified train/test split."
                )

        # ── Train / test split ──
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_STATE,
            stratify=y if is_binary else None,
        )

        # ── Branch on target type ──
        if is_binary:
            metrics = _run_binary(X_train, X_test, y_train, y_test, threshold)
            cross_validation = run_kfold_cv_binary(X, y, k=CV_FOLDS, threshold=threshold)
        else:
            metrics = _run_continuous(X_train, X_test, y_train, y_test)
            cross_validation = run_kfold_cv_continuous(X, y, k=CV_FOLDS)

        return JSONResponse(content=sanitize({
            "success":   True,
            "rows_used": len(X),
            **metrics,
            # Supplementary robustness check (external k-fold CV, separate
            # from the near-free OOB estimate already inside `metrics`).
            "cross_validation": cross_validation,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Model execution failed",
                "details": str(e),
            },
            status_code=500,
        )