"""
routes/data_routes.py

One endpoint: reads the DFW rent panel bundled with the backend, pulls
matching ACS features live using the backend-configured Census API key,
merges them, and returns the merged CSV as the response body.

Add to your main router (e.g. in routes/routes.py):

    from routes.data_routes import router as data_router
    router.include_router(data_router, prefix="/data")

Sits behind your existing verify_google_token middleware automatically,
since it is not listed in PUBLIC_PATHS.
"""

import os
import io
import pandas as pd
from io import BytesIO
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from functools import lru_cache
from pathlib import Path

from services.acs_service import build_macro_by_fiscal_year, build_ten_year_dfw_dataset, fit_predict
from services.macro_indicators_service import fetch_all_indicators
from services.cycle_score_transform import compute_cycle_score

router = APIRouter()

# Path to the rent panel file bundled with the backend deployment.
# Place dfw_rent_panel.csv in a `data/` folder at the project root.
PANEL_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "dfw_rent_panel.csv")


@router.get("/rent-panel-with-acs")
async def get_rent_panel_with_acs():
    """
    Reads the bundled DFW rent panel, fetches ACS demographic/housing
    features for every zip code in it, merges them together, and returns
    the merged dataset as a downloadable CSV.
    """
    if not os.path.exists(PANEL_PATH):
        raise HTTPException(status_code=500, detail="Rent panel file not found on backend.")

    panel = pd.read_csv(PANEL_PATH, dtype={"zip_code": str})
    panel["zip_code"] = panel["zip_code"].str.zfill(5)
    zip_list = panel["zip_code"].unique().tolist()

    try:
        acs_df = await get_acs_dataframe(zip_list)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch ACS data: {e}")

    merged = panel.merge(acs_df, on="zip_code", how="left")

    buf = BytesIO()
    merged.to_csv(buf, index=False)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="dfw_rent_panel_with_acs.csv"'},
    )

"""
DFW Rental Dashboard API — ZIP-code level.
File: backend/routes/acs_service.py
Data:  backend/services/dfw_safmr_full.csv

Drop into your existing FastAPI app:
    from routes.acs_service import router as dfw_router
    app.include_router(dfw_router, prefix="/api/dfw-rentals")

Data file expected columns: zip_code, area, bedrooms, safmr_rent
"""

BASE_DIR = Path(__file__).resolve().parent.parent  # -> backend/
DATA_PATH = BASE_DIR / "services" / "dfw_safmr_full.csv"

BEDROOM_LABELS = {0: "Studio", 1: "1 BR", 2: "2 BR", 3: "3 BR", 4: "4 BR"}

# simple in-memory cache since HUD updates this file ~yearly
_cache = None
_forecast_cache = None  # separate variable, same route
@router.get("/dfw-safmr")
def get_dfw_safmr_history():
    global _cache, _forecast_cache

    if _cache is None:
        rows, failures = build_ten_year_dfw_dataset()
        if not rows:
            raise HTTPException(status_code=502, detail=f"All years failed: {failures}")
        _cache = {"rows": rows, "failures": failures}

    if _forecast_cache is None:
        panel = pd.DataFrame(_cache["rows"])
        forecast_df = fit_predict(panel, horizon_years=2)  # -> 2027, 2028

        actuals_df = panel.copy()
        actuals_df["is_forecast"] = False
        forecast_df["is_forecast"] = True

        combined = pd.concat([actuals_df, forecast_df], ignore_index=True, sort=False)
        combined = combined.sort_values(["zip_code", "bedrooms", "fiscal_year"]).reset_index(drop=True)

        _forecast_cache = {
            "rows": combined.where(combined.notna(), None).to_dict("records"),
            "skipped_zips": forecast_df.attrs.get("skipped_zips", []),
            "model": "gradient_boosting",
        }

    return {
        "rows": _forecast_cache["rows"],              # actuals + 2027/2028 forecast, combined
        "failures": _cache["failures"],
        "skipped_zips": _forecast_cache["skipped_zips"],
        "model": _forecast_cache["model"],
    }


_macro_cache = None
def get_macro():
    global _macro_cache
    if _macro_cache is None:
        _macro_cache = build_macro_by_fiscal_year()
    return _macro_cache

@router.get("/dfw-macro")
def dfw_macro():
    df, failures = get_macro()
    return {"rows": df.where(df.notna(), None).to_dict("records"), "failures": failures}

real_estate_cache = None
@router.get("/macro-indicators")
async def get_macro_indicators():
    global real_estate_cache
    if real_estate_cache is None:
        indicators = await fetch_all_indicators()
        indicators["cycle_score"] = compute_cycle_score(indicators["automated"])
        real_estate_cache = indicators
    return real_estate_cache

@router.post("/macro-indicators/refresh")
async def refresh_macro_indicators():
    global real_estate_cache
    real_estate_cache = await fetch_all_indicators()
    return real_estate_cache