import asyncio
import io

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from services.acs_service import (
    build_macro_by_fiscal_year,
    build_historical_dfw_zori_dataset,
    build_zip_covariates,
)
from services.cycle_score_transform import compute_cycle_score
from services.macro_indicators_service import (
    fetch_all_indicators,
    get_gdp_by_year,
    get_monthly_macro,
    NO_GDP,
    NO_MONTHLY_MACRO,
)
from services.rent_divergence_model import fit_divergence_model


router = APIRouter()


def _records(df: pd.DataFrame) -> list[dict]:
    """JSON-safe rows: NaN -> None (NaN is not valid JSON)."""
    return df.astype(object).where(df.notna(), None).to_dict("records")


# ---------------------------------------------------------------------------
# Zillow ZORI (cached in memory; Zillow updates monthly, restart to refresh)
# ---------------------------------------------------------------------------
_zori_cache = None
_zori_lock = asyncio.Lock()


async def _get_zori() -> dict:
    global _zori_cache
    if _zori_cache is None:
        async with _zori_lock:
            if _zori_cache is None:
                rows, failures = await asyncio.to_thread(build_historical_dfw_zori_dataset)
                if not rows:
                    raise HTTPException(status_code=502, detail=f"Zillow ingestion failed: {failures}")
                _zori_cache = {"rows": rows, "failures": failures}
    return _zori_cache


async def _joined_zori_rows() -> tuple[pd.DataFrame, dict]:
    """ZORI rows with monthly macro joined on month and real GDP on HUD fiscal year."""
    zori = await _get_zori()
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
async def get_dfw_zori_history():
    """
    Zillow Observed Rent Index actuals for DFW, one row per ZIP code x calendar month.
    Monthly macro values are joined on the same month; real GDP is joined on the HUD
    fiscal year the month falls in (Oct-Sep).
    """
    df, failures = await _joined_zori_rows()
    return {"rows": _records(df), "failures": failures}


# ---------------------------------------------------------------------------
# ZIP-level covariates (Census Gazetteer + ACS); change ~yearly, cached in memory
# ---------------------------------------------------------------------------
_covariate_cache = None
_covariate_lock = asyncio.Lock()


async def _get_zip_covariates() -> dict:
    global _covariate_cache
    if _covariate_cache is None:
        async with _covariate_lock:
            if _covariate_cache is None:
                zori = await _get_zori()
                zips = {r["zip_code"] for r in zori["rows"]}
                df, failures = await asyncio.to_thread(build_zip_covariates, list(zips))
                # Don't cache a result where a whole source failed; retry next request
                if any(k.startswith(("gazetteer", "acs_")) for k in failures):
                    return {"df": df, "failures": failures}
                _covariate_cache = {"df": df, "failures": failures}
    return _covariate_cache


@router.get("/dfw-zip-covariates")
async def dfw_zip_covariates():
    """One row per DFW ZIP: distance to downtown, pre-boom income / renter share /
    density, and new-supply measures."""
    cov = await _get_zip_covariates()
    df = cov["df"]
    return {
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
async def rent_panel_with_acs():
    """CSV download: the ZORI x month panel with macro columns plus the ZIP-level
    Census covariates (repeated on every month of a ZIP). Census columns are blank,
    not missing, if a Census source failed; the reason is in the X-Data-Failures header."""
    df, failures = await _joined_zori_rows()
    cov = await _get_zip_covariates()
    failures.update(cov["failures"])

    cov_df = cov["df"].reindex(columns=["zip_code", *COVARIATE_CSV_COLUMNS])
    out = df.reindex(columns=PANEL_CSV_COLUMNS).merge(cov_df, on="zip_code", how="left")
    out = out.sort_values(["zip_code", "month_year"])

    buf = io.StringIO()
    out.to_csv(buf, index=False)
    headers = {"Content-Disposition": 'attachment; filename="dfw_rent_panel_with_acs.csv"'}
    if failures:
        headers["X-Data-Failures"] = ", ".join(sorted(failures))   # source names only
        headers["Access-Control-Expose-Headers"] = "X-Data-Failures"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


# ---------------------------------------------------------------------------
# Research question: did the 2021-22 boom end differently across ZIPs, and why?
# ---------------------------------------------------------------------------
@router.get("/dfw-rent-divergence")
async def dfw_rent_divergence(
    spec: str = Query("full", pattern="^(base|full)$",
                      description="base = boom, rent level, county; full = adds Census traits"),
    event_study: bool = Query(False, description="Separate post-peak effects by year"),
    rate_interaction: bool = Query(True, description="Add mortgage rate x pre-boom rent level"),
    start: str = Query("2020-01", pattern=r"^\d{4}-\d{2}$"),
    end: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    post_after: str = Query("2022-08", pattern=r"^\d{4}-\d{2}$",
                            description="Last month of the boom; Post = months after this"),
    compare_from: str = Query("2022-03", pattern=r"^\d{4}-\d{2}$",
                              description="Start of the near-peak comparison period"),
):
    zori = await _get_zori()
    panel = pd.DataFrame(zori["rows"])

    failures = {}
    covariates = None
    if spec == "full":
        cov = await _get_zip_covariates()
        covariates, failures = cov["df"], dict(cov["failures"])

    macro_by_month = None
    if rate_interaction:
        macro_cache = await get_monthly_macro()
        macro_by_month = macro_cache.get("by_month") or None
        failures.update({f"macro_{k}": v for k, v in macro_cache.get("errors", {}).items()})

    try:
        result = await asyncio.to_thread(
            fit_divergence_model, panel, covariates, macro_by_month, spec, event_study,
            start=start, end=end, post_after=post_after, compare_from=compare_from,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    result["data_failures"] = failures
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
