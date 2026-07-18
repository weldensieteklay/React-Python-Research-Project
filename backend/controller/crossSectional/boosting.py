from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
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
N_ESTIMATORS_MAX = 200      # upper cap; early stopping may use fewer
LEARNING_RATE = 0.1

# Early stopping: sklearn carves off this fraction of the TRAINING split
# internally to monitor validation loss, and halts boosting once it stops
# improving for N_ITER_NO_CHANGE consecutive rounds. This is the standard
# practitioner technique for preventing boosting from overfitting to noise
# (especially relevant here given the large number of sparse dummy
# predictors) — a cheaper and more standard alternative to grid-searching
# n_estimators via full k-fold CV.
VALIDATION_FRACTION = 0.1
N_ITER_NO_CHANGE = 10
TOL = 1e-4

# subsample < 1.0 turns this into STOCHASTIC gradient boosting: each tree
# is fit on a random subsample of the training data, which (a) adds a
# regularizing effect and (b) unlocks oob_improvement_, a free
# out-of-bag-style diagnostic similar in spirit to Bagging's OOB score,
# though it measures per-iteration loss improvement rather than a direct
# R^2/accuracy.
SUBSAMPLE = 0.8

# Folds for the supplementary external k-fold CV robustness check —
# separate from early stopping above, which only affects the primary
# model's iteration count.
CV_FOLDS = 5
CV_N_ESTIMATORS_MAX = 100  # lighter cap during the CV loop to control runtime


# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────

def sanitize(obj):
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


def build_feature_importances(model, columns):
    importances = {str(k): round(float(v), 6) for k, v in zip(columns, model.feature_importances_)}
    ranked = sorted(importances.items(), key=lambda x: x[1], reverse=True)
    return importances, ranked


