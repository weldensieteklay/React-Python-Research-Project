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
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from services.acs_service import get_acs_dataframe

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
