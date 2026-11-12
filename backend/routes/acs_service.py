import asyncio
import io
import re

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from services.acs_service import (
    DFW_METRO,
    build_macro_by_fiscal_year,
    build_metro_zori_rows,
    build_zip_covariates,
    downtown_label,
    fetch_zcta_gazetteer,
    fetch_zillow_zori_matrix,
    list_zillow_metros,
    locate_metro,
    metro_area_name,
    metro_downtown_points,
)
from services.cycle_score_transform import compute_cycle_score
from services.macro_indicators_service import (
    fetch_all_indicators,
    get_gdp_by_year,
    get_monthly_macro,
    NO_GDP,
    NO_MONTHLY_MACRO,
)
from services.rent_divergence_model import NotEnoughZips, fit_divergence_model


# ===========================================================================
# Rental dashboard endpoints: what's available now
#
#   GET /dfw-zori               Zillow rents (ZORI) per ZIP x month for a metro, with national
#                               macro values joined in. Feeds the dashboard, map, charts and grid.
#   GET /rent-metros            Every metro Zillow covers (the metro picker).
#   GET /rent-locate            Metro nearest to the viewer's location.
#   GET /rent-preview-metros    Small preview of the largest metros for the main dashboard.
#   GET /dfw-zip-covariates     Census values per ZIP (income, density, new housing, rental growth,
#                               distance to downtown). Used by the map and by "What drives rents?"
#                               (RentDriversSection.jsx), which compares each county with the metro.
#   GET /rent-panel-with-acs    CSV download: rent panel plus the Census values.
#   GET /dfw-rent-divergence    Boom-divergence research model.
#   GET /dfw-macro, /macro-indicators   Macro indicators and the cycle score.
#
# Pending (paid version): "Local market report" in RentDriversSection.jsx
#   The dashboard shows it as Pending and offers a fixed sample report for Collin County, DFW
#   (SAMPLE_REPORT in RentDriversSection.jsx). No backend endpoint is used for it yet.
#   Planned: GET /rent-report?metro=&county= returning a report in the same format as
#   SAMPLE_REPORT, written by an AI model with web search (e.g. the Claude API), saved for
#   about 30 days, created only for signed-in subscribers, with a monthly spending cap.
#
# Removed for now: the local research agents (news search with Ollama, and the schools/
# hospitals/OpenStreetMap graph) and their /rent-context and /rent-amenities endpoints.
# ===========================================================================

router = APIRouter()


def _records(df: pd.DataFrame) -> list[dict]:
    """JSON-safe rows: NaN -> None (NaN is not valid JSON)."""
    return df.astype(object).where(df.notna(), None).to_dict("records")


# ---------------------------------------------------------------------------
# Zillow ZORI (cached in memory; Zillow updates monthly, restart to refresh)
# ---------------------------------------------------------------------------
# The national file is downloaded once; each metro's rows are sliced out on first use.
_zillow_cache = None
_zillow_lock = asyncio.Lock()
_zori_cache: dict[str, dict] = {}   # insertion order = least recently used first
_zori_lock = asyncio.Lock()
# Viewers come from many metros; keep the most recently used ones (DFW is never evicted)
MAX_CACHED_METROS = 12

# Query param shared by every rent endpoint; values are Zillow metro names
MetroParam = Query(DFW_METRO, max_length=120,
                   description="Zillow metro name, e.g. 'Dallas-Fort Worth-Arlington, TX'")


async def _get_zillow() -> pd.DataFrame:
    global _zillow_cache
    if _zillow_cache is None:
        async with _zillow_lock:
            if _zillow_cache is None:
                try:
                    _zillow_cache = await asyncio.to_thread(fetch_zillow_zori_matrix)
                except Exception as e:
                    raise HTTPException(status_code=502, detail=f"Zillow ingestion failed: {e}")
    return _zillow_cache


def _evict_old_metros(cache: dict) -> None:
    while len(cache) > MAX_CACHED_METROS:
        oldest = next((m for m in cache if m != DFW_METRO), None)
        if oldest is None:
            break
        cache.pop(oldest)


async def _get_zori(metro: str = DFW_METRO) -> dict:
    if metro in _zori_cache:
        _zori_cache[metro] = _zori_cache.pop(metro)   # mark as recently used
        return _zori_cache[metro]
    zillow = await _get_zillow()
    async with _zori_lock:
        if metro not in _zori_cache:
            try:
                rows = await asyncio.to_thread(build_metro_zori_rows, zillow, metro)
            except ValueError as e:
                raise HTTPException(status_code=404, detail=str(e))
            _zori_cache[metro] = {"rows": rows, "failures": {}}
            _evict_old_metros(_zori_cache)
    return _zori_cache[metro]


