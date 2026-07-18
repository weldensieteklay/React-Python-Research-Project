from sklearn.linear_model import LassoCV, LogisticRegressionCV
from sklearn.metrics import (
    r2_score, mean_squared_error, mean_absolute_error,
    accuracy_score, roc_auc_score, log_loss,
    confusion_matrix, classification_report, brier_score_loss,
)
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, KFold, StratifiedKFold
from fastapi.responses import JSONResponse
import numpy as np
import pandas as pd

from controller.crossSectional.helpers import prepare_dataset

# Number of cross-validation folds used to select the regularization
# strength (alpha for Lasso, C=1/alpha for LogisticRegressionCV). 5 is the
# conventional default in both sklearn and R's cv.glmnet.
CV_FOLDS = 5
RANDOM_STATE = 42


def _run_continuous(X_train, X_test, y_train, y_test):
    """
    Cross-validated LASSO for a continuous target — mirrors the standard
    researcher workflow (equivalent to R's cv.glmnet(alpha=1)):
      1. Standardize predictors (LASSO's penalty is scale-dependent, so
         fitting on raw/unscaled features unfairly penalizes
         large-magnitude variables more than small ones).
      2. Use k-fold CV to select alpha from a data-driven path, rather
         than an arbitrary fixed value.
    """
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    cv = KFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    model = LassoCV(cv=cv, max_iter=10000, random_state=RANDOM_STATE, n_alphas=100)
    model.fit(X_train_scaled, y_train)

    predictions = model.predict(X_test_scaled)

    coefficients = {
        str(k): round(float(v), 6)
        for k, v in zip(X_train.columns, model.coef_)
    }
    selected   = [k for k, v in zip(X_train.columns, model.coef_) if abs(v) > 1e-10]
    eliminated = [k for k, v in zip(X_train.columns, model.coef_) if abs(v) <= 1e-10]

    return {
        "model":            "LASSO_CV",
        "target_type":      "continuous",
        "selected_alpha":   round(float(model.alpha_), 6),
        "cv_folds":         CV_FOLDS,
        "r2_score":         round(float(r2_score(y_test, predictions)), 4),
        "mse":              round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":              round(float(mean_absolute_error(y_test, predictions)), 4),
        "coefficients":     coefficients,
        # LASSO has no p-values or std errors — kept None for API consistency
        "standard_errors":      {str(k): None for k in X_train.columns},
        "p_values":              {str(k): None for k in X_train.columns},
        "selected_features":    selected,
        "eliminated_features":  eliminated,
        "note": (
            "Coefficients are in standardized units (StandardScaler applied "
            "before fitting). alpha was selected via 5-fold cross-validation "
            "minimizing mean squared error, matching the standard LASSO "
            "workflow (equivalent to R's cv.glmnet(alpha=1))."
        ),
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    """
    Cross-validated L1 logistic regression for a binary (0/1) target —
    mirrors the standard researcher workflow for penalized logistic
    regression (equivalent to R's cv.glmnet(family="binomial", alpha=1)).
    """
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    model = LogisticRegressionCV(
        penalty="l1",
        solver="saga",
        Cs=20,                 # grid of 20 C values, log-spaced (sklearn default range)
        cv=cv,
        max_iter=10000,
        random_state=RANDOM_STATE,
        scoring="neg_log_loss",
    )
    model.fit(X_train_scaled, y_train)

    y_prob    = model.predict_proba(X_test_scaled)[:, 1]
    y_pred    = (y_prob >= threshold).astype(int)
    coef_vals = model.coef_[0]

    coefficients = {str(k): round(float(v), 6) for k, v in zip(X_train.columns, coef_vals)}
    odds_ratios  = {str(k): round(float(np.exp(v)), 6) for k, v in zip(X_train.columns, coef_vals)}
    selected     = [str(k) for k, v in zip(X_train.columns, coef_vals) if abs(v) > 1e-10]
    eliminated   = [str(k) for k, v in zip(X_train.columns, coef_vals) if abs(v) <= 1e-10]

    # model.C_ is an array (one value per class for multiclass; for binary
    # classification it's a length-1 array holding the selected C).
    selected_C = float(model.C_[0])

    return {
        "model":                    "LASSO_LOGISTIC_CV",
        "target_type":              "binary",
        "threshold":                threshold,
        "selected_C":               round(selected_C, 6),
        "selected_alpha_equivalent": round(1 / selected_C, 6) if selected_C > 0 else None,
        "cv_folds":                 CV_FOLDS,
        "accuracy":                 round(float(accuracy_score(y_test, y_pred)), 4),
        "roc_auc":                  round(float(roc_auc_score(y_test, y_prob)), 4),
        "log_loss":                 round(float(log_loss(y_test, y_prob)), 4),
        "brier_score":              round(float(brier_score_loss(y_test, y_prob)), 4),
        "confusion_matrix":         confusion_matrix(y_test, y_pred).tolist(),
        "classification_report":    classification_report(y_test, y_pred, output_dict=True),
        "coefficients":             coefficients,
        "odds_ratios":              odds_ratios,
        "standard_errors":          {str(k): None for k in X_train.columns},
        "p_values":                 {str(k): None for k in X_train.columns},
        "selected_features":        selected,
        "eliminated_features":      eliminated,
        "note": (
            "Coefficients are in standardized units (StandardScaler applied "
            "before fitting). C (=1/alpha) was selected via 5-fold "
            "stratified cross-validation maximizing held-out log-likelihood, "
            "matching the standard penalized-logistic-regression workflow."
        ),
    }


async def run_lasso_cross_sectional_prediction(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        remove_outliers  = payload.get("outliers", False)
        threshold        = float(payload.get("threshold", 0.5))

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
            raise ValueError("Dataset too small for LASSO")

        # ── Auto-detect binary vs continuous ──
        is_binary = set(y.unique()).issubset({0, 1})

        # Guard: cross-validation needs enough rows per fold to be
        # meaningful, and StratifiedKFold needs each class to have at
        # least CV_FOLDS members in the training set.
        min_rows_for_cv = CV_FOLDS * 5
        if len(X) < min_rows_for_cv:
            raise ValueError(
                f"Dataset too small for {CV_FOLDS}-fold cross-validated LASSO "
                f"({len(X)} rows). Need at least {min_rows_for_cv} rows, or "
                f"reduce CV_FOLDS."
            )
        if is_binary:
            class_counts = y.value_counts()
            if class_counts.min() < CV_FOLDS:
                raise ValueError(
                    f"Minority class has only {int(class_counts.min())} "
                    f"observation(s), which is fewer than {CV_FOLDS} CV folds. "
                    f"Reduce CV_FOLDS or provide more data for the minority class."
                )

        # ── Train / test split ──
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_STATE,
            stratify=y if is_binary else None,
        )

        # ── Branch on target type ──
        if is_binary:
            metrics = _run_binary(X_train, X_test, y_train, y_test, threshold)
        else:
            metrics = _run_continuous(X_train, X_test, y_train, y_test)

        return JSONResponse(content={
            "success":   True,
            "rows_used": len(X),
            **metrics,
        })

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Model execution failed",
                "details": str(e),
            },
            status_code=500,
        )
