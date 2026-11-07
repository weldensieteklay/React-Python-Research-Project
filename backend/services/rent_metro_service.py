"""
Metro-level helpers for the rental dashboard, built on Zillow's ZIP-level ZORI file.

    list_zillow_metros(zillow)              -> every metro Zillow tracks, largest first
    build_metro_zori_rows(zillow, metro)    -> one metro's ZIP x month rent rows
    locate_metro(zillow, gaz, lat, lon)     -> the metro to show for a viewer's location

`zillow` is whatever fetch_zillow_zori_matrix() returns. Both shapes are accepted:
  * wide (Zillow's CSV as published): RegionID, SizeRank, RegionName, RegionType, StateName,
    State, City, Metro, CountyName, then one column per month ("2015-01-31", ...)
  * long: one row per ZIP x month with zip_code, month_year, zori_rent (+ City, county, msa_name)

`gaz` is the Census ZCTA Gazetteer (fetch_zcta_gazetteer()); either the raw Census columns
(GEOID, INTPTLAT, INTPTLONG) or renamed ones (zip_code, lat, lon) are accepted.
"""
from __future__ import annotations

import re
import weakref

import numpy as np
import pandas as pd

DFW_METRO = "Dallas-Fort Worth-Arlington, TX"

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
