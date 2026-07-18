from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split, KFold
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
import statsmodels.api as sm
import pandas as pd
import numpy as np

from controller.crossSectional.helpers import prepare_dataset


def _estimate_fgls_weights(X, y, min_variance=1e-6):
    """
    Feasible GLS (FGLS) weight estimation for heteroskedasticity.

    Instead of treating each squared residual as its own variance
    estimate (unstable, essentially memorizes training noise), we:
      1. Fit OLS to get residuals.
      2. Model log(residual^2) as a function of X (a smooth variance
         function), which is the standard FGLS approach.
      3. Recover fitted variance = exp(prediction) and use 1/variance
         as WLS weights.
    """
    ols_model = sm.OLS(y, X).fit()
    resid_sq = np.maximum(ols_model.resid ** 2, min_variance)
    log_resid_sq = np.log(resid_sq)

    variance_model = sm.OLS(log_resid_sq, X).fit()
    fitted_log_var = variance_model.predict(X)
    variance = np.maximum(np.exp(fitted_log_var), min_variance)

    weights = 1.0 / variance
    return weights, ols_model


def _fit_gls(X_train, y_train):
    """
    Fit GLS via WLS using FGLS-estimated weights. WLS with weights=1/var
    is mathematically equivalent to GLS with a diagonal sigma matrix,
    but avoids building an NxN matrix.
    """
    weights, ols_model = _estimate_fgls_weights(X_train, y_train)
    gls_model = sm.WLS(y_train, X_train, weights=weights).fit()
    return gls_model, ols_model


def _clean_series(series):
    """Convert a statsmodels Series of params/bse/pvalues into a
    JSON-safe dict, rounding and mapping NaN -> None."""
    out = {}
    for k, v in series.items():
        fv = float(v)
        out[str(k)] = None if (pd.isna(fv) or np.isnan(fv)) else round(fv, 6)
    return out


async def run_gls_prediction(request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col = payload.get("id_column")
        remove_outliers = payload.get("outliers", False)
        cv_folds = int(payload.get("cv_folds", 5))
        test_size = float(payload.get("test_size", 0.2))
        random_state = int(payload.get("random_state", 42))

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if cv_folds < 2:
            raise ValueError("cv_folds must be at least 2")
        if not (0 < test_size < 1):
            raise ValueError("test_size must be between 0 and 1")

        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X = prepared["X"].copy()
        y = prepared["y"].copy()

        X = X.apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(y, errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X = X[valid_rows].reset_index(drop=True)
        y = y[valid_rows].reset_index(drop=True)

        n_features = X.shape[1]
        min_required = max(5, cv_folds, n_features + 2)
        if len(X) < min_required:
            raise ValueError(
                f"Dataset too small: need at least {min_required} valid rows "
                f"for {n_features} predictor(s) and {cv_folds}-fold CV, got {len(X)}"
            )

        # ------------------------------------------------------------
        # K-fold cross-validation across the full cleaned dataset, to
        # get a stable estimate of generalisation error (not dependent
        # on a single train/test split).
        # ------------------------------------------------------------
        kf = KFold(n_splits=cv_folds, shuffle=True, random_state=random_state)
        cv_r2, cv_mse, cv_mae = [], [], []
        failed_folds = 0

        for train_idx, val_idx in kf.split(X):
            X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

            X_tr_c = sm.add_constant(X_tr, has_constant="add")
            X_val_c = sm.add_constant(X_val, has_constant="add")
            X_val_c = X_val_c.reindex(columns=X_tr_c.columns, fill_value=0)

            try:
                fold_model, _ = _fit_gls(X_tr_c, y_tr)
                fold_preds = fold_model.predict(X_val_c)
            except Exception:
                failed_folds += 1
                continue

            cv_r2.append(r2_score(y_val, fold_preds))
            cv_mse.append(mean_squared_error(y_val, fold_preds))
            cv_mae.append(mean_absolute_error(y_val, fold_preds))

        if not cv_r2:
            raise ValueError("Cross-validation failed for all folds")

        cross_validation = {
            "folds_requested": cv_folds,
            "folds_used": cv_folds - failed_folds,
            "r2_mean": round(float(np.mean(cv_r2)), 4),
            "r2_std": round(float(np.std(cv_r2)), 4),
            "mse_mean": round(float(np.mean(cv_mse)), 4),
            "mse_std": round(float(np.std(cv_mse)), 4),
            "mae_mean": round(float(np.mean(cv_mae)), 4),
            "mae_std": round(float(np.std(cv_mae)), 4),
        }

        # ------------------------------------------------------------
        # Final hold-out train/test split for a reportable model
        # (coefficients, SEs, p-values) plus a single hold-out metric set.
        # ------------------------------------------------------------
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state
        )

        X_train = sm.add_constant(X_train, has_constant="add")
        X_test = sm.add_constant(X_test, has_constant="add")
        X_test = X_test.reindex(columns=X_train.columns, fill_value=0)

        model, _ols_model = _fit_gls(X_train, y_train)
        predictions = model.predict(X_test)

        r2 = r2_score(y_test, predictions)
        mse = mean_squared_error(y_test, predictions)
        mae = mean_absolute_error(y_test, predictions)

        coefficients = _clean_series(model.params)
        standard_errors = _clean_series(model.bse)
        p_values = _clean_series(model.pvalues)

        return JSONResponse(
            content={
                "success": True,
                "model": "GLS (FGLS via WLS, heteroskedasticity-adjusted)",
                "rows_used": int(len(X)),
                "rows_train": int(len(X_train)),
                "rows_test": int(len(X_test)),
                "holdout_metrics": {
                    "r2_score": round(float(r2), 4),
                    "mse": round(float(mse), 4),
                    "mae": round(float(mae), 4),
                },
                "cross_validation": cross_validation,
                "coefficients": coefficients,
                "standard_errors": standard_errors,
                "p_values": p_values,
            }
        )

    except ValueError as e:
        return JSONResponse(
            content={
                "success": False,
                "error": "Invalid input",
                "details": str(e),
            },
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error": "Model execution failed",
                "details": str(e),
            },
            status_code=500,
        )