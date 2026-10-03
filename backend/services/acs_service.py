"""
services/acs_service.py

Combined async service for pulling:
  - ACS 5-Year zip-code-level demographic/housing variables (Census Bureau)
  - DFW metro-level macroeconomic series (FRED)

The Census API key is read from the backend environment only — never
passed by the client. No key is required for the FRED CSV endpoint.
"""

import os
import httpx
import pandas as pd
from io import StringIO
import requests
import io
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

MACRO_SERIES = {
    "hpi_dallas_msad":     "ATNHPIUS19124Q",
    "hpi_fortworth_msad":  "ATNHPIUS23104Q",
    "case_shiller_dallas": "DAXRSA",
    "cpi_rent_dfw":        "CUURA316SEHA",
    "cpi_all_dfw":         "CUURA316SA0",
    "active_listings_dfw": "ACTLISCOU19100",
    "mortgage_rate_30y":   "MORTGAGE30US",
    "fed_funds_rate":      "FEDFUNDS",
    "unemployment_us":     "UNRATE",
}

def fetch_fred(series_id: str) -> pd.Series:
    resp = requests.get(
        FRED_URL,
        params={
            "series_id": series_id,
            "api_key": os.environ["FRED_API_KEY"],
            "file_type": "json",
        },
        timeout=60,
    )
    resp.raise_for_status()
    obs = resp.json()["observations"]
    s = pd.Series(
        {pd.Timestamp(o["date"]): pd.to_numeric(o["value"], errors="coerce") for o in obs}
    )
    return s.dropna()

def to_fiscal_year(s: pd.Series) -> pd.Series:
    """HUD FY runs Oct-Sep: FY2026 = Oct 2025 through Sep 2026."""
    fy = s.index.year + (s.index.month >= 10).astype(int)
    return s.groupby(fy).mean()

def build_macro_by_fiscal_year() -> tuple[pd.DataFrame, dict]:
    cols, failures = {}, {}
    for name, sid in MACRO_SERIES.items():
        try:
            cols[name] = to_fiscal_year(fetch_fred(sid))
        except Exception as e:
            failures[name] = str(e)
    df = pd.DataFrame(cols).sort_index()
    df.index.name = "fiscal_year"

    # YoY % change for the level-type series (better predictors than raw indices)
    for c in ["hpi_dallas_msad", "hpi_fortworth_msad", "case_shiller_dallas",
              "cpi_rent_dfw", "cpi_all_dfw"]:
        if c in df:
            df[f"{c}_yoy"] = df[c].pct_change() * 100
    return df.reset_index(), failures

AREA_NAME_KEYWORDS = ["Dallas", "Fort Worth"]
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

# Confirm/replace these with the exact hrefs from
# https://huduser.gov/portal/node/6629 for each fiscal year you need.
YEAR_URLS = {
    2026: "https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs_revised.xlsx",
    2025: "https://www.huduser.gov/portal/datasets/fmr/fmr2025/fy2025_safmrs.xlsx",
    2024: "https://www.huduser.gov/portal/datasets/fmr/fmr2024/fy2024_safmrs.xlsx",
    2023: "https://www.huduser.gov/portal/datasets/fmr/fmr2023/fy2023_safmrs.xlsx",
    2022: "https://www.huduser.gov/portal/datasets/fmr/fmr2022/fy2022_safmrs.xlsx",
    2021: "https://www.huduser.gov/portal/datasets/fmr/fmr2021/fy2021_safmrs.xlsx",
    2020: "https://www.huduser.gov/portal/datasets/fmr/fmr2020/fy2020_safmrs.xlsx",
    2019: "https://www.huduser.gov/portal/datasets/fmr/fmr2019/fy2019_safmrs.xlsx",
    2018: "https://www.huduser.gov/portal/datasets/fmr/fmr2018/fy2018_safmrs.xlsx",
    2017: "https://www.huduser.gov/portal/datasets/fmr/fmr2017/fy2017_safmrs_revised.xlsx",
}

def download_year(url: str) -> pd.DataFrame:
    resp = requests.get(url, headers=HEADERS, timeout=120)
    resp.raise_for_status()
    if not resp.content.startswith(b"PK"):
        raise RuntimeError(f"Non-xlsx response from {url}")
    return pd.read_excel(io.BytesIO(resp.content), engine="openpyxl")

def find_column(df, *candidates):
    cols_lower = {c.lower(): c for c in df.columns}
    for cand in candidates:
        for lower, original in cols_lower.items():
            if cand in lower:
                return original
    raise KeyError(f"None of {candidates} found in columns: {list(df.columns)}")