# Census ZCTA Gazetteer (ZIP centroids) for the location lookup; changes yearly
_gazetteer_cache = None
_gazetteer_lock = asyncio.Lock()


async def _get_gazetteer() -> pd.DataFrame:
    global _gazetteer_cache
    if _gazetteer_cache is None:
        async with _gazetteer_lock:
            if _gazetteer_cache is None:
                _gazetteer_cache = await asyncio.to_thread(fetch_zcta_gazetteer)
    return _gazetteer_cache


async def _joined_zori_rows(metro: str = DFW_METRO) -> tuple[pd.DataFrame, dict]:
    """ZORI rows with monthly macro joined on month and real GDP on HUD fiscal year."""
    zori = await _get_zori(metro)
    gdp_cache, macro_cache = await asyncio.gather(get_gdp_by_year(), get_monthly_macro())
    gdp_by_year = gdp_cache.get("by_year", {})
    macro_by_month = macro_cache.get("by_month", {})

    joined_rows = [
        {
            **r,
            **NO_GDP,
            **NO_MONTHLY_MACRO,
            **gdp_by_year.get(int(r["fiscal_year"]), {}),
            **macro_by_month.get(r["month_year"], {}),
        }
        for r in zori["rows"]
    ]

    failures = dict(zori["failures"])
    if gdp_cache.get("error"):
        failures["real_gdp"] = gdp_cache["error"]
    failures.update({f"macro_{k}": v for k, v in macro_cache.get("errors", {}).items()})
    return pd.DataFrame(joined_rows), failures


@router.get("/dfw-zori")
async def get_dfw_zori_history(metro: str = MetroParam):
    """
    Zillow Observed Rent Index actuals for one metro (DFW by default), one row per
    ZIP code x calendar month. Monthly macro values (national) are joined on the same
    month; real GDP is joined on the HUD fiscal year the month falls in (Oct-Sep).
    """
    df, failures = await _joined_zori_rows(metro)
    return {"metro": metro, "rows": _records(df), "failures": failures}


@router.get("/rent-metros")
async def rent_metros():
    """Every metro Zillow publishes ZIP-level rents for, largest first."""
    zillow = await _get_zillow()
    return {"default": DFW_METRO, "metros": list_zillow_metros(zillow)}


