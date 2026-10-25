"""
services/acs_service.py

Data builders used by the DFW routes:
  - DFW metro macroeconomic series from FRED, averaged by HUD fiscal year
  - Zillow Observed Rent Index (ZORI) ZIP-level monthly history for DFW
  - ZIP-level covariates for the rent-divergence model:
      * distance to downtown Dallas / Fort Worth and land area (Census Gazetteer)
      * pre-boom income, renter share, population (ACS 5-year, baseline vintage)
      * new supply: renter-stock growth and share of units built 2020+ (ACS, recent vintage)

API keys are read from the backend environment only (FRED_API_KEY required,
CENSUS_API_KEY optional), never passed by the client.
"""

import io
import os
import re

import numpy as np
import pandas as pd
import requests


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


# ---------------------------------------------------------------------------
# FRED macro series (fiscal-year, used by /dfw-macro)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Zillow ZORI
# ---------------------------------------------------------------------------

# Zillow Observed Rent Index (ZORI) - smoothed (NOT seasonally adjusted), ZIP-level
ZILLOW_ZORI_ZIP_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"

DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def build_historical_dfw_zori_dataset() -> tuple[list[dict], dict]:
    """
    Downloads Zillow's wide monthly matrix, slices out the DFW metro,
    and melts it into normalized long-form rows.
    """
    all_rows = []
    failures = {}
    try:
        resp = requests.get(ZILLOW_ZORI_ZIP_URL, headers=HEADERS, timeout=120)
        resp.raise_for_status()

        # Verify the response is plain-text CSV, not a zipped archive
        if resp.content.startswith(b"PK"):
            raise RuntimeError("Unexpected compressed binary payload received from Zillow.")

        df = pd.read_csv(io.BytesIO(resp.content))
        all_rows = process_zillow_dfw_matrix(df)

    except Exception as e:
        failures["zori_pipeline"] = str(e)

    return all_rows, failures


def process_zillow_dfw_matrix(df: pd.DataFrame) -> list[dict]:
    missing = {"RegionName", "Metro"} - set(df.columns)
    if missing:
        raise ValueError(f"Zillow file is missing columns {sorted(missing)}; "
                         f"first columns found: {list(df.columns[:10])}")

    df = df.rename(columns={"RegionName": "zip_code", "Metro": "msa_name",
                            "StateName": "state", "CountyName": "county"})
    df_dfw = df[df["msa_name"].str.contains("Dallas-Fort Worth", case=False, na=False)].copy()

    id_cols = [c for c in ["RegionID", "SizeRank", "zip_code", "RegionType",
                           "state", "City", "county", "msa_name"] if c in df_dfw.columns]
    date_cols = [c for c in df_dfw.columns if DATE_COL.match(str(c))]   # real dates only
    if not date_cols:
        raise ValueError("No date columns found in the Zillow file")

    long = df_dfw.melt(id_vars=id_cols, value_vars=date_cols,
                       var_name="raw_date", value_name="zori_rent").dropna(subset=["zori_rent"])
    long["datetime"] = pd.to_datetime(long["raw_date"])
    long["month_year"] = long["datetime"].dt.strftime("%Y-%m")
    long["year"] = long["datetime"].dt.year
    long["fiscal_year"] = long["year"] + (long["datetime"].dt.month >= 10).astype(int)
    long["zip_code"] = long["zip_code"].astype(str).str.zfill(5)
    return long.to_dict(orient="records")


# ---------------------------------------------------------------------------
# ZIP-level covariates for the rent-divergence model
# ---------------------------------------------------------------------------
# Notes on geography: Zillow reports USPS ZIP codes; Census reports ZCTAs (ZIP Code
# Tabulation Areas). For residential DFW ZIPs these almost always share the same
# 5-digit code, so the join is on the code. ZIPs with no matching ZCTA (PO-box or
# single-building ZIPs) come back with NaN covariates and are reported, not dropped
# silently.

CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "")

# Downtown reference points (city hall areas)
DOWNTOWN_POINTS = {
    "Dallas":     (32.7767, -96.7970),
    "Fort Worth": (32.7555, -97.3308),
}

GAZETTEER_URL = os.environ.get(
    "ZCTA_GAZETTEER_URL",
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip",
)

# Baseline = pre-boom (2015-2019 survey window), so covariates are not themselves
# outcomes of the 2021-22 boom. Recent = the window that covers the 2023-24 supply wave.
ACS_BASELINE_YEAR = int(os.environ.get("ACS_BASELINE_YEAR", "2019"))
ACS_RECENT_YEAR = int(os.environ.get("ACS_RECENT_YEAR", "2024"))

ACS_BASELINE_VARS = {
    "B01003_001E": "population",
    "B19013_001E": "median_household_income",
    "B25003_001E": "occupied_units",
    "B25003_003E": "renter_units",
    "B25064_001E": "median_gross_rent_acs",
}
ACS_RECENT_VARS = {
    "B25003_003E": "renter_units",
    "B25034_001E": "total_units_by_year_built",
    "B25034_002E": "units_built_2020_or_later",
}
ZCTA_GEO = "zip code tabulation area"


