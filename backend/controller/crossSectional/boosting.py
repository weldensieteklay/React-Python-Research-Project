from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
import pandas as pd

from controller.crossSectional.helpers import prepare_dataset


async def run_gradient_boosting_cross_sectional_prediction(request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col = payload.get("id_column")
        remove_outliers = payload.get("outliers", False)

        prepared = prepare_dataset(
            raw_data,
            dependent_col,
            independent_cols,
            categorical_cols,
            id_col,
            remove_outliers,
        )

        X = prepared["X"].copy()
        y = prepared["y"].copy()

        X = X.apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(y, errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        model = GradientBoostingRegressor(
            n_estimators=200,
            learning_rate=0.1,
            random_state=42
        )

        model.fit(X_train, y_train)

        predictions = model.predict(X_test)

        r2 = r2_score(y_test, predictions)
        mse = mean_squared_error(y_test, predictions)
        mae = mean_absolute_error(y_test, predictions)

        feature_importance = {
            str(k): round(float(v), 6)
            for k, v in zip(X_train.columns, model.feature_importances_)
        }

        return JSONResponse(
            content={
                "success": True,
                "model": "GRADIENT_BOOSTING",
                "rows_used": len(X),
                "r2_score": round(float(r2), 4),
                "mse": round(float(mse), 4),
                "mae": round(float(mae), 4),
                "feature_importance": feature_importance,
            }
        )

    except Exception as e:
        return JSONResponse(
            content={"success": False, "error": str(e)},
            status_code=500,
        )