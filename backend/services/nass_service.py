"""
services/nass_service.py

Async service for pulling USDA NASS QuickStats county-level cash rent
data, for use as a FastAPI endpoint in EconWebCast. Matches the same
pattern as acs_service.py's ACS integration.

The NASS API key is read from the backend environment only — never
passed by the client.
"""

import os
import httpx
import pandas as pd

NASS_API_KEY = os.getenv("NASS_API_KEY")
NASS_BASE_URL = "https://quickstats.nass.usda.gov/api/api_GET/"

DEFAULT_STATE_ALPHA = "KS"  # Kansas
DEFAULT_YEAR_START = 2015
DEFAULT_YEAR_END = 2026


async def get_cash_rent_dataframe(
    state_alpha: str = DEFAULT_STATE_ALPHA,
    year_start: int = DEFAULT_YEAR_START,
    year_end: int = DEFAULT_YEAR_END,
) -> pd.DataFrame:
    """
    Fetch county-level non-irrigated cropland cash rent ($/acre) directly
    from the NASS QuickStats API for the given state and year range.
    """
    if not NASS_API_KEY:
        raise ValueError("NASS_API_KEY is not set in the backend environment.")

    params = {
        "key": NASS_API_KEY,
        "source_desc": "SURVEY",
        "sector_desc": "ECONOMICS",
        "group_desc": "EXPENSES",
        "commodity_desc": "RENT",
        "short_desc": "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE",
        "agg_level_desc": "COUNTY",
        "state_alpha": state_alpha,
        "year__GE": year_start,
        "year__LE": year_end,
        "format": "JSON",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(NASS_BASE_URL, params=params, timeout=30)
        resp.raise_for_status()
        payload = resp.json()

    records = payload.get("data", [])
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)

    # Field names as returned by the raw QuickStats API (lowercase, snake_case)
    df = df[df["county_name"] != "OTHER (COMBINED) COUNTIES"].copy()
    df["Year"] = pd.to_numeric(df["year"], errors="coerce")
    df["cash_rent_per_acre"] = pd.to_numeric(
        df["Value"].astype(str).str.replace(",", ""), errors="coerce"
    )

    result = df[["state_name", "county_name", "Year", "cash_rent_per_acre"]].rename(
        columns={"state_name": "State", "county_name": "County"}
    )

    return result.sort_values(["County", "Year"]).reset_index(drop=True)