@router.get("/rent-locate")
async def rent_locate(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """The metro to show for a viewer at (lat, lon): the metro of the nearest Zillow-tracked
    ZIP that belongs to a metro. Returns metro=None (with a reason) when no metro is close
    enough; the dashboard then shows DFW. The coordinates are used for this lookup only and
    never stored or logged (the frontend also rounds them to about 1 km before sending)."""
    zillow = await _get_zillow()
    try:
        gaz = await _get_gazetteer()
        return await asyncio.to_thread(locate_metro, zillow, gaz, lat, lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not match your location to a metro: {e}")


# ---------------------------------------------------------------------------
# Dashboard preview: the largest metros' ZIP rents and monthly averages, in one small response
# ---------------------------------------------------------------------------
_preview_cache: dict[tuple, dict] = {}
_preview_lock = asyncio.Lock()
_DATE_COL = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
RECENT_MONTHS = 3          # a ZIP's latest rent may come from any of the last 3 months
PREVIEW_START = "2020-01"  # first month of the monthly averages


def _first_col(df: pd.DataFrame, names: list[str]) -> str | None:
    return next((c for c in names if c in df.columns), None)


def _zip5(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.replace(r"\.0$", "", regex=True).str.zfill(5)


def _short_name(metro: str) -> str:
    """'New York-Newark-Jersey City, NY-NJ-PA' -> 'New York'"""
    return str(metro).split(",")[0].split("-")[0].strip()


def build_metro_previews(zillow: pd.DataFrame, gaz: pd.DataFrame, n: int = 4,
                         metros: list[str] | None = None, n_counties: int = 4) -> dict:
    """The requested metros (or the n with the most ZIP codes): for each, every ZIP's latest
    rent with its location ([lat, lon, rent]), the metro's average rent per month since
    PREVIEW_START ([month, rent]), and its n_counties largest counties, each with a centre
    point and its own monthly average. Accepts Zillow's wide CSV layout or a long one, and
    raw or renamed Gazetteer columns."""
    zip_col = _first_col(zillow, ["zip_code", "RegionName", "zip", "ZIP"])
    metro_col = _first_col(zillow, ["msa_name", "Metro", "metro"])
    county_col = _first_col(zillow, ["county", "CountyName"])
    if not zip_col or not metro_col:
        raise ValueError("Zillow data has no ZIP or metro column")

    # One row per ZIP x month: zip, metro, month, rent
    if "zori_rent" in zillow.columns and "month_year" in zillow.columns:
        long = pd.DataFrame({
            "zip": _zip5(zillow[zip_col]), "metro": zillow[metro_col],
            "county": zillow[county_col] if county_col else None,
            "month": zillow["month_year"].astype(str).str.slice(0, 7),
            "rent": pd.to_numeric(zillow["zori_rent"], errors="coerce"),
        })
    else:
        date_cols = [c for c in zillow.columns if _DATE_COL.match(str(c))]
        if not date_cols:
            raise ValueError("Zillow data has no month columns")
        id_cols = [zip_col, metro_col] + ([county_col] if county_col else [])
        wide = zillow[[*id_cols, *date_cols]].copy()
        wide[zip_col] = _zip5(wide[zip_col])
        long = wide.melt(id_vars=id_cols, var_name="month", value_name="rent")
        long = long.rename(columns={zip_col: "zip", metro_col: "metro", **({county_col: "county"} if county_col else {})})
        if "county" not in long.columns:
            long["county"] = None
        long["month"] = long["month"].astype(str).str.slice(0, 7)
        long["rent"] = pd.to_numeric(long["rent"], errors="coerce")
    long = long.dropna(subset=["rent", "metro"])
    long = long[long["metro"].astype(str).str.strip() != ""]
    if long.empty:
        raise ValueError("Zillow data has no rents")

    if metros:
        known = set(long["metro"].unique())
        top = [m for m in metros if m in known]
        if not top:
            raise ValueError(f"Zillow has no rents for {', '.join(metros)}")
    else:
        top = long.groupby("metro")["zip"].nunique().sort_values(ascending=False).head(n).index.tolist()
    long = long[long["metro"].isin(top)]

    g = gaz.rename(columns=lambda c: str(c).strip())
    gz, la, lo = (_first_col(g, ["zip_code", "GEOID", "zcta", "ZCTA5"]),
                  _first_col(g, ["lat", "INTPTLAT"]), _first_col(g, ["lon", "INTPTLONG", "lng"]))
    if not (gz and la and lo):
        raise ValueError("Gazetteer is missing ZIP or coordinate columns")
    coords = pd.DataFrame({
        "zip": _zip5(g[gz]),
        "lat": pd.to_numeric(g[la], errors="coerce"),
        "lon": pd.to_numeric(g[lo], errors="coerce"),
    }).dropna().drop_duplicates("zip").set_index("zip")

    months = sorted(long["month"].unique())
    latest_month = months[-1]
    recent = long[long["month"].isin(months[-RECENT_MONTHS:])].sort_values("month")

    result = []
    for metro in top:
        latest = recent[recent["metro"] == metro].groupby("zip").last()
        placed = latest.join(coords, how="inner")
        points = [[round(float(a), 3), round(float(b), 3), int(round(float(r)))]
                  for a, b, r in zip(placed["lat"], placed["lon"], placed["rent"])]
        avg = long[(long["metro"] == metro) & (long["month"] >= PREVIEW_START)].groupby("month")["rent"].mean()
        # The metro's largest counties: a centre point (average ZIP location) and monthly average
        counties = []
        in_metro = long[(long["metro"] == metro) & long["county"].notna()]
        for county in in_metro.groupby("county")["zip"].nunique().sort_values(ascending=False).head(n_counties).index:
            c_zips = placed[placed["county"] == county] if "county" in placed.columns else placed.iloc[0:0]
            c_avg = in_metro[(in_metro["county"] == county) & (in_metro["month"] >= PREVIEW_START)].groupby("month")["rent"].mean()
            counties.append({
                "county": county,
                "label": str(county).replace(" County", ""),
                "lat": round(float(c_zips["lat"].mean()), 3) if len(c_zips) else None,
                "lon": round(float(c_zips["lon"].mean()), 3) if len(c_zips) else None,
                "series": [[m, int(round(float(v)))] for m, v in c_avg.sort_index().items()],
            })
        result.append({
            "metro": metro,
            "label": _short_name(metro),
            "zip_count": int(long.loc[long["metro"] == metro, "zip"].nunique()),
            "points": points,
            "series": [[m, int(round(float(v)))] for m, v in avg.sort_index().items()],
            "counties": counties,
        })
    return {"month": latest_month, "metros": result}


@router.get("/rent-preview-metros")
async def rent_preview_metros(
    count: int = Query(4, ge=1, le=6),
    metro: str | None = Query(None, max_length=120,
                              description="One Zillow metro to show instead of the largest ones"),
):
    """For the dashboard preview: one metro, or the `count` metros with the most ZIP codes,
    each with its ZIPs' latest rents and locations ([lat, lon, rent]), its average rent per
    month since 2020 ([month, rent]) and its largest counties. Built once per request setting
    from the cached Zillow file and Census Gazetteer."""
    key = (metro,) if metro else (count,)
    if key not in _preview_cache:
        zillow = await _get_zillow()
        async with _preview_lock:
            if key not in _preview_cache:
                try:
                    gaz = await _get_gazetteer()
                    _preview_cache[key] = await asyncio.to_thread(
                        build_metro_previews, zillow, gaz, count, [metro] if metro else None)
                except ValueError as e:
                    raise HTTPException(status_code=404, detail=str(e))
                except Exception as e:
                    raise HTTPException(status_code=502, detail=f"Could not build the dashboard preview: {e}")
    return _preview_cache[key]


# ---------------------------------------------------------------------------
# ZIP-level covariates (Census Gazetteer + ACS); change ~yearly, cached in memory
# ---------------------------------------------------------------------------
_covariate_cache: dict[str, dict] = {}
_covariate_lock = asyncio.Lock()


async def _get_zip_covariates(metro: str = DFW_METRO) -> dict:
    if metro not in _covariate_cache:
        zori = await _get_zori(metro)
        async with _covariate_lock:
            if metro not in _covariate_cache:
                zips = {r["zip_code"] for r in zori["rows"]}
                # Distance to downtown: DFW's two city halls, else the center of the metro's
                # main city. Without a location source the trait is skipped, not guessed.
                try:
                    downtowns = await asyncio.to_thread(metro_downtown_points, metro, zori["rows"])
                except Exception:
                    downtowns = None
                df, failures = await asyncio.to_thread(build_zip_covariates, list(zips), downtowns)
                # Don't cache a result where a whole source failed; retry next request
                if any(k.startswith(("gazetteer", "acs_")) for k in failures):
                    return {"df": df, "failures": failures}
                _covariate_cache[metro] = {"df": df, "failures": failures}
                _evict_old_metros(_covariate_cache)
    return _covariate_cache[metro]


@router.get("/dfw-zip-covariates")
async def dfw_zip_covariates(metro: str = MetroParam):
    """One row per ZIP in the metro: location, pre-boom income / renter share /
    density, and new-supply measures (plus distance to downtown for DFW)."""
    cov = await _get_zip_covariates(metro)
    df = cov["df"]
    return {
        "metro": metro,
        "rows": _records(df),
        "acs_baseline_year": df.attrs.get("acs_baseline_year"),
        "acs_recent_year": df.attrs.get("acs_recent_year"),
        "failures": cov["failures"],
    }


PANEL_CSV_COLUMNS = [
    "zip_code", "City", "county", "month_year", "fiscal_year", "zori_rent",
    "real_gdp", "real_gdp_growth",
    "unemployment_rate", "unemployment_rate_change", "unemployment_rate_lag_6m",
    "interest_rate", "interest_rate_change", "mortgage_rate_30y", "inflation_rate",
]
COVARIATE_CSV_COLUMNS = [
    "dist_downtown_mi", "nearest_downtown", "land_area_sqmi",
    "population", "pop_density_sqmi", "median_household_income", "renter_share",
    "median_gross_rent_acs", "new_build_share", "renter_stock_growth",
]


@router.get("/rent-panel-with-acs")
async def rent_panel_with_acs(metro: str = MetroParam):
    """CSV download: the ZORI x month panel with macro columns plus the ZIP-level
    Census covariates (repeated on every month of a ZIP). Census columns are blank,
    not missing, if a Census source failed; the reason is in the X-Data-Failures header."""
    df, failures = await _joined_zori_rows(metro)
    cov = await _get_zip_covariates(metro)
    failures.update(cov["failures"])

    cov_df = cov["df"].reindex(columns=["zip_code", *COVARIATE_CSV_COLUMNS])
    out = df.reindex(columns=PANEL_CSV_COLUMNS).merge(cov_df, on="zip_code", how="left")
    out = out.sort_values(["zip_code", "month_year"])

    buf = io.StringIO()
    out.to_csv(buf, index=False)
    slug = re.sub(r"[^a-z0-9]+", "_", metro.lower()).strip("_")
    headers = {
        "Content-Disposition": f'attachment; filename="{slug}_rent_panel_with_acs.csv"',
        # Cross-origin pages can only read headers listed here (the download names the file from it)
        "Access-Control-Expose-Headers": "Content-Disposition, X-Data-Failures",
    }
    if failures:
        headers["X-Data-Failures"] = ", ".join(sorted(failures))   # source names only
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


# ---------------------------------------------------------------------------
# Research question: did the 2021-22 boom end differently across a metro's ZIPs, and why?
# ---------------------------------------------------------------------------
# Fitted results, keyed by every request setting. The dashboard summary and the full report
# ask for the same fit, and the inputs only change when Zillow or Census data is reloaded.
_divergence_cache: dict[tuple, dict] = {}
MAX_CACHED_FITS = 32
# Failures that may clear on a retry; a result that has one isn't cached
_TRANSIENT_FAILURES = ("gazetteer", "acs_", "macro_")


@router.get("/dfw-rent-divergence")
async def dfw_rent_divergence(
    metro: str = MetroParam,
    spec: str = Query("full", pattern="^(base|full)$",
                      description="base = boom, rent level, county; full = adds Census traits"),
    event_study: bool = Query(False, description="Separate post-peak effects by year"),
    rate_interaction: bool = Query(True, description="Add mortgage rate x pre-boom rent level"),
    start: str = Query("2020-01", pattern=r"^\d{4}-\d{2}$"),
    base_month: str = Query("2020-01", pattern=r"^\d{4}-\d{2}$",
                            description="Month each ZIP's boom is measured from. A metro whose rents "
                                        "start later (by 2020-12) is measured from its first month."),
    end: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    post_after: str = Query("2022-08", pattern=r"^\d{4}-\d{2}$",
                            description="Last month of the boom; Post = months after this"),
    compare_from: str = Query("2022-03", pattern=r"^\d{4}-\d{2}$",
                              description="Start of the near-peak comparison period"),
):
    """
    Two-way fixed-effects model for any Zillow metro (DFW by default). When the metro has too
    few ZIP codes with complete data, returns 200 with available=false and a reason, so the
    dashboard can say so instead of showing an error.
    """
    key = (metro, spec, event_study, rate_interaction, start, base_month, end, post_after, compare_from)
    if key in _divergence_cache:
        return _divergence_cache[key]

    area = metro_area_name(metro)
    zori = await _get_zori(metro)
    panel = pd.DataFrame(zori["rows"])

    failures = {}
    covariates = None
    if spec == "full":
        cov = await _get_zip_covariates(metro)
        covariates, failures = cov["df"], dict(cov["failures"])

    macro_by_month = None
    if rate_interaction:
        macro_cache = await get_monthly_macro()
        macro_by_month = macro_cache.get("by_month") or None
        failures.update({f"macro_{k}": v for k, v in macro_cache.get("errors", {}).items()})

    try:
        result = await asyncio.to_thread(
            fit_divergence_model, panel, covariates, macro_by_month, spec, event_study,
            metro=metro, area_name=area,
            start=start, base_month=base_month, end=end, post_after=post_after,
            compare_from=compare_from,
        )
    except NotEnoughZips as e:
        result = {"available": False, "metro": metro, "area_name": area, "spec": spec,
                  "event_study": event_study, "reason": str(e)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    result["downtown_label"] = downtown_label(metro)
    result["data_failures"] = failures
    if not any(k.startswith(_TRANSIENT_FAILURES) for k in failures):
        _divergence_cache[key] = result
        while len(_divergence_cache) > MAX_CACHED_FITS:
            _divergence_cache.pop(next(iter(_divergence_cache)))
    return result


# ---------------------------------------------------------------------------
# Existing routes
# ---------------------------------------------------------------------------
_macro_cache = None


def get_macro():
    global _macro_cache
    if _macro_cache is None:
        _macro_cache = build_macro_by_fiscal_year()
    return _macro_cache


@router.get("/dfw-macro")
def dfw_macro():
    df, failures = get_macro()
    return {"rows": _records(df), "failures": failures}


real_estate_cache = None


@router.get("/macro-indicators")
async def get_macro_indicators():
    global real_estate_cache
    indicators = await fetch_all_indicators()
    indicators["cycle_score"] = compute_cycle_score(indicators["automated"])
    real_estate_cache = indicators
    return real_estate_cache
