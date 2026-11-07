"""
services/acs_service.py

Data builders used by the DFW routes:
  - DFW metro macroeconomic series from FRED, averaged by HUD fiscal year
  - Zillow Observed Rent Index (ZORI) ZIP-level monthly history for any metro (DFW by default),
    the list of metros, and the metro for a viewer's location
  - ZIP-level covariates for the rent-divergence model:
      * distance to downtown Dallas / Fort Worth and land area (Census Gazetteer)
      * pre-boom income, renter share, population (ACS 5-year, baseline vintage)
      * new supply: renter-stock growth and share of units built 2020+ (ACS, recent vintage)

API keys are read from the backend environment only (FRED_API_KEY required,
CENSUS_API_KEY optional), never passed by the client.
"""

import functools
import io
import os
import re
import weakref

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

# Zillow's metro name for DFW; the default when the caller doesn't pick a metro
DFW_METRO = "Dallas-Fort Worth-Arlington, TX"


def fetch_zillow_zori_matrix() -> pd.DataFrame:
    """Zillow's wide monthly matrix for every ZIP in the US (one row per ZIP)."""
    resp = requests.get(ZILLOW_ZORI_ZIP_URL, headers=HEADERS, timeout=120)
    resp.raise_for_status()

    # Verify the response is plain-text CSV, not a zipped archive
    if resp.content.startswith(b"PK"):
        raise RuntimeError("Unexpected compressed binary payload received from Zillow.")

    df = pd.read_csv(io.BytesIO(resp.content), dtype={"RegionName": str})
    missing = {"RegionName", "Metro"} - set(df.columns)
    if missing:
        raise ValueError(f"Zillow file is missing columns {sorted(missing)}; "
                         f"first columns found: {list(df.columns[:10])}")
    df["RegionName"] = df["RegionName"].str.zfill(5)
    return df


# Farther than this from the nearest metro ZIP Zillow tracks, the viewer isn't "in" any metro
# we can show (rural areas, other countries). The dashboard then falls back to DFW.
MAX_LOCATE_MILES = 75.0

_DATE_COL = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
_EARTH_RADIUS_MI = 3958.8

# Column name candidates, first match wins
_ALIASES = {
    "zip_code": ["zip_code", "RegionName", "zip", "ZIP", "zcta"],
    "metro": ["msa_name", "Metro", "metro"],
    "county": ["county", "CountyName"],
    "City": ["City", "city"],
    "state": ["state", "State", "StateName"],
}


def _pick(df: pd.DataFrame, key: str) -> str | None:
    return next((c for c in _ALIASES[key] if c in df.columns), None)


