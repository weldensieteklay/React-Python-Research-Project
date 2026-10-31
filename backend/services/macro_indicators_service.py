"""
services/macro_indicators_service.py

Fetches the raw data behind the Harvest Time Capital Macro Intelligence Engine
(Methodology v2.0, Oct 2026). All 17 indicators now come from free, automated
sources -- no manual imports:

  #   Indicator                 Source (FRED unless noted)
  1   Fed Funds trend           EFFR
  2   Inflation                 BLS CPI-U (CUUR0000SA0)
  3   10-yr Treasury            DGS10
  4   Credit conditions         SLOOS CRE net % tightening: SUBLPDRCSC, SUBLPDRCSN, SUBLPDRCSM
  5   GDP growth                GDPC1
  6   Labor market              UNRATE + JTSJOL
  7   Midwest PMI (substitute)  CFNAIMA3 (Chicago Fed National Activity Index, 3-mo avg)
  8   Migration                 Midwest state population (ILPOP, MIPOP, ...)
  9   Wage growth               CES0500000003
  10  Construction pipeline     PERMITMW (Midwest building permits)
  11  Cap rate spread (v2)      COMREPUSQ159N + CPI + DGS10 (implied cap rate)
  12  Rent growth               Zillow ZORI (Midwest metros)
  13  Vacancy (v2)              STLFSI4, weekly -> quarterly
  14  Distress (v2)             COMREPUSQ159N
  15  Transaction volume (v2)   TTLCONS, monthly -> quarterly
  16  Consumer confidence       UMCSENT
  17  Mortgage rates            MORTGAGE30US

NOTE on COMREPUSQ159N: FRED publishes it as "Percent Change from Year Ago", not as an
index level, and it lags by roughly two quarters. Scoring code treats it as YoY %.
"""
import asyncio
import os
import re
import time
from io import StringIO

import httpx
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
BLS_API_KEY = os.environ.get("BLS_API_KEY", "")

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; HTC-DataBot/1.0)"}
FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"

MIDWEST_METRO_KEYWORDS = [
    "Chicago", "Detroit", "Minneapolis", "St. Louis", "Kansas City",
    "Columbus", "Indianapolis", "Cincinnati", "Cleveland", "Milwaukee",
    "Omaha", "Des Moines",
]


def _check_required_keys():
    """Fail loudly instead of sending an empty api_key= to FRED (every indicator but CPI uses it)."""
    if not FRED_API_KEY:
        raise RuntimeError(
            "Missing FRED_API_KEY (https://fred.stlouisfed.org/docs/api/api_key.html). "
            "Set it in the environment or .env before starting the server."
        )


# ---------------------------------------------------------------------
# FRED
# ---------------------------------------------------------------------
# key -> (series_id, label). The key is also the value column name in each row.
FRED_SERIES = {
    # rates & macro
    "fed_funds_rate":             ("EFFR", "Federal Funds Rate (Effective)"),
    "treasury_10y":               ("DGS10", "10-Year Treasury Yield"),
    "unemployment_rate":          ("UNRATE", "Unemployment Rate"),
    "jolts_job_openings":         ("JTSJOL", "JOLTS Job Openings"),
    "avg_hourly_earnings":        ("CES0500000003", "Average Hourly Earnings, Total Private (wage proxy)"),
    "mortgage_rate_30y":          ("MORTGAGE30US", "30-Year Fixed Mortgage Rate"),
    "consumer_sentiment_umcsent": ("UMCSENT", "Consumer Sentiment, University of Michigan (CCI proxy)"),
    # #4 Credit conditions: SLOOS, net % of domestic banks tightening CRE standards (quarterly)
    "sloos_cre_construction":     ("SUBLPDRCSC", "SLOOS: Net % Tightening CRE Standards, Construction & Land Development"),
    "sloos_cre_nonfarm":          ("SUBLPDRCSN", "SLOOS: Net % Tightening CRE Standards, Nonfarm Nonresidential"),
    "sloos_cre_multifamily":      ("SUBLPDRCSM", "SLOOS: Net % Tightening CRE Standards, Multifamily"),
    # #7 Midwest PMI substitute (Chicago PMI is licensed)
    "cfnai_ma3":                  ("CFNAIMA3", "Chicago Fed National Activity Index, 3-Month Moving Average (PMI substitute)"),
    # #10 Construction pipeline
    "building_permits_midwest":   ("PERMITMW", "Building Permits, Total Units, Midwest Census Region (SAAR, thousands)"),
    # #11 Cap rate spread / #14 Distress (v2)
    "cre_price_index":            ("COMREPUSQ159N", "Commercial Real Estate Prices, US (% change from year ago)"),
    # #13 Vacancy (v2)
    "financial_stress_index":     ("STLFSI4", "St. Louis Fed Financial Stress Index"),
    # #15 Transaction volume (v2)
    "construction_spending":      ("TTLCONS", "Total Construction Spending (SAAR, $ millions)"),
    # Direct measures, kept as cross-checks and for the optional source switches in
    # cycle_score_transform (HTC_VACANCY_SOURCE / HTC_DISTRESS_SOURCE)
    "rental_vacancy_rate":        ("RRVRUSQ156N", "Rental Vacancy Rate (Census)"),
    "cre_delinquency_rate":       ("DRCRELEXFACBS", "CRE Loan Delinquency Rate, All Commercial Banks"),
}


