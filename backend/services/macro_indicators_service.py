
"""
7. Midwest PMI (Chicago PMI) : does not exists any more
"""
import os
import re
import io
import asyncio
from io import StringIO

import httpx
import pandas as pd
from bs4 import BeautifulSoup


from dotenv import load_dotenv
load_dotenv()  # This loads the variables from your .env file


FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
BEA_API_KEY = os.environ.get("BEA_API_KEY", "")
BLS_API_KEY = os.environ.get("BLS_API_KEY", "")
CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "")

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; HTC-DataBot/1.0)"}

MIDWEST_STATE_FIPS = {
    "17": "Illinois", "18": "Indiana", "19": "Iowa", "20": "Kansas",
    "26": "Michigan", "27": "Minnesota", "29": "Missouri", "31": "Nebraska",
    "38": "North Dakota", "39": "Ohio", "46": "South Dakota", "55": "Wisconsin",
}
MIDWEST_METRO_KEYWORDS = [
    "Chicago", "Detroit", "Minneapolis", "St. Louis", "Kansas City",
    "Columbus", "Indianapolis", "Cincinnati", "Cleveland", "Milwaukee",
    "Omaha", "Des Moines",
]


def _check_required_keys():
    """Fail loudly and specifically instead of sending empty api_key= params."""
    missing = []
    if not FRED_API_KEY:
        missing.append("FRED_API_KEY (https://fred.stlouisfed.org/docs/api/api_key.html)")
    if not BEA_API_KEY:
        missing.append("BEA_API_KEY (https://apps.bea.gov/api/signup/)")
    if missing:
        raise RuntimeError(
            "Missing required environment variables:\n  - " + "\n  - ".join(missing) +
            "\nSet these before starting the server (check your .env is actually being loaded)."
        )


# ---------------------------------------------------------------------
# FRED
# ---------------------------------------------------------------------
FRED_SERIES = {
    "fed_funds_rate":        ("EFFR", "Federal Funds Rate (Effective)"),
    "treasury_10y":          ("DGS10", "10-Year Treasury Yield"),
    "unemployment_rate":     ("UNRATE", "Unemployment Rate"),
    "jolts_job_openings":    ("JTSJOL", "JOLTS Job Openings"),
    "avg_hourly_earnings":   ("CES0500000003", "Average Hourly Earnings, Total Private (wage proxy)"),
    "cre_price_index":       ("COMREPUSQ159N", "Commercial Real Estate Price Index, US (Fed CRE proxy)"),
    "rental_vacancy_rate":   ("RRVRUSQ156N", "Rental Vacancy Rate (Census, via FRED)"),
    "financial_stress_index": ("STLFSI4", "St. Louis Fed Financial Stress Index"),
    "construction_spending": ("TTLCONS", "Total Construction Spending"),
     "consumer_sentiment_umcsent": ("UMCSENT", "Consumer Sentiment — University of Michigan (CCI proxy; NOT Conference Board CCI — different scale, see note)"),
    "cre_delinquency_rate":       ("DRCRELEXFACBS", "CRE Loan Delinquency Rate, All Commercial Banks (Distress indicator)"),
    "mortgage_rate_30y":          ("MORTGAGE30US", "30-Year Fixed Mortgage Rate"),
    # Chicago PMI removed: it's licensed by ISM-Chicago/MNI Indicators,
    # not freely published on FRED. Moved to MANUAL_ONLY_INDICATORS below.
}

async def fetch_fred_series(client: httpx.AsyncClient, series_id: str) -> pd.DataFrame:
    resp = await client.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={"series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json"},
        timeout=30,
    )
    resp.raise_for_status()
    obs = resp.json()["observations"]
    df = pd.DataFrame(obs)[["date", "value"]]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"])