def _haversine_miles(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = (np.sin((lat2 - lat1) / 2) ** 2
         + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2)
    return 3958.8 * 2 * np.arcsin(np.sqrt(a))


def fetch_zcta_gazetteer() -> pd.DataFrame:
    """One row per ZCTA: land area and internal point (lat/lon)."""
    resp = requests.get(GAZETTEER_URL, headers=HEADERS, timeout=120)
    resp.raise_for_status()
    df = pd.read_csv(io.BytesIO(resp.content), sep="\t", dtype={"GEOID": str},
                     compression="zip")
    df.columns = [c.strip() for c in df.columns]   # last header carries trailing spaces
    needed = {"GEOID", "ALAND_SQMI", "INTPTLAT", "INTPTLONG"}
    if needed - set(df.columns):
        raise ValueError(f"Gazetteer file missing {sorted(needed - set(df.columns))}; "
                         f"columns found: {list(df.columns)}")
    df["zip_code"] = df["GEOID"].str.zfill(5)
    return df[["zip_code", "ALAND_SQMI", "INTPTLAT", "INTPTLONG"]].rename(columns={
        "ALAND_SQMI": "land_area_sqmi", "INTPTLAT": "lat", "INTPTLONG": "lon",
    })


def _check_acs_label(year: int, variable: str, must_contain: str) -> None:
    """Census occasionally renumbers year-built bins between vintages. Confirm the
    variable still means what we think before using it."""
    url = f"https://api.census.gov/data/{year}/acs/acs5/variables/{variable}.json"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    label = resp.json().get("label", "")
    if must_contain.lower() not in label.lower():
        raise ValueError(f"ACS {year} {variable} is '{label}', expected it to mention "
                         f"'{must_contain}'. Update ACS_RECENT_VARS for this vintage.")


def fetch_acs_zcta(year: int, variables: dict) -> pd.DataFrame:
    """All ZCTAs nationally in one request, filtered locally afterwards. Asking for a
    list of specific ZCTAs fails if any one of them doesn't exist in that vintage."""
    params = {"get": ",".join(variables), "for": f"{ZCTA_GEO}:*"}
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY
    resp = requests.get(f"https://api.census.gov/data/{year}/acs/acs5", params=params, timeout=180)
    resp.raise_for_status()
    data = resp.json()
    df = pd.DataFrame(data[1:], columns=data[0])
    df["zip_code"] = df[ZCTA_GEO].astype(str).str.zfill(5)
    for var in variables:
        df[var] = pd.to_numeric(df[var], errors="coerce")
        df.loc[df[var] < 0, var] = np.nan   # Census sentinels such as -666666666
    return df[["zip_code", *variables]].rename(columns=variables)


def build_zip_covariates(zip_codes: list[str]) -> tuple[pd.DataFrame, dict]:
    """
    Returns one row per requested ZIP with:
      dist_downtown_mi, nearest_downtown, land_area_sqmi            (Gazetteer)
      population, median_household_income, renter_share,
      pop_density_sqmi, median_gross_rent_acs                       (ACS baseline)
      renter_stock_growth, new_build_share                          (ACS recent vs baseline)
    Each source fails independently; failures are reported, columns left NaN.
    """
    zips = sorted({str(z).zfill(5) for z in zip_codes})
    out = pd.DataFrame({"zip_code": zips})
    failures = {}

    # 1. Location
    try:
        gaz = fetch_zcta_gazetteer()
        out = out.merge(gaz, on="zip_code", how="left")
        dists = {
            name: _haversine_miles(out["lat"], out["lon"], lat, lon)
            for name, (lat, lon) in DOWNTOWN_POINTS.items()
        }
        dist_df = pd.DataFrame(dists)
        out["dist_downtown_mi"] = dist_df.min(axis=1)
        out["nearest_downtown"] = dist_df.idxmin(axis=1).where(dist_df.notna().any(axis=1))
    except Exception as e:
        failures["gazetteer"] = str(e)

    # 2. Pre-boom demographics
    try:
        base = fetch_acs_zcta(ACS_BASELINE_YEAR, ACS_BASELINE_VARS)
        out = out.merge(base, on="zip_code", how="left")
        out["renter_share"] = out["renter_units"] / out["occupied_units"]
        if "land_area_sqmi" in out:
            out["pop_density_sqmi"] = out["population"] / out["land_area_sqmi"]
    except Exception as e:
        failures[f"acs_{ACS_BASELINE_YEAR}"] = str(e)

    # 3. New supply
    try:
        _check_acs_label(ACS_RECENT_YEAR, "B25034_002E", "2020")
        recent = fetch_acs_zcta(ACS_RECENT_YEAR, ACS_RECENT_VARS).rename(
            columns={"renter_units": "renter_units_recent"})
        out = out.merge(recent, on="zip_code", how="left")
        out["new_build_share"] = out["units_built_2020_or_later"] / out["total_units_by_year_built"]
        if "renter_units" in out:
            out["renter_stock_growth"] = out["renter_units_recent"] / out["renter_units"] - 1
    except Exception as e:
        failures[f"acs_{ACS_RECENT_YEAR}"] = str(e)

    out = out.replace([np.inf, -np.inf], np.nan)
    # Only meaningful when the sources themselves loaded; otherwise every ZIP looks unmatched
    unmatched = []
    if "lat" in out:
        unmatched = out.loc[out["lat"].isna(), "zip_code"].tolist()
    if unmatched:
        failures["zips_without_census_match"] = unmatched
    out.attrs["acs_baseline_year"] = ACS_BASELINE_YEAR
    out.attrs["acs_recent_year"] = ACS_RECENT_YEAR
    return out, failures