def process_year(df: pd.DataFrame, year: int) -> list[dict]:
    zip_col = find_column(df, "zip")
    area_col = find_column(df, "area name", "hud fair market rent area")

    bedroom_cols = {}
    for n in range(5):
        for col in df.columns:
            low = col.lower().replace("\n", " ")
            if "safmr" in low and f"{n}br" in low and "standard" not in low and "%" not in low:
                bedroom_cols[n] = col
                break

    pattern = "|".join(AREA_NAME_KEYWORDS)
    is_dfw_name = df[area_col].astype(str).str.contains(pattern, case=False, na=False)
    is_texas = df[area_col].astype(str).str.contains(r"\bTX\b", case=False, na=False)
    dfw = df[is_dfw_name & is_texas].copy()

    rows = []
    for _, row in dfw.iterrows():
        for bd, col in bedroom_cols.items():
            rows.append({
                "fiscal_year": year,
                "zip_code": str(row[zip_col]).strip().zfill(5),
                "area_name": row[area_col],
                "bedrooms": bd,
                "safmr_rent": row[col],
            })
    return rows

def build_ten_year_dfw_dataset() -> tuple[list[dict], dict]:
    all_rows = []
    failures = {}
    for year, url in YEAR_URLS.items():
        try:
            df = download_year(url)
            all_rows.extend(process_year(df, year))
        except Exception as e:
            failures[year] = str(e)
    return all_rows, failures


"""
services/panel_models/gradient_boosting.py

Gradient boosting forecast for the DFW SAFMR panel, matching the
fit_predict(panel, horizon_years) interface used by linear_trend.py
and random_forest.py so it plugs into the same MODEL_REGISTRY.

Design, per the specified config:
    independent_variable: ["bedroom"]
    date_column:          "fiscal_year"
    dependent_variable:   "safmr_rent"
    outliers:             "no"  (no clipping/winsorization applied)

Each ZIP code is fit as its OWN pooled model across its 5 bedroom
sizes (bedroom is the one exogenous feature), rather than one tiny
model per (zip, bedroom) pair. With ~10 fiscal years x 5 bedrooms,
that's ~50 training rows per ZIP instead of ~10 — still thin for
boosting, but meaningfully better than fitting GradientBoostingRegressor
on 10 points.

Forecasting 2+ years ahead is done RECURSIVELY: since the model's own
features are lags of the target, predicting FY2028 requires first
predicting FY2027 and feeding that prediction back in as lag_1 before
predicting FY2028. This step doesn't exist in a single-series fit/eval
endpoint and is the main addition here.
"""

MODEL_NAME = "gradient_boosting"

NUM_LAGS = 3
MIN_YEARS_REQUIRED = NUM_LAGS + 2  # need lags + at least 2 points to fit/validate on


def _create_lag_features(df: pd.DataFrame, target_col: str, group_col: str, num_lags: int) -> pd.DataFrame:
    """Lags computed WITHIN each bedroom group (so FY2020's 1BR lag_1 is
    FY2019's 1BR rent, never another bedroom size's value), then the
    groups are left pooled together as one training frame."""
    df = df.sort_values(["fiscal_year"]).copy()
    for lag in range(1, num_lags + 1):
        df[f"{target_col}_lag_{lag}"] = df.groupby(group_col)[target_col].shift(lag)
    return df


def _fit_boosting(X_train, y_train, n_estimators=300, learning_rate=0.05, max_depth=3, subsample=0.8):
    model = GradientBoostingRegressor(
        n_estimators=n_estimators,
        learning_rate=learning_rate,
        max_depth=max_depth,
        subsample=subsample,
        random_state=42,
    )
    model.fit(X_train, y_train)
    return model