async def fetch_all_fred(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    keys = list(FRED_SERIES.keys())
    fetched = await asyncio.gather(
        *[fetch_fred_series(client, FRED_SERIES[k][0]) for k in keys],
        return_exceptions=True,
    )
    for key, res in zip(keys, fetched):
        series_id, label = FRED_SERIES[key]
        if isinstance(res, Exception):
            failures[key] = str(res)
        else:
            results[key] = {
                "label": label, "series_id": series_id, "source": "FRED",
                "rows": res.rename(columns={"value": key}).to_dict("records"),
            }
    return {"data": results, "failures": failures}


# ---------------------------------------------------------------------
# BLS — CPI only (avg_weekly_wages moved to FRED avg_hourly_earnings
# above, since ENU0000000010 is not a complete/valid QCEW series ID —
# real QCEW IDs are 20 characters encoding area+ownership+industry+type.
# Tell me the exact area/industry slice you want and I'll build the
# correct ID if you need true QCEW data instead of this proxy.)
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
        raise RuntimeError(f"BLS returned zero observations for series '{series_id}' — check the series ID")
    df = pd.DataFrame(rows)[["year", "period", "value"]]
    df = df[df["period"].str.startswith("M")]
    df["month"] = df["period"].str.replace("M", "", regex=False).str.zfill(2)
    df["date"] = df["year"] + "-" + df["month"] + "-01"
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
# BEA
# ---------------------------------------------------------------------
BEA_TABLES = {
    "pce_price_index": ("T20804", "M", "PCE Price Index"),
    "real_gdp":        ("T10101", "Q", "Real GDP"),
}

import asyncio
import httpx
import pandas as pd

FRED_URL = "https://stlouisfed.org"
async def fetch_bea_table(client: httpx.AsyncClient, table_name: str, frequency: str) -> pd.DataFrame:
    resp = await client.get(
        FRED_URL,
        params={
            "api_key": FRED_API_KEY,
            "file_type": "json",
            "series_id": table_name,
        },
        timeout=30,
    )
    
    # 1. ALWAYS check for HTTP errors first before parsing JSON
    resp.raise_for_status()

    # 2. Safely print and read the payload now that we know it's a 200 OK response
    payload = resp.json()
    print(payload, 'wwwww', resp)

    rows = payload.get("observations", [])
    print(rows, '4444444')
    
    df = pd.DataFrame(rows)[["date", "value"]]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna()


async def fetch_all_bea(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    for key, (table, freq, label) in BEA_TABLES.items():
        try:
            df = await fetch_bea_table(client, table, freq)
            results[key] = {
                "label": label, "table": table, "source": "BEA",
                "rows": df.rename(columns={"value": key}).to_dict("records"),
            }
        except Exception as e:
            failures[key] = str(e)
    return {"data": results, "failures": failures}


# ---------------------------------------------------------------------
# Census — population pinned to vintage 2021 (last vintage where the
# plain NAME,POP/state:* query works; 2022+ moved to pep/charv, which
# requires extra required predicates). Building permits: the JSON API
# path used in the original doc (api.census.gov/data/{year}/bps) does
# not appear to exist — BPS is distributed as flat CSV/ASCII files from
# census.gov/construction/bps instead, so this is disabled pending a
# decision on which file/geography level to pull.
# ---------------------------------------------------------------------
async def fetch_census_population(client: httpx.AsyncClient, vintage: int = 2023, year: int = 2023) -> pd.DataFrame:
    """
    As of vintage 2022+, Census discontinued the simple pep/population
    dataset (confirmed: /data/2022/pep/population and /data/2023/pep/population
    do not exist) in favor of pep/charv.

    Verified working pattern (against a public confirmed-working query):
        https://api.census.gov/data/2023/pep/charv?get=NAME,POP,MEDAGE&for=state:*&YEAR=2021

    `vintage` selects which dataset release to query (the URL path year);
    `year` selects which year WITHIN that release's time series to return
    (its own time series runs from the last census through the vintage
    year). No API key is required for this dataset.
    """
    params = {
        "get": "NAME,POP",
        "for": "state:*",
        "YEAR": str(year),
    }
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY

    resp = await client.get(f"https://api.census.gov/data/{vintage}/pep/charv", params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["POP"] = pd.to_numeric(df["POP"], errors="coerce")
    return df[df["state"].isin(MIDWEST_STATE_FIPS)]


async def fetch_census_population_two_years(
    client: httpx.AsyncClient, vintage: int = 2023, year_a: int = 2022, year_b: int = 2023
) -> pd.DataFrame:
    """
    Pulls two years from the SAME vintage release and combines them, so a
    real YoY migration % can finally be computed for the Cycle Score
    'migration' indicator (previously excluded entirely -- only one
    vintage was ever fetched, so no change could be calculated).
    """
    df_a = await fetch_census_population(client, vintage=vintage, year=year_a)
    df_b = await fetch_census_population(client, vintage=vintage, year=year_b)
    df_a = df_a.rename(columns={"POP": f"POP_{year_a}"})
    df_b = df_b.rename(columns={"POP": f"POP_{year_b}"})
    merged = df_a.merge(df_b[["state", f"POP_{year_b}"]], on="state")
    merged["yoy_pct_change"] = (
        (merged[f"POP_{year_b}"] - merged[f"POP_{year_a}"]) / merged[f"POP_{year_a}"] * 100
    )
    return merged
MIDWEST_STATE_POP_SERIES = {
    "IL": "ILPOP", "IN": "INPOP", "IA": "IAPOP", "KS": "KSPOP",
    "MI": "MIPOP", "MN": "MNPOP", "MO": "MOPOP", "NE": "NEPOP",
    "ND": "NDPOP", "OH": "OHPOP", "SD": "SDPOP", "WI": "WIPOP",
}

async def fetch_midwest_population_fred(client: httpx.AsyncClient) -> dict:
    """
    Replaces the Census pep/charv approach entirely. FRED republishes
    Census's own state population estimates as simple annual series
    (confirmed: ILPOP, MIPOP both return clean data through 2025) --
    no DATE_CODE guessing, no demographic-breakdown predicates, and it
    reuses the same fetch_fred_series() already used for every other
    FRED-sourced indicator in this file.
    """
    tasks = [fetch_fred_series(client, series_id) for series_id in MIDWEST_STATE_POP_SERIES.values()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_rows = []
    failures = {}
    for (state, series_id), res in zip(MIDWEST_STATE_POP_SERIES.items(), results):
        if isinstance(res, Exception):
            failures[state] = str(res)
            continue
        for _, row in res.iterrows():
            all_rows.append({"state": state, "date": row["date"], "POP": row["value"]})

    return {
        "label": "State Population Estimates (Midwest, FRED/Census)",
        "source": "FRED (republishing U.S. Census Bureau)",
        "rows": all_rows,
        "fetch_failures": failures,
    }

async def fetch_all_census(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    try:
        pop = await fetch_midwest_population_fred(client)
        results["midwest_population"] = pop
    except Exception as e:
        failures["midwest_population"] = str(e)

    try:
        permits = await fetch_state_permits(client)
        results["building_permits"] = {
            "label": "Building Permits, Units Authorized (Midwest states)", "source": "Census BPS",
            "rows": permits.to_dict("records"),
        }
    except Exception as e:
        failures["building_permits"] = str(e)

    return {"data": results, "failures": failures}

# Census BPS state-level data: since Nov 2019, Census publishes these as
# individual monthly Excel files browsable from a listing page, not a
# single stable JSON/CSV endpoint. This resolver finds the most recent
# file link from that page, same pattern used for Zillow's ZORI above.
async def resolve_latest_state_permits_url(client: httpx.AsyncClient) -> str:
    resp = await client.get(
        "https://www.census.gov/construction/bps/statemonthly.html",
        headers=HEADERS, timeout=30,
    )
    resp.raise_for_status()
    # Files are legacy .xls (not .xlsx), served as absolute URLs like
    # https://www.census.gov/construction/bps/xls/statemonthly_202608.xls
    matches = re.findall(r'href="(https://www\.census\.gov/construction/bps/xls/statemonthly_\d{6}\.xls)"', resp.text)
    if not matches:
        raise RuntimeError(
            "Could not find any statemonthly_*.xls links on the Census state-permits page. "
            "The page layout may have changed — check "
            "https://www.census.gov/construction/bps/statemonthly.html manually."
        )
    return matches[0]  # first match is the most recent month listed

async def fetch_state_permits(client: httpx.AsyncClient) -> pd.DataFrame:
    url = await resolve_latest_state_permits_url(client)
    resp = await client.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()

    # Legacy .xls format needs the xlrd engine, not openpyxl (which only
    # reads .xlsx). pip install xlrd --break-system-packages if missing.
    df = pd.read_excel(io.BytesIO(resp.content), engine="xlrd")
    state_col = next((c for c in df.columns if "state" in str(c).lower()), None)
    if state_col is None:
        raise RuntimeError(f"Could not find a state column. Columns found: {list(df.columns)}")

    midwest_names = set(MIDWEST_STATE_FIPS.values())
    filtered = df[df[state_col].astype(str).isin(midwest_names)].copy()
    filtered["source_file"] = url
    return filtered


# ---------------------------------------------------------------------
# SLOOS — URL corrected (Fed dropped the /sloos/ subfolder) and
# redirects are now followed via the shared client config below.
# ---------------------------------------------------------------------
async def fetch_sloos_summary(client: httpx.AsyncClient) -> dict:
    # 1. Correct URL endpoint to the actual landing page
    url = "https://federalreserve.gov"
    
    resp = await client.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    
    # 2. Use BeautifulSoup to strip HTML safely 
    # (Regex like <[^>]+> leaves behind JavaScript and CSS text blocks)
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # Remove script and style elements completely
    for element in soup(["script", "style"]):
        element.extract()
        
    # Extract clean text and normalize whitespace
    text = soup.get_text(separator=" ")
    text = re.sub(r"\s+", " ", text).strip()
    
    # 3. Fixed keyword counts using NON-CAPTURING groups (?:...)
    # Original re.findall() returns list of captured groups [('ed',), ('ing',)] instead of full words.
    tightened_count = len(re.findall(r"\btighten(?:ed|ing)?\b", text, re.IGNORECASE))
    eased_count = len(re.findall(r"\beas(?:ed|ing)?\b", text, re.IGNORECASE))
    
    return {
        "label": "Senior Loan Officer Opinion Survey (SLOOS)", 
        "source": "Federal Reserve",
        "url_scraped": url,
        "raw_text_excerpt": text[:2000],
        "keyword_counts": {
            "tightened_mentions": tightened_count, 
            "eased_mentions": eased_count
        },
        "note": "Keyword count only — full sentiment parsing is a later step per the source doc.",
    }



# ---------------------------------------------------------------------
# Zillow ZORI — Zillow's own site states CSV paths change occasionally.
# Rather than hardcoding a filename that will go stale again, resolve
# the current link from their research data page first.
# ---------------------------------------------------------------------
ZORI_FALLBACK_URL = os.environ.get("ZORI_CSV_URL", "")

async def resolve_zori_url(client: httpx.AsyncClient) -> str:
    resp = await client.get("https://www.zillow.com/research/data/", headers=HEADERS, timeout=30)
    resp.raise_for_status()
    match = re.search(r'https://files\.zillowstatic\.com/research/public_csvs/zori/[^\s"\']+\.csv', resp.text)
    if match:
        return match.group(0)
    if ZORI_FALLBACK_URL:
        return ZORI_FALLBACK_URL
    raise RuntimeError(
        "Could not locate a current ZORI CSV link on Zillow's research data page, and no "
        "ZORI_CSV_URL fallback is set. Grab the current link manually from "
        "https://www.zillow.com/research/data/ (under Rentals) and set it as ZORI_CSV_URL."
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
# Manual-import indicators (unchanged — no API exists for these)
# ---------------------------------------------------------------------
MANUAL_ONLY_INDICATORS = {
    "chicago_pmi_licensed": {
        "label": "Chicago PMI (ISM-Chicago / MNI Indicators)",
        "reason": "Licensed data product — not freely republished on FRED or elsewhere, same as the national ISM Manufacturing Index.",
        "free_substitute_keys": ["construction_spending", "jolts_job_openings"],
    },
    "cap_rates_by_sector_proprietary": {
        "label": "Cap Rates by Sector — Office/Retail/Industrial (CBRE / JLL / Cushman & Wakefield / CoStar)",
        "reason": "Proprietary market intelligence — no free API. Only an aggregate (not sector-specific) CRE price index is freely available.",
        "free_substitute_keys": ["cre_price_index"],
    },
    "vacancy_absorption_proprietary": {
        "label": "Vacancy & Absorption (CoStar / Yardi Matrix / REIS)",
        "reason": "Core CRE analytics data is paywalled.",
        "free_substitute_keys": ["rental_vacancy_rate"],
    },
    "distress_proprietary": {
        "label": "CMBS Delinquencies (Trepp / Moody's CRE / CRED iQ)",
        "reason": "Loan-level CMBS data is proprietary and expensive.",
        "free_substitute_keys": ["financial_stress_index"],
    },
    "transactions_proprietary": {
        "label": "Transaction Volume & Price Trends (RCA/MSCI, CoStar)",
        "reason": "Sales comps and transaction volumes are proprietary.",
        "free_substitute_keys": ["construction_spending", "cre_price_index"],
    },
}

async def fetch_pce_price_index(client: httpx.AsyncClient) -> dict:
    """Fetches only the PCE Price Index data using the working FRED function."""
    results, failures = {}, {}
    try:
        # Pass the working function your client and series ID
        df = await fetch_fred_series(client, "PCEPI")
        
        results["pce_price_index"] = {
            "label": "PCE Price Index",
            "table": "T20804",
            "source": "BEA",
            "rows": df.rename(columns={"value": "pce_price_index"}).to_dict("records"),
        }
    except Exception as e:
        failures["pce_price_index"] = str(e)
        
    return {"data": results, "failures": failures}


async def fetch_real_gdp(client: httpx.AsyncClient) -> dict:
    """Fetches only the Real GDP data using the working FRED function."""
    results, failures = {}, {}
    try:
        # Pass the working function your client and series ID
        df = await fetch_fred_series(client, "GDPC1")
        results["real_gdp"] = {
            "label": "Real GDP",
            "table": "T10101",
            "source": "BEA",
            "rows": df.rename(columns={"value": "real_gdp"}).to_dict("records"),
        }
    except Exception as e:
        failures["real_gdp"] = str(e)    
         
    return {"data": results, "failures": failures}


# New imports needed at the top of the router module (keep your existing ones)
import asyncio
import time
 
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
 
async def fetch_midwest_pmi(client: httpx.AsyncClient) -> dict:
    """
    Fetches the Midwest PMI (Chicago PMI) data.
    Series ID: CHPMI
    Frequency: Monthly
    """
    results, failures = {}, {}
    try:
        # Fetching directly from your working FRED helper
        df = await fetch_fred_series(client, "CHPMI")
        
        results["midwest_pmi"] = {
            "label": "Midwest PMI (Chicago)",
            "table": "CHPMI",
            "source": "ISM Chicago via FRED",
            "rows": df.rename(columns={"value": "midwest_pmi"}).to_dict("records"),
        }
    except Exception as e:
        failures["midwest_pmi"] = str(e)    
         
    return {"data": results, "failures": failures}

# ---------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------
async def fetch_all_indicators() -> dict:
    _check_required_keys()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        # ADDED 'pce' variable here to make exactly 7 variables
        fred, bls, gdp, pce, census, zillow, sloos_result = await asyncio.gather(
            fetch_all_fred(client),
            fetch_all_bls(client),
            fetch_real_gdp(client),        # Task 3
            fetch_pce_price_index(client), # Task 4
            fetch_all_census(client),
            fetch_zillow(client),
            fetch_sloos_summary(client),
            return_exceptions=True,
        )

    data, failures = {}, {}
    # UPDATED: Included both 'gdp' and 'pce' in the loop tuple
    for group in (fred, bls, gdp, pce, census, zillow):
        if isinstance(group, Exception):
            failures["_group_error"] = str(group)
            continue
        data.update(group["data"])
        failures.update(group["failures"])

    if isinstance(sloos_result, Exception):
        failures["credit_conditions_sloos"] = str(sloos_result)
    else:
        data["credit_conditions_sloos"] = sloos_result

    return {
        "automated": data,
        "manual_required": MANUAL_ONLY_INDICATORS,
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