def build_oob_diagnostics(model):
    """
    Only meaningful when SUBSAMPLE < 1.0 (stochastic gradient boosting).
    oob_improvement_[i] is the improvement in loss on out-of-bag samples
    at boosting iteration i relative to the previous iteration — summing
    it gives a rough sense of total out-of-bag-estimated improvement,
    analogous in spirit (not in units) to Bagging's OOB R^2/accuracy.
    """
    try:
        oob_improvement = model.oob_improvement_
        return {
            "subsample": SUBSAMPLE,
            "n_iterations_fit": int(len(oob_improvement)),
            "cumulative_oob_improvement": round(float(np.sum(oob_improvement)), 6),
            "note": (
                "oob_improvement_ measures per-iteration loss reduction on "
                "out-of-bag samples (only available because subsample < 1.0). "
                "This is a rough free diagnostic of whether boosting is still "
                "improving on unseen data, not a direct R^2/accuracy — use "
                "the external k-fold CV section below for a more directly "
                "interpretable robustness estimate."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def build_classification_metrics(y_true, y_pred, y_prob):
    try:
        return {
            "accuracy":               round(float(accuracy_score(y_true, y_pred)), 4),
            "roc_auc":                round(float(roc_auc_score(y_true, y_prob)), 4),
            "log_loss":               round(float(log_loss(y_true, y_prob)), 4),
            "brier_score":            round(float(brier_score_loss(y_true, y_prob)), 4),
            "confusion_matrix":       confusion_matrix(y_true, y_pred).tolist(),
            "classification_report":  classification_report(y_true, y_pred, output_dict=True),
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────
# PRIMARY MODEL PATHS
# ─────────────────────────────────────────

def _run_continuous(X_train, X_test, y_train, y_test):
    model = GradientBoostingRegressor(
        n_estimators=N_ESTIMATORS_MAX,
        learning_rate=LEARNING_RATE,
        subsample=SUBSAMPLE,
        validation_fraction=VALIDATION_FRACTION,
        n_iter_no_change=N_ITER_NO_CHANGE,
        tol=TOL,
        random_state=RANDOM_STATE,
    )
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    importances, ranked = build_feature_importances(model, X_train.columns)
    oob_diagnostics = build_oob_diagnostics(model)

    return {
        "model":               "GRADIENT_BOOSTING",
        "target_type":         "continuous",
        "n_estimators_max":    N_ESTIMATORS_MAX,
        "n_estimators_used":   int(model.n_estimators_),  # may be < max due to early stopping
        "early_stopped":       bool(model.n_estimators_ < N_ESTIMATORS_MAX),
        "r2_score":            round(float(r2_score(y_test, predictions)), 4),
        "mse":                 round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":                 round(float(mean_absolute_error(y_test, predictions)), 4),
        "oob_diagnostics":     oob_diagnostics,
        "feature_importances":        importances,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        # Kept for backward compatibility with existing frontend
        "feature_importance": importances,
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    model = GradientBoostingClassifier(
        n_estimators=N_ESTIMATORS_MAX,
        learning_rate=LEARNING_RATE,
        subsample=SUBSAMPLE,
        validation_fraction=VALIDATION_FRACTION,
        n_iter_no_change=N_ITER_NO_CHANGE,
        tol=TOL,
        random_state=RANDOM_STATE,
    )
    model.fit(X_train, y_train)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= threshold).astype(int)

    importances, ranked = build_feature_importances(model, X_train.columns)
    oob_diagnostics = build_oob_diagnostics(model)
    classification = build_classification_metrics(y_test, y_pred, y_prob)

    return {
        "model":               "GRADIENT_BOOSTING_CLASSIFIER",
        "target_type":         "binary",
        "threshold":           threshold,
        "n_estimators_max":    N_ESTIMATORS_MAX,
        "n_estimators_used":   int(model.n_estimators_),
        "early_stopped":       bool(model.n_estimators_ < N_ESTIMATORS_MAX),
        "oob_diagnostics":     oob_diagnostics,
        **classification,
        "feature_importances":        importances,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        "feature_importance": importances,
    }


# ─────────────────────────────────────────
# SUPPLEMENTARY EXTERNAL K-FOLD CROSS-VALIDATION
# ─────────────────────────────────────────

def run_kfold_cv_continuous(X, y, k=CV_FOLDS, random_state=RANDOM_STATE):
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
            fold_model = GradientBoostingRegressor(
                n_estimators=CV_N_ESTIMATORS_MAX,
                learning_rate=LEARNING_RATE,
                subsample=SUBSAMPLE,
                validation_fraction=VALIDATION_FRACTION,
                n_iter_no_change=N_ITER_NO_CHANGE,
                tol=TOL,
                random_state=random_state,
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
            "n_estimators_used": int(fold_model.n_estimators_),
            "r2": round(float(r2), 4), "rmse": round(float(rmse), 4), "mae": round(float(mae), 4),
        })

    return {
        "k_folds": k,
        "n_estimators_max_per_fold": CV_N_ESTIMATORS_MAX,
        "fold_results": fold_results,
        "r2_mean": round(float(np.mean(fold_r2)), 4),
        "r2_std":  round(float(np.std(fold_r2)), 4),
        "rmse_mean": round(float(np.mean(fold_rmse)), 4),
        "rmse_std":  round(float(np.std(fold_rmse)), 4),
        "mae_mean": round(float(np.mean(fold_mae)), 4),
        "mae_std":  round(float(np.std(fold_mae)), 4),
        "note": (
            f"Uses a lower n_estimators cap ({CV_N_ESTIMATORS_MAX}, still with "
            f"early stopping) per fold to keep runtime reasonable. Compare "
            f"r2_mean/r2_std here against the single-split r2_score above to "
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
            fold_model = GradientBoostingClassifier(
                n_estimators=CV_N_ESTIMATORS_MAX,
                learning_rate=LEARNING_RATE,
                subsample=SUBSAMPLE,
                validation_fraction=VALIDATION_FRACTION,
                n_iter_no_change=N_ITER_NO_CHANGE,
                tol=TOL,
                random_state=random_state,
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
            "n_estimators_used": int(fold_model.n_estimators_),
            "accuracy": round(float(acc), 4), "roc_auc": round(float(auc), 4),
            "log_loss": round(float(ll), 4),
        })

    return {
        "k_folds": k,
        "n_estimators_max_per_fold": CV_N_ESTIMATORS_MAX,
        "fold_results": fold_results,
        "accuracy_mean": round(float(np.mean(fold_acc)), 4),
        "accuracy_std":  round(float(np.std(fold_acc)), 4),
        "roc_auc_mean": round(float(np.mean(fold_auc)), 4),
        "roc_auc_std":  round(float(np.std(fold_auc)), 4),
        "log_loss_mean": round(float(np.mean(fold_ll)), 4),
        "log_loss_std":  round(float(np.std(fold_ll)), 4),
        "note": (
            f"Uses a lower n_estimators cap ({CV_N_ESTIMATORS_MAX}, still with "
            f"early stopping) per fold to keep runtime reasonable."
        ),
    }


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_gradient_boosting_cross_sectional_prediction(request):
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
            raise ValueError("Dataset too small for Gradient Boosting")

        # ── Auto-detect binary vs continuous ──
        is_binary = set(y.unique()).issubset({0, 1})

        # Guard: stratified split needs enough rows per class (previously
        # missing).
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