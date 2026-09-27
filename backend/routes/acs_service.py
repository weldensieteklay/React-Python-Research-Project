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
import pandas as pd
from io import BytesIO
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from functools import lru_cache
import io
from pathlib import Path

from services.acs_service import get_acs_dataframe, download_safmr, process

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


@lru_cache(maxsize=1)
def load_data() -> pd.DataFrame:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Rental data file not found at {DATA_PATH}. "
            "Run process_dfw_safmr.py from backend/services/ to generate it, "
            "or check that BASE_DIR resolves to the correct backend/ folder."
        )
    df = pd.read_csv(DATA_PATH, dtype={"zip_code": str})
    df["bedroom_label"] = df["bedrooms"].map(BEDROOM_LABELS)
    return df


@router.get("/meta")
async def get_metadata():
    """Filter options for the frontend dropdowns."""
    df = load_data()
    return {
        "zip_codes": sorted(df["zip_code"].unique().tolist()),
        "areas": sorted(df["area_name"].unique().tolist()),
        "bedroom_options": sorted(df["bedrooms"].unique().tolist()),
    }


@router.get("/by-zip")
async def rent_by_zip(bedrooms: Optional[int] = None):
    """Rent for every ZIP, optionally filtered to one bedroom count —
    powers the main 'rent across ZIP codes' bar chart."""
    df = load_data()
    if bedrooms is not None:
        df = df[df["bedrooms"] == bedrooms]
    return (
        df[["zip_code", "area_name", "bedrooms", "bedroom_label", "safmr_rent"]]
        .sort_values("safmr_rent", ascending=False)
        .to_dict(orient="records")
    )


@router.get("/zip/{zip_code}")
async def rent_for_single_zip(zip_code: str):
    """Full bedroom breakdown (studio through 4BR) for one specific ZIP —
    powers a detail view when a user clicks/selects a ZIP."""
    df = load_data()
    result = df[df["zip_code"] == zip_code].sort_values("bedrooms")
    if result.empty:
        return {"error": f"No data for ZIP {zip_code}"}
    return result[["bedrooms", "bedroom_label", "safmr_rent"]].to_dict(orient="records")


@router.get("/compare")
async def compare_zips(zips: str = Query(..., description="Comma-separated ZIP codes, e.g. 75023,75218")):
    """Side-by-side comparison across multiple ZIPs — powers a
    grouped bar chart when the user picks a few ZIPs to compare."""
    zip_list = [z.strip() for z in zips.split(",")]
    df = load_data()
    result = df[df["zip_code"].isin(zip_list)]
    return result[["zip_code", "area_name", "bedrooms", "bedroom_label", "safmr_rent"]].to_dict(orient="records")


@router.get("/download")
async def download_csv():
    """Streams the full dataset as CSV for a 'download data' button."""
    df = load_data()
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    stream.seek(0)
    return StreamingResponse(
        iter([stream.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dfw_rental_by_zip.csv"},
    )

# simple in-memory cache since HUD updates this file ~yearly
_cache = None
@router.get("/dfw-safmr")
def get_dfw_safmr():
    global _cache
    if _cache is None:
        try:
            raw = download_safmr()
            _cache = process(raw)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))
    return _cache