def _evaluate_zip_model(df_zip: pd.DataFrame, lag_cols: list, cv_folds: int = 3) -> dict | None:
    """Walk-forward CV + holdout MSE for one ZIP's pooled model.
    Mirrors the TimeSeriesSplit approach in predict_price_boosting —
    no shuffled k-fold, since that would leak future rows (and lags
    built from them) into training."""
    feature_cols = ["bedrooms"] + lag_cols
    data = df_zip.dropna(subset=feature_cols + ["safmr_rent"]).reset_index(drop=True)

    if len(data) < max(8, cv_folds * 4):
        return None  # not enough pooled rows for this ZIP to CV reliably

    X, y = data[feature_cols], data["safmr_rent"]

    outer_cv = TimeSeriesSplit(n_splits=min(cv_folds, max(2, len(data) // 6)))
    fold_mses = []
    for train_idx, test_idx in outer_cv.split(X):
        try:
            fold_model = _fit_boosting(X.iloc[train_idx], y.iloc[train_idx])
            preds = fold_model.predict(X.iloc[test_idx])
            fold_mses.append(mean_squared_error(y.iloc[test_idx], preds))
        except Exception:
            continue

    if not fold_mses:
        return None

    return {"cv_mse_mean": float(np.mean(fold_mses)), "folds_used": len(fold_mses)}


def _recursive_forecast_zip(df_zip: pd.DataFrame, lag_cols: list, horizon_years: int) -> list[dict]:
    """Forecast each bedroom size forward `horizon_years`, feeding each
    predicted value back in as next year's lag_1 (true multi-step
    recursive forecasting, not just repeating the last trend)."""
    feature_cols = ["bedrooms"] + lag_cols
    train_data = df_zip.dropna(subset=feature_cols + ["safmr_rent"]).reset_index(drop=True)
    if train_data.empty:
        return []

    model = _fit_boosting(train_data[feature_cols], train_data["safmr_rent"])

    last_year = int(df_zip["fiscal_year"].max())
    area_name = df_zip["area_name"].iloc[-1]
    zip_code = df_zip["zip_code"].iloc[0]

    # running history of actual (then predicted) rents, per bedroom size
    history = {
        bd: df_zip[df_zip["bedrooms"] == bd].sort_values("fiscal_year")["safmr_rent"].tolist()
        for bd in df_zip["bedrooms"].unique()
    }

    forecasts = []
    for step in range(1, horizon_years + 1):
        year = last_year + step
        for bd, series in history.items():
            if len(series) < len(lag_cols):
                continue  # not enough history for this bedroom size to build lags
            row = {"bedrooms": bd}
            for i, lag_col in enumerate(lag_cols, start=1):
                row[lag_col] = series[-i]  # most recent values become lag_1, lag_2, ...
            X_pred = pd.DataFrame([row])[feature_cols]
            pred = float(model.predict(X_pred)[0])

            forecasts.append({
                "zip_code": zip_code,
                "bedrooms": int(bd),
                "area_name": area_name,
                "fiscal_year": year,
                "safmr_rent": round(pred, 2),
                "model_name": MODEL_NAME,
            })
            series.append(pred)  # feed prediction back in for the NEXT step's lag

    return forecasts


def fit_predict(panel: pd.DataFrame, horizon_years: int = 2) -> pd.DataFrame:
    """Entry point matching the shared panel-model interface. Fits one
    pooled gradient boosting model per ZIP (across its bedroom sizes)
    and recursively forecasts `horizon_years` beyond the latest
    fiscal year in the panel (e.g. 2026 -> 2027, 2028)."""
    df = panel.dropna(subset=["safmr_rent"]).copy()
    lag_cols = [f"safmr_rent_lag_{i}" for i in range(1, NUM_LAGS + 1)]

    all_forecasts = []
    skipped_zips = []

    for zip_code, df_zip in df.groupby("zip_code"):
        n_years = df_zip["fiscal_year"].nunique()
        if n_years < MIN_YEARS_REQUIRED:
            skipped_zips.append(zip_code)
            continue

        df_zip_lagged = _create_lag_features(df_zip, "safmr_rent", "bedrooms", NUM_LAGS)
        zip_forecasts = _recursive_forecast_zip(df_zip_lagged, lag_cols, horizon_years)
        all_forecasts.extend(zip_forecasts)

    result = pd.DataFrame(all_forecasts)
    if skipped_zips:
        result.attrs["skipped_zips"] = skipped_zips  # surfaced by the router, not lost silently
    return result


def evaluate(panel: pd.DataFrame, cv_folds: int = 3) -> dict:
    """Separate from fit_predict: returns per-ZIP and overall CV MSE,
    for comparing this model against linear_trend / random_forest by
    the same metric before picking a 'best' model."""
    df = panel.dropna(subset=["safmr_rent"]).copy()
    lag_cols = [f"safmr_rent_lag_{i}" for i in range(1, NUM_LAGS + 1)]

    per_zip_results = {}
    all_mses = []

    for zip_code, df_zip in df.groupby("zip_code"):
        df_zip_lagged = _create_lag_features(df_zip, "safmr_rent", "bedrooms", NUM_LAGS)
        result = _evaluate_zip_model(df_zip_lagged, lag_cols, cv_folds)
        if result:
            per_zip_results[zip_code] = result
            all_mses.append(result["cv_mse_mean"])

    return {
        "model": MODEL_NAME,
        "zips_evaluated": len(per_zip_results),
        "overall_mse_mean": float(np.mean(all_mses)) if all_mses else None,
        "per_zip": per_zip_results,
    }