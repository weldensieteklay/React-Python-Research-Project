from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.preprocessing import OneHotEncoder
import statsmodels.api as sm
import pandas as pd
import numpy as np
import math

from controller.crossSectional.helpers import prepare_dataset

# ─────────────────────────────────────────
# STANDALONE — must be outside run_ols_prediction
# ─────────────────────────────────────────

async def run_ols_prediction(request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col = payload.get("id_column")
        remove_outliers = payload.get("outliers", False)

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

        X = prepared["X"].copy()
        y = prepared["y"].copy()

        X = X.apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(y, errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        if len(X) < 5:
            raise ValueError("Dataset too small for OLS")

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        X_train = sm.add_constant(X_train, has_constant="add")
        X_test = sm.add_constant(X_test, has_constant="add")

        model = sm.OLS(y_train, X_train).fit()
        predictions = model.predict(X_test)
        p_values = {
            str(k): (None if pd.isna(v) or math.isnan(float(v)) else round(float(v), 6))
            for k, v in model.pvalues.items()
        }
        standard_errors = {
            str(k): (None if pd.isna(v) else round(float(v), 6))
            for k, v in model.bse.items()
        }
        r2 = r2_score(y_test, predictions)
        mse = mean_squared_error(y_test, predictions)
        mae = mean_absolute_error(y_test, predictions)

        return JSONResponse(
            content={
                "success": True,
                "model": "OLS",
                "rows_used": len(X),
                "r2_score": round(float(r2), 4),
                "mse": round(float(mse), 4),
                "mae": round(float(mae), 4),
                "coefficients": {
                    str(k): round(float(v), 6) for k, v in model.params.items()
                },
                "standard_errors": standard_errors,
                "p_values": p_values,
            }
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
