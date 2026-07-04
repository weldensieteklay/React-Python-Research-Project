from fastapi import Request
from fastapi.responses import JSONResponse
import pandas as pd

from .preprocessing import clean_input_data
from .helpers import preprocess_exog, compute_metrics, to_serializable
from .model_utils import fit_arima_model
from .summary_utils import extract_model_summary

async def predict_price(request: Request):
    try:
        payload = await request.json()  # FastAPI way

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])

        if not raw_data or not date_col or not target_col:
            return JSONResponse({
                "error": "data, date_variable, and target_variable are required"
            }, status_code=400)

        # -------------------------
        # Load & clean
        # -------------------------
        df = clean_input_data(raw_data)

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")

        df.sort_values(by=date_col, inplace=True)
        df.set_index(date_col, inplace=True)

        # -------------------------
        # Exogenous handling (SAFE)
        # -------------------------
        exog_df = None
        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)

        # -------------------------
        # Train/test split
        # -------------------------
        split = int(len(df) * 0.8)

        train = df.iloc[:split]
        test = df.iloc[split:]

        exog_train = exog_df.iloc[:split] if exog_df is not None else None
        exog_test = exog_df.iloc[split:] if exog_df is not None else None

        # -------------------------
        # Fit ARIMAX
        # -------------------------
        results, stationarity = fit_arima_model(
            train[target_col],
            exog=exog_train
        )

        # -------------------------
        # Output
        # -------------------------
        metrics = compute_metrics(
            results,
            test,
            target_col,
            exog_test=exog_test
        )

        response = {
            **metrics,
            "model": "ARIMA",
            "stationary": stationarity["stationary"],
            "adfuller_p": round(stationarity["p_value"], 4),
            "data": extract_model_summary(results, target_col)
        }
        return JSONResponse(to_serializable(response))

    except Exception as e:
        return JSONResponse({
            "error": "Model execution failed",
            "details": repr(e)
        }, status_code=500)
