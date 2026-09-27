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
# -----------------------------------------------------------------------
# ACS (Census Bureau) configuration
# -----------------------------------------------------------------------
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY")
CENSUS_BASE_URL = "https://api.census.gov/data"

RECENT_YEAR = 2022
EARLY_YEAR = 2015

VARS_RECENT = {
    "B19013_001E": "median_household_income",
    "B01003_001E": "population",
    "B25064_001E": "median_gross_rent",
    "B25003_001E": "occupied_housing_units_total",
    "B25003_002E": "owner_occupied_units",
    "B25003_003E": "renter_occupied_units",
}

VARS_BUILT_DECADE = {
    "B25034_002E": "built_2020_or_later",
    "B25034_003E": "built_2010_2019",
    "B25034_004E": "built_2000_2009",
    "B25034_005E": "built_1990_1999",
    "B25034_006E": "built_1980_1989",
    "B25034_007E": "built_1970_1979",
    "B25034_008E": "built_1960_1969",
    "B25034_009E": "built_1950_1959",
    "B25034_010E": "built_1940_1949",
    "B25034_011E": "built_1939_or_earlier",
}

VARS_EARLY = {"B01003_001E": "population_early"}

# -----------------------------------------------------------------------
# FRED configuration
# -----------------------------------------------------------------------
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

FRED_SERIES = {
    "DALL148URN": "unemployment_rate_pct",
    "DALL148NA": "total_nonfarm_employment_thousands",
    # Add a confirmed DFW building-permits series ID here once verified
    # on fred.stlouisfed.org, e.g.:
    # "SERIES_ID": "housing_permits",
}


# -----------------------------------------------------------------------
# ACS fetch logic
# -----------------------------------------------------------------------
async def _fetch_acs(client: httpx.AsyncClient, year: int, variables: dict, zips: list[str]) -> pd.DataFrame:
    var_codes = ",".join(variables.keys())
    url = f"{CENSUS_BASE_URL}/{year}/acs/acs5"
    params = {
        "get": f"NAME,{var_codes}",
        "for": "zip code tabulation area:*",
        "key": CENSUS_API_KEY,
    }
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    df = pd.DataFrame(data[1:], columns=data[0])
    df = df.rename(columns={"zip code tabulation area": "zip_code", **variables})
    df["zip_code"] = df["zip_code"].astype(str).str.zfill(5)
    df = df[df["zip_code"].isin(zips)].copy()

    for col in variables.values():
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df[["zip_code"] + list(variables.values())]


async def get_acs_dataframe(zips: list[str]) -> pd.DataFrame:
    """Fetch and merge all ACS variables for the given zip codes."""
    if not CENSUS_API_KEY:
        raise ValueError("CENSUS_API_KEY is not set in the backend environment.")

    async with httpx.AsyncClient() as client:
        recent_core = await _fetch_acs(client, RECENT_YEAR, VARS_RECENT, zips)
        recent_built = await _fetch_acs(client, RECENT_YEAR, VARS_BUILT_DECADE, zips)
        early_pop = await _fetch_acs(client, EARLY_YEAR, VARS_EARLY, zips)

    acs = recent_core.merge(recent_built, on="zip_code", how="left")
    acs = acs.merge(early_pop, on="zip_code", how="left")

    acs["population_change_pct"] = (
        (acs["population"] - acs["population_early"]) / acs["population_early"] * 100
    ).round(2)
    acs["renter_occupied_share_pct"] = (
        acs["renter_occupied_units"] / acs["occupied_housing_units_total"] * 100
    ).round(2)
    acs["owner_occupied_share_pct"] = (
        acs["owner_occupied_units"] / acs["occupied_housing_units_total"] * 100
    ).round(2)
    acs["share_built_since_2010_pct"] = (
        (acs["built_2020_or_later"] + acs["built_2010_2019"])
        / acs[list(VARS_BUILT_DECADE.values())].sum(axis=1)
        * 100
    ).round(2)

    return acs


# -----------------------------------------------------------------------
# FRED fetch logic
# -----------------------------------------------------------------------
async def _fetch_fred_series(client: httpx.AsyncClient, series_id: str, column_name: str) -> pd.DataFrame:
    resp = await client.get(FRED_CSV_URL, params={"id": series_id}, timeout=30)
    resp.raise_for_status()
    df = pd.read_csv(StringIO(resp.text))
    df.columns = ["date", column_name]
    df["date"] = pd.to_datetime(df["date"])
    df[column_name] = pd.to_numeric(df[column_name], errors="coerce")
    return df


async def get_fred_dataframe() -> pd.DataFrame:
    """Fetch and merge all configured FRED series into one monthly dataframe."""
    async with httpx.AsyncClient() as client:
        merged = None
        for series_id, col_name in FRED_SERIES.items():
            s = await _fetch_fred_series(client, series_id, col_name)
            merged = s if merged is None else merged.merge(s, on="date", how="outer")

    merged["year_month"] = merged["date"].dt.to_period("M")
    return merged.sort_values("date").reset_index(drop=True)


# -----------------------------------------------------------------------
# Combined ACS + FRED — ready to merge directly onto a zip x month panel
# -----------------------------------------------------------------------
async def get_combined_dataframe(zips: list[str]) -> pd.DataFrame:
    """
    Fetches ACS (zip-level) and FRED (month-level) data and cross-joins them
    into a single zip x month dataframe, ready to merge directly onto a rent
    panel on ["zip_code", "year_month"].
    """
    acs_df = await get_acs_dataframe(zips)
    fred_df = await get_fred_dataframe()

    acs_df = acs_df.copy()
    fred_df = fred_df.drop(columns=["date"]).copy()

    acs_df["_key"] = 1
    fred_df["_key"] = 1
    combined = fred_df.merge(acs_df, on="_key").drop(columns=["_key"])

    return combined

SAFMR_URL = "https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs_revised.xlsx"
AREA_NAME_KEYWORDS = ["Dallas", "Fort Worth"]

def download_safmr() -> pd.DataFrame:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    resp = requests.get(SAFMR_URL, headers=headers, timeout=120)
    resp.raise_for_status()
    if not resp.content.startswith(b"PK"):
        raise RuntimeError("HUD returned a non-xlsx response (likely an HTML error page).")
    return pd.read_excel(io.BytesIO(resp.content), engine="openpyxl")

def find_column(df, *candidates):
    cols_lower = {c.lower(): c for c in df.columns}
    for cand in candidates:
        for lower, original in cols_lower.items():
            if cand in lower:
                return original
    raise KeyError(f"None of {candidates} found in columns: {list(df.columns)}")

def process(df: pd.DataFrame) -> list[dict]:
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
                "zip_code": str(row[zip_col]).strip().zfill(5),
                "area_name": row[area_col],
                "bedrooms": bd,
                "safmr_rent": row[col],
            })
    return rows