def _zip5(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.replace(r"\.0$", "", regex=True).str.zfill(5)


def _is_long(zillow: pd.DataFrame) -> bool:
    return "zori_rent" in zillow.columns and "month_year" in zillow.columns


#: id(zillow frame) -> (weakref to that frame, its ZIP directory). Not kept in DataFrame.attrs:
#: pandas compares attrs when combining frames, and a DataFrame there breaks that comparison.
_directory_cache: dict[int, tuple[weakref.ref, pd.DataFrame]] = {}


def zip_directory(zillow: pd.DataFrame) -> pd.DataFrame:
    """One row per ZIP Zillow tracks: zip_code, City, county, state, metro (None when the ZIP
    isn't in a metro). Cached per Zillow frame, since the national file is large."""
    hit = _directory_cache.get(id(zillow))
    if hit and hit[0]() is zillow:
        return hit[1]
    cols = {k: _pick(zillow, k) for k in _ALIASES}
    if not cols["zip_code"] or not cols["metro"]:
        raise ValueError("Zillow data has no ZIP or metro column")
    out = pd.DataFrame({
        "zip_code": _zip5(zillow[cols["zip_code"]]),
        "metro": zillow[cols["metro"]],
        "City": zillow[cols["City"]] if cols["City"] else None,
        "county": zillow[cols["county"]] if cols["county"] else None,
        "state": zillow[cols["state"]] if cols["state"] else None,
    })
    out["metro"] = out["metro"].where(out["metro"].notna() & (out["metro"].astype(str).str.strip() != ""), None)
    out = out.drop_duplicates("zip_code").reset_index(drop=True)
    for key in [k for k, (ref, _) in _directory_cache.items() if ref() is None]:
        del _directory_cache[key]   # frames that no longer exist
    _directory_cache[id(zillow)] = (weakref.ref(zillow), out)
    return out


def list_zillow_metros(zillow: pd.DataFrame) -> list[dict]:
    """Every metro with ZIP-level rents: [{metro, zip_count}], most ZIP codes first."""
    d = zip_directory(zillow).dropna(subset=["metro"])
    counts = d.groupby("metro")["zip_code"].nunique().reset_index(name="zip_count")
    counts = counts.sort_values(["zip_count", "metro"], ascending=[False, True])
    return [{"metro": m, "zip_count": int(n)} for m, n in zip(counts["metro"], counts["zip_count"])]


def build_metro_zori_rows(zillow: pd.DataFrame, metro: str) -> list[dict]:
    """
    One metro's rents, one row per ZIP x month with an actual value:
    zip_code, City, county, state, msa_name, month_year (YYYY-MM), year,
    fiscal_year (HUD, Oct-Sep), zori_rent, and Zillow's RegionID / SizeRank / RegionType when present.
    Raises ValueError for a metro Zillow doesn't track.
    """
    metro_col = _pick(zillow, "metro")
    if not metro_col:
        raise ValueError("Zillow data has no metro column")
    sub = zillow[zillow[metro_col] == metro]
    if sub.empty:
        raise ValueError(f"Zillow has no ZIP-level rents for '{metro}'")

    if _is_long(sub):
        long = sub.copy()
        long["month_year"] = long["month_year"].astype(str).str.slice(0, 7)
        long["raw_date"] = long.get("raw_date", long["month_year"])
    else:
        date_cols = [c for c in sub.columns if _DATE_COL.match(str(c))]
        if not date_cols:
            raise ValueError("Zillow data has no month columns")
        id_cols = [c for c in sub.columns if c not in date_cols]
        long = sub.melt(id_vars=id_cols, value_vars=date_cols, var_name="raw_date", value_name="zori_rent")
        long["month_year"] = long["raw_date"].astype(str).str.slice(0, 7)

    long["zori_rent"] = pd.to_numeric(long["zori_rent"], errors="coerce")
    long = long[long["zori_rent"].notna()]

    out = pd.DataFrame({
        "zip_code": _zip5(long[_pick(long, "zip_code")]),
        "City": long[_pick(long, "City")] if _pick(long, "City") else None,
        "county": long[_pick(long, "county")] if _pick(long, "county") else None,
        "state": long[_pick(long, "state")] if _pick(long, "state") else None,
        "msa_name": metro,
        "month_year": long["month_year"],
        "raw_date": long["raw_date"].astype(str),
        "zori_rent": long["zori_rent"].astype(float),
    })
    for c in ("RegionID", "SizeRank", "RegionType"):
        if c in long.columns:
            out[c] = long[c].values
    month = out["month_year"].str.slice(5, 7).astype(int)
    out["year"] = out["month_year"].str.slice(0, 4).astype(int)
    out["fiscal_year"] = out["year"] + (month >= 10).astype(int)   # HUD fiscal year, Oct-Sep
    out = out.sort_values(["zip_code", "month_year"]).drop_duplicates(["zip_code", "month_year"], keep="last")

    # JSON-safe: NaN -> None, numpy ints -> int
    out = out.astype(object).where(out.notna(), None)
    return out.to_dict("records")


def _gazetteer_points(gaz: pd.DataFrame) -> pd.DataFrame:
    """zip_code, lat, lon from the Census ZCTA Gazetteer (raw or renamed columns)."""
    g = gaz.rename(columns=lambda c: str(c).strip())
    zc = next((c for c in ("zip_code", "GEOID", "zcta", "ZCTA5") if c in g.columns), None)
    la = next((c for c in ("lat", "INTPTLAT") if c in g.columns), None)
    lo = next((c for c in ("lon", "INTPTLONG", "lng") if c in g.columns), None)
    if not (zc and la and lo):
        raise ValueError("Gazetteer is missing ZIP or coordinate columns")
    pts = pd.DataFrame({
        "zip_code": _zip5(g[zc]),
        "lat": pd.to_numeric(g[la], errors="coerce"),
        "lon": pd.to_numeric(g[lo], errors="coerce"),
    }).dropna(subset=["lat", "lon"])
    return pts.drop_duplicates("zip_code")


def _miles(lat: float, lon: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    p1, p2 = np.radians(lat), np.radians(lats)
    dlat = p2 - p1
    dlon = np.radians(lons - lon)
    a = np.sin(dlat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_MI * np.arcsin(np.sqrt(a))


def locate_metro(zillow: pd.DataFrame, gaz: pd.DataFrame, lat: float, lon: float,
                 max_miles: float = MAX_LOCATE_MILES) -> dict:
    """
    The metro to show for a viewer at (lat, lon).

    Metros are preferred: the answer is the metro of the nearest ZIP that Zillow tracks *and*
    that belongs to a metro, so a viewer in a small town just outside a metro still gets that
    metro's full set of ZIP codes. `city` / `zip_code` name the nearest tracked ZIP of any kind,
    for a friendly "near Wylie (75098)".

    Returns {metro, zip_code, city, state, distance_mi, metro_zip_count}; metro is None, with a
    `reason`, when no metro ZIP is within max_miles (the frontend then shows DFW).
    """
    directory = zip_directory(zillow).merge(_gazetteer_points(gaz), on="zip_code", how="inner")
    if directory.empty:
        raise ValueError("No Zillow ZIP codes could be matched to map coordinates")

    dist = _miles(lat, lon, directory["lat"].to_numpy(float), directory["lon"].to_numpy(float))
    nearest = directory.iloc[int(np.argmin(dist))]

    in_metro = directory["metro"].notna().to_numpy()
    if not in_metro.any():
        raise ValueError("Zillow data has no metro names")
    metro_dist = np.where(in_metro, dist, np.inf)
    i = int(np.argmin(metro_dist))
    best = directory.iloc[i]
    miles = float(metro_dist[i])

    result = {
        "zip_code": nearest["zip_code"],
        "city": nearest["City"] if isinstance(nearest["City"], str) else None,
        "state": nearest["state"] if isinstance(nearest["state"], str) else None,
        "distance_mi": round(miles, 1),
    }
    if miles > max_miles:
        return {**result, "metro": None, "metro_zip_count": None,
                "reason": f"The nearest metro with Zillow rent data ({best['metro']}) is about "
                          f"{round(miles)} miles away"}

    metro = best["metro"]
    all_zips = zip_directory(zillow)   # count every ZIP in the metro, with or without coordinates
    return {**result, "metro": metro,
            "metro_zip_count": int((all_zips["metro"] == metro).sum())}


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


def principal_city(metro: str) -> tuple[str, str | None]:
    """'Austin-Round Rock-Georgetown, TX' -> ('Austin', 'TX'); the first-named city of a
    Zillow metro is its main city ('Louisville/Jefferson County, KY-IN' -> 'Louisville')."""
    name, sep, states = metro.rpartition(", ")
    if not sep:
        name, states = metro, ""
    city = re.split(r"[-/]", name)[0].strip()
    return city, (states.split("-")[0].strip() or None)


def metro_area_name(metro: str) -> str:
    """Short name for sentences: 'DFW', or the metro name without its states."""
    if metro == DFW_METRO:
        return "DFW"
    name, sep, _ = metro.rpartition(", ")
    return name if sep else metro


def downtown_label(metro: str) -> str:
    """How the distance trait's reference point reads in a sentence ('miles from ...')."""
    return "downtown Dallas or Fort Worth" if metro == DFW_METRO else f"central {principal_city(metro)[0]}"


def metro_downtown_points(metro: str, zori_rows: list[dict], gaz: pd.DataFrame | None = None) -> dict | None:
    """
    Reference point(s) for distance to downtown. DFW uses its two city halls. Any other metro
    uses the center of its main city: the median location of that city's ZIP codes (Census
    internal points), which sits near the urban core and needs no extra download.
    None when the main city has no ZIPs with a location (the distance trait is then skipped).
    """
    if metro == DFW_METRO:
        return DOWNTOWN_POINTS
    city, _ = principal_city(metro)
    zips = {str(r["zip_code"]).zfill(5) for r in zori_rows if r.get("City") == city}
    if not zips:
        return None
    gaz = fetch_zcta_gazetteer() if gaz is None else gaz
    pts = gaz[gaz["zip_code"].isin(zips)].dropna(subset=["lat", "lon"])
    if pts.empty:
        return None
    return {city: (float(pts["lat"].median()), float(pts["lon"].median()))}

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


@functools.lru_cache(maxsize=1)   # national file, reused for every metro; failures aren't cached
def fetch_zcta_gazetteer() -> pd.DataFrame:
    """One row per ZCTA: land area and internal point (lat/lon). Callers must not modify it."""
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
    return _fetch_acs_zcta(year, tuple(variables.items())).copy()


@functools.lru_cache(maxsize=4)   # national tables, reused for every metro
def _fetch_acs_zcta(year: int, var_items: tuple) -> pd.DataFrame:
    variables = dict(var_items)
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


def build_zip_covariates(zip_codes: list[str], downtown_points: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """
    Returns one row per requested ZIP with:
      dist_downtown_mi, nearest_downtown, land_area_sqmi            (Gazetteer)
      (distances only when downtown_points is given; DFW's are in DOWNTOWN_POINTS)
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
        if downtown_points:
            dists = {
                name: _haversine_miles(out["lat"], out["lon"], lat, lon)
                for name, (lat, lon) in downtown_points.items()
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