async def fetch_fred_series(client: httpx.AsyncClient, series_id: str) -> pd.DataFrame:
    resp = await client.get(
        FRED_OBSERVATIONS_URL,
        params={"series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json"},
        timeout=30,
    )
    resp.raise_for_status()
    obs = resp.json().get("observations", [])
    if not obs:
        raise RuntimeError(f"FRED returned no observations for {series_id}")
    df = pd.DataFrame(obs)[["date", "value"]]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")   # FRED uses "." for missing
    return df.dropna(subset=["value"])


def _fred_payload(key: str, series_id: str, label: str, df: pd.DataFrame) -> dict:
    return {
        "label": label, "series_id": series_id, "source": "FRED",
        "rows": df.rename(columns={"value": key}).to_dict("records"),
    }


async def fetch_all_fred(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    keys = list(FRED_SERIES)
    fetched = await asyncio.gather(
        *[fetch_fred_series(client, FRED_SERIES[k][0]) for k in keys],
        return_exceptions=True,
    )
    for key, res in zip(keys, fetched):
        series_id, label = FRED_SERIES[key]
        if isinstance(res, Exception):
            failures[key] = f"{series_id}: {res}"
        else:
            results[key] = _fred_payload(key, series_id, label, res)
    return {"data": results, "failures": failures}


# ---------------------------------------------------------------------
# BLS: CPI (#2)
# ---------------------------------------------------------------------
BLS_SERIES = {
    "cpi_all_items": ("CUUR0000SA0", "CPI-U All Items (national)"),
}


async def fetch_bls_series(client: httpx.AsyncClient, series_id: str) -> pd.DataFrame:
    url = f"https://api.bls.gov/publicAPI/v2/timeseries/data/{series_id}"
    params = {"registrationkey": BLS_API_KEY} if BLS_API_KEY else {}
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS API error: {payload.get('message')}")
    rows = payload["Results"]["series"][0].get("data", [])
    if not rows:
        raise RuntimeError(f"BLS returned zero observations for series '{series_id}'")
    df = pd.DataFrame(rows)[["year", "period", "value"]]
    df = df[df["period"].str.match(r"^M(0[1-9]|1[0-2])$")]   # monthly only (M13 = annual average)
    df["date"] = df["year"] + "-" + df["period"].str[1:] + "-01"
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df[["date", "value"]].dropna().sort_values("date")


async def fetch_all_bls(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    for key, (series_id, label) in BLS_SERIES.items():
        try:
            df = await fetch_bls_series(client, series_id)
            results[key] = {
                "label": label, "series_id": series_id, "source": "BLS",
                "rows": df.rename(columns={"value": key}).to_dict("records"),
            }
        except Exception as e:
            failures[key] = str(e)
    return {"data": results, "failures": failures}


# ---------------------------------------------------------------------
# GDP (#5) and PCE, via FRED
# ---------------------------------------------------------------------
async def fetch_real_gdp(client: httpx.AsyncClient) -> dict:
    try:
        df = await fetch_fred_series(client, "GDPC1")
        return {"data": {"real_gdp": _fred_payload("real_gdp", "GDPC1", "Real GDP", df)}, "failures": {}}
    except Exception as e:
        return {"data": {}, "failures": {"real_gdp": str(e)}}


async def fetch_pce_price_index(client: httpx.AsyncClient) -> dict:
    try:
        df = await fetch_fred_series(client, "PCEPI")
        return {"data": {"pce_price_index": _fred_payload("pce_price_index", "PCEPI", "PCE Price Index", df)}, "failures": {}}
    except Exception as e:
        return {"data": {}, "failures": {"pce_price_index": str(e)}}


# ---------------------------------------------------------------------
# Migration (#8): Midwest state population, FRED republishing Census
# ---------------------------------------------------------------------
MIDWEST_STATE_POP_SERIES = {
    "IL": "ILPOP", "IN": "INPOP", "IA": "IAPOP", "KS": "KSPOP",
    "MI": "MIPOP", "MN": "MNPOP", "MO": "MOPOP", "NE": "NEPOP",
    "ND": "NDPOP", "OH": "OHPOP", "SD": "SDPOP", "WI": "WIPOP",
}


async def fetch_midwest_population_fred(client: httpx.AsyncClient) -> dict:
    results = await asyncio.gather(
        *[fetch_fred_series(client, s) for s in MIDWEST_STATE_POP_SERIES.values()],
        return_exceptions=True,
    )
    all_rows, failures = [], {}
    for (state, series_id), res in zip(MIDWEST_STATE_POP_SERIES.items(), results):
        if isinstance(res, Exception):
            failures[state] = f"{series_id}: {res}"
            continue
        all_rows.extend({"state": state, "date": d, "POP": v} for d, v in zip(res["date"], res["value"]))
    if not all_rows:
        raise RuntimeError(f"No Midwest population series loaded: {failures}")
    return {
        "label": "State Population Estimates (Midwest, FRED/Census)",
        "source": "FRED (republishing U.S. Census Bureau)",
        "rows": all_rows,
        "fetch_failures": failures,
        "states_loaded": sorted({r["state"] for r in all_rows}),
    }


async def fetch_population(client: httpx.AsyncClient) -> dict:
    try:
        return {"data": {"midwest_population": await fetch_midwest_population_fred(client)}, "failures": {}}
    except Exception as e:
        return {"data": {}, "failures": {"midwest_population": str(e)}}


# ---------------------------------------------------------------------
# Rent growth (#12): Zillow ZORI. The CSV path changes occasionally, so it is
# resolved from Zillow's research page, with ZORI_CSV_URL as a fallback.
# ---------------------------------------------------------------------
ZORI_FALLBACK_URL = os.environ.get("ZORI_CSV_URL", "")


async def resolve_zori_url(client: httpx.AsyncClient) -> str:
    try:
        resp = await client.get("https://www.zillow.com/research/data/", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        match = re.search(r'https://files\.zillowstatic\.com/research/public_csvs/zori/[^\s"\']+\.csv', resp.text)
        if match:
            return match.group(0)
    except httpx.HTTPError:
        pass   # fall through to the configured fallback
    if ZORI_FALLBACK_URL:
        return ZORI_FALLBACK_URL
    raise RuntimeError(
        "Could not locate a current ZORI CSV link on Zillow's research page and no ZORI_CSV_URL "
        "fallback is set. Copy the current link from https://www.zillow.com/research/data/ "
        "(Rentals) into ZORI_CSV_URL."
    )


async def fetch_zillow_zori(client: httpx.AsyncClient) -> dict:
    url = await resolve_zori_url(client)
    resp = await client.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(StringIO(resp.text))
    pattern = "|".join(MIDWEST_METRO_KEYWORDS)
    midwest = df[df["RegionName"].astype(str).str.contains(pattern, case=False, na=False)]
    id_cols = [c for c in midwest.columns if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(c))]
    date_cols = [c for c in midwest.columns if c not in id_cols]
    long_df = midwest.melt(id_vars=id_cols, value_vars=date_cols, var_name="date", value_name="zori")
    long_df["zori"] = pd.to_numeric(long_df["zori"], errors="coerce")
    long_df = long_df.dropna(subset=["zori"])
    return {
        "label": "Zillow Observed Rent Index (Midwest metros)", "source": "Zillow Research",
        "resolved_url": url,
        "rows": long_df[["RegionName", "date", "zori"]].to_dict("records"),
    }


async def fetch_zillow(client: httpx.AsyncClient) -> dict:
    try:
        return {"data": {"rent_growth_zori": await fetch_zillow_zori(client)}, "failures": {}}
    except Exception as e:
        return {"data": {}, "failures": {"rent_growth_zori": str(e)}}


# ---------------------------------------------------------------------
# Substitutions now in use (replaces the old MANUAL_ONLY_INDICATORS list).
# Returned with the indicators so the UI can disclose what stands in for what.
# ---------------------------------------------------------------------
SUBSTITUTIONS = {
    "midwest_pmi": {
        "replaces": "Chicago PMI (ISM-Chicago / MNI Indicators), a licensed product",
        "uses": ["cfnai_ma3"],
        "note": "Chicago Fed National Activity Index (3-month average) is a national, not Midwest-only, "
                "activity gauge. Scored on its own thresholds, not the PMI 50-line.",
    },
    "cap_rate_spread": {
        "replaces": "Sector cap rates (CBRE / JLL / Cushman & Wakefield / CoStar)",
        "uses": ["cre_price_index", "cpi_all_items", "treasury_10y"],
        "note": "Implied cap rate = anchor cap rate x (1 + CPI YoY) / (1 + CRE price YoY); spread = implied cap rate - 10-yr Treasury. "
                "Set HTC_CAP_RATE_ANCHOR to your own market cap rate.",
    },
    "vacancy": {
        "replaces": "Vacancy & absorption (CoStar / Yardi Matrix / REIS)",
        "uses": ["financial_stress_index"],
        "note": "Quarterly change in the St. Louis Fed Financial Stress Index (index points), per Methodology v2.",
    },
    "distress": {
        "replaces": "CMBS delinquencies (Trepp / Moody's CRE / CRED iQ)",
        "uses": ["cre_price_index"],
        "note": "Size of the year-over-year CRE price decline, per Methodology v2.",
    },
    "transaction_volume": {
        "replaces": "Transaction volume (RCA/MSCI, CoStar)",
        "uses": ["construction_spending"],
        "note": "Quarter-over-quarter % change in total construction spending (quarterly average), per Methodology v2.",
    },
}


# ---------------------------------------------------------------------------
# Real GDP -> HUD fiscal year
# ---------------------------------------------------------------------------
# GDPC1 is QUARTERLY, dated by the first day of the quarter. HUD (like the federal
# government) runs its fiscal year from Oct 1 to Sep 30, so
#     FY N  =  Q4 of year N-1  +  Q1, Q2, Q3 of year N
# i.e. quarter dates Oct(N-1), Jan(N), Apr(N), Jul(N).
#
# Columns added to every rental row:
#   real_gdp         average of the four quarterly levels in that fiscal year
#                    (billions of chained dollars, seasonally adjusted annual rate)
#   real_gdp_growth  % change of real_gdp vs the previous fiscal year
#
# Use real_gdp_growth, not real_gdp, as a regressor: the level trends upward just like
# rents do, so the two would look related whether or not they are.
# Only COMPLETE fiscal years (all four quarters released) get a value; the current
# fiscal year and the forecast years are null.
 
GDP_SERIES_COLUMNS = ("real_gdp", "real_gdp_growth")
NO_GDP = {c: None for c in GDP_SERIES_COLUMNS}
 
GDP_TTL_SECONDS = 24 * 60 * 60        # BEA releases quarterly; a day is plenty fresh
GDP_RETRY_AFTER_FAILURE = 5 * 60      # after a failed fetch, try again in 5 minutes
_gdp_cache = None                     # {"fetched_at", "by_year", "error"}
_gdp_lock = asyncio.Lock()            # one FRED call at a time, even with simultaneous requests
 

def real_gdp_by_fiscal_year(quarterly: pd.DataFrame) -> dict:
    q = quarterly.copy()
    q["date"] = pd.to_datetime(q["date"])
    q["fiscal_year"] = q["date"].dt.year + (q["date"].dt.month >= 10).astype(int)
 
    g = q.groupby("fiscal_year")["value"].agg(["mean", "count"])
    
    # CHANGE THIS LINE: Allow partial years to show current available data
    g = g[g["count"] >= 1]                                   
    
    if g.empty:
        return {}
 
    level = g["mean"].reindex(range(int(g.index.min()), int(g.index.max()) + 1))
    growth = level.pct_change(fill_method=None) * 100        
 
    out = {}
    for fy in g.index:
        gr = growth.loc[fy]
        out[int(fy)] = {
            "real_gdp": round(float(level.loc[fy]), 3),
            "real_gdp_growth": None if pd.isna(gr) else round(float(gr), 4),
        }
    return out

 
async def load_real_gdp_quarterly() -> pd.DataFrame:
    async with httpx.AsyncClient() as client:
        result = await fetch_real_gdp(client)
    if "real_gdp" in result["failures"]:
        raise RuntimeError(result["failures"]["real_gdp"])
    rows = result["data"]["real_gdp"]["rows"]               # [{"date": ..., "real_gdp": ...}, ...]
    return pd.DataFrame(rows).rename(columns={"real_gdp": "value"})
 
 
async def get_gdp_by_year() -> dict:
    """AWAIT this: `gdp = await get_gdp_by_year()`.
 
    Cached for a day. A failed fetch never breaks the caller: it is cached for a few minutes
    (so every request doesn't wait on a 30 s timeout) and the last good data keeps being served."""
    global _gdp_cache
 
    def fresh():
        return _gdp_cache and time.time() - _gdp_cache["fetched_at"] < GDP_TTL_SECONDS
 
    if fresh():
        return _gdp_cache
 
    async with _gdp_lock:
        if fresh():                                          # another request refreshed it while we waited
            return _gdp_cache
        now = time.time()
        try:
            by_year = real_gdp_by_fiscal_year(await load_real_gdp_quarterly())
            _gdp_cache = {"fetched_at": now, "by_year": by_year, "error": None}
        except Exception as e:
            previous = _gdp_cache["by_year"] if _gdp_cache else {}
            _gdp_cache = {
                "fetched_at": now - (GDP_TTL_SECONDS - GDP_RETRY_AFTER_FAILURE),
                "by_year": previous,
                "error": str(e),
            }
        return _gdp_cache
 
# ---------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------
async def fetch_all_indicators() -> dict:
    _check_required_keys()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        groups = await asyncio.gather(
            fetch_all_fred(client),
            fetch_all_bls(client),
            fetch_real_gdp(client),
            fetch_pce_price_index(client),
            fetch_population(client),
            fetch_zillow(client),
            return_exceptions=True,
        )

    data, failures = {}, {}
    for group in groups:
        if isinstance(group, Exception):
            failures.setdefault("_group_errors", []).append(str(group))
            continue
        data.update(group["data"])
        failures.update(group["failures"])

    return {
        "automated": data,
        "manual_required": {},            # kept for the UI: nothing needs a manual import any more
        "substitutions": SUBSTITUTIONS,
        "failures": failures,
    }

# ---------------------------------------------------------------------------
# Extended Macro Indicators (Unemployment, Interest, Inflation) -> HUD fiscal year
# ---------------------------------------------------------------------------
# UNRATE (Monthly), EFFR (Daily/Monthly), and PCEPI (Monthly) are aggregated into
# matching HUD Fiscal Years (Oct 1 to Sep 30):
#     FY N = Q4 of year N-1 (Oct, Nov, Dec) + Q1, Q2, Q3 of year N (Jan - Sep)

MACRO_SERIES_COLUMNS = (
    "unemployment_rate", "unemployment_rate_change",
    "interest_rate", "interest_rate_change",
    "inflation_rate"
)
NO_MACRO = {c: None for c in MACRO_SERIES_COLUMNS}

MACRO_TTL_SECONDS = 24 * 60 * 60       # Cache fresh for a day
MACRO_RETRY_AFTER_FAILURE = 5 * 60     # Retry trailing buffer fallback block
_macro_cache = None                    # {"fetched_at": ..., "by_year": ..., "error": ...}
_macro_lock = asyncio.Lock()           # Concurrency guard safe block


def process_macro_by_fiscal_year(unemp_df: pd.DataFrame, rate_df: pd.DataFrame, inf_df: pd.DataFrame) -> dict:
    out = {}

    def assign_hud_fiscal_year(df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"])
        df["fiscal_year"] = df["date"].dt.year + (df["date"].dt.month >= 10).astype(int)
        return df

    # --- 1. Unemployment Rate ---
    if unemp_df is not None and not unemp_df.empty:
        u = assign_hud_fiscal_year(unemp_df)
        u_g = u.groupby("fiscal_year")["value"].agg(["mean", "count"])
        
        # CHANGE THIS LINE: Allow partial entries
        u_g = u_g[u_g["count"] >= 1]
        
        u_change = u_g["mean"].diff() 
        for fy in u_g.index:
            out.setdefault(int(fy), {}).update({
                "unemployment_rate": round(float(u_g.loc[fy, "mean"]), 2),
                "unemployment_rate_change": None if pd.isna(u_change.loc[fy]) else round(float(u_change.loc[fy]), 2)
            })

    # --- 2. Interest Rate (EFFR) ---
    if rate_df is not None and not rate_df.empty:
        r = assign_hud_fiscal_year(rate_df)
        r_g = r.groupby("fiscal_year")["value"].agg(["mean", "count"])
        r_g = r_g[r_g["count"] >= 1] # Already using density buffer, keep or set to >= 1
        r_change = r_g["mean"].diff()
        for fy in r_g.index:
            out.setdefault(int(fy), {}).update({
                "interest_rate": round(float(r_g.loc[fy, "mean"]), 2),
                "interest_rate_change": None if pd.isna(r_change.loc[fy]) else round(float(r_change.loc[fy]), 2)
            })

    # --- 3. Inflation Rate (PCEPI) ---
    if inf_df is not None and not inf_df.empty:
        i = assign_hud_fiscal_year(inf_df)
        i_g = i.groupby("fiscal_year")["value"].agg(["mean", "count"])
        
        # CHANGE THIS LINE: Allow partial entries
        i_g = i_g[i_g["count"] >= 1]
        
        i_growth = i_g["mean"].pct_change() * 100
        for fy in i_g.index:
            out.setdefault(int(fy), {}).update({
                "inflation_rate": None if pd.isna(i_growth.loc[fy]) else round(float(i_growth.loc[fy]), 4)
            })

    return out


async def load_extended_macro_quarterly() -> tuple:
    """Fetches raw observations from FRED client utility endpoints concurrent blocks."""
    async with httpx.AsyncClient() as client:
        unemp_task = fetch_fred_series(client, "UNRATE")
        rate_task = fetch_fred_series(client, "EFFR")
        inf_task = fetch_fred_series(client, "PCEPI")

        unemp_df, rate_df, inf_df = await asyncio.gather(
            unemp_task, rate_task, inf_task, 
            return_exceptions=True
        )

    if isinstance(unemp_df, Exception): raise RuntimeError(f"Unemployment fetch failed: {unemp_df}")
    if isinstance(rate_df, Exception): raise RuntimeError(f"Interest rate fetch failed: {rate_df}")
    if isinstance(inf_df, Exception): raise RuntimeError(f"PCEPI inflation fetch failed: {inf_df}")

    return unemp_df, rate_df, inf_df


async def get_extended_macro_by_year() -> dict:
    """AWAIT this function to retrieve the safely throttled and cached dictionary structure."""
    global _macro_cache

    def fresh():
        return _macro_cache and time.time() - _macro_cache["fetched_at"] < MACRO_TTL_SECONDS

    if fresh():
        return _macro_cache

    async with _macro_lock:
        if fresh():
            return _macro_cache
        now = time.time()
        try:
            unemp_df, rate_df, inf_df = await load_extended_macro_quarterly()
            by_year = process_macro_by_fiscal_year(unemp_df, rate_df, inf_df)
            _macro_cache = {"fetched_at": now, "by_year": by_year, "error": None}
        except Exception as e:
            previous = _macro_cache["by_year"] if _macro_cache else {}
            _macro_cache = {
                "fetched_at": now - (MACRO_TTL_SECONDS - MACRO_RETRY_AFTER_FAILURE),
                "by_year": previous,
                "error": str(e),
            }
        return _macro_cache


# ---------------------------------------------------------------------------
# Monthly macro indicators -> joined to ZORI rows by calendar month
# ---------------------------------------------------------------------------
# Rents are monthly, so the macro values are kept monthly too. Annual (fiscal-year)
# averages leave only ~12 distinct values in the whole panel, which can't be told
# apart from the time trend in a fixed-effects model.
#
# Columns (keeps the names the /dfw-zori payload already used, plus mortgage rate):
#   unemployment_rate          UNRATE, monthly
#   unemployment_rate_change   12-month change, percentage points
#   unemployment_rate_lag_6m   value 6 months earlier (market-wide, so shifted here,
#                              not per ZIP where gaps in a ZIP's history misalign it)
#   interest_rate              FEDFUNDS, monthly average
#   interest_rate_change       12-month change, percentage points
#   mortgage_rate_30y          MORTGAGE30US, weekly -> monthly average
#   inflation_rate             PCEPI, 12-month % change

MONTHLY_MACRO_SERIES = {
    "unemployment_rate": "UNRATE",
    "interest_rate": "FEDFUNDS",
    "mortgage_rate_30y": "MORTGAGE30US",
    "pce_price_index": "PCEPI",
}
MONTHLY_MACRO_COLUMNS = (
    "unemployment_rate", "unemployment_rate_change", "unemployment_rate_lag_6m",
    "interest_rate", "interest_rate_change",
    "mortgage_rate_30y", "inflation_rate",
)
NO_MONTHLY_MACRO = {c: None for c in MONTHLY_MACRO_COLUMNS}

_monthly_macro_cache = None
_monthly_macro_lock = asyncio.Lock()


def process_monthly_macro(series: dict[str, pd.DataFrame]) -> dict:
    """series: {column_name: DataFrame[date, value]} -> {"YYYY-MM": {col: value}}"""
    monthly = {}
    for name, df in series.items():
        d = df.copy()
        d["month"] = pd.to_datetime(d["date"]).dt.to_period("M")
        monthly[name] = d.groupby("month")["value"].mean()

    m = pd.DataFrame(monthly).sort_index()
    if m.empty:
        return {}
    m = m.reindex(pd.period_range(m.index.min(), m.index.max(), freq="M"))  # no gaps before shifting

    out = pd.DataFrame(index=m.index)
    if "unemployment_rate" in m:
        out["unemployment_rate"] = m["unemployment_rate"]
        out["unemployment_rate_change"] = m["unemployment_rate"].diff(12)
        out["unemployment_rate_lag_6m"] = m["unemployment_rate"].shift(6)
    if "interest_rate" in m:
        out["interest_rate"] = m["interest_rate"]
        out["interest_rate_change"] = m["interest_rate"].diff(12)
    if "mortgage_rate_30y" in m:
        out["mortgage_rate_30y"] = m["mortgage_rate_30y"]
    if "pce_price_index" in m:
        out["inflation_rate"] = m["pce_price_index"].pct_change(12, fill_method=None) * 100

    out = out.round(4).astype(object).where(out.notna(), None)
    return {str(p): row for p, row in out.to_dict(orient="index").items()}


async def get_monthly_macro() -> dict:
    """AWAIT this: returns {"fetched_at", "by_month", "errors"}. Cached for a day; a
    series that fails to load is reported in `errors` and its columns stay null."""
    global _monthly_macro_cache

    def fresh():
        return (_monthly_macro_cache
                and time.time() - _monthly_macro_cache["fetched_at"] < MACRO_TTL_SECONDS)

    if fresh():
        return _monthly_macro_cache

    async with _monthly_macro_lock:
        if fresh():
            return _monthly_macro_cache
        now = time.time()
        names = list(MONTHLY_MACRO_SERIES)
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(
                *[fetch_fred_series(client, MONTHLY_MACRO_SERIES[n]) for n in names],
                return_exceptions=True,
            )
        loaded, errors = {}, {}
        for name, res in zip(names, results):
            if isinstance(res, Exception):
                errors[name] = str(res)
            else:
                loaded[name] = res

        if loaded:
            _monthly_macro_cache = {"fetched_at": now, "by_month": process_monthly_macro(loaded),
                                    "errors": errors}
        else:
            previous = _monthly_macro_cache["by_month"] if _monthly_macro_cache else {}
            _monthly_macro_cache = {
                "fetched_at": now - (MACRO_TTL_SECONDS - MACRO_RETRY_AFTER_FAILURE),
                "by_month": previous,
                "errors": errors,
            }
        return _monthly_macro_cache
