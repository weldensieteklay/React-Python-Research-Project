
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
    # Corrected label: this is the Fed's aggregate CRE price index, not a
    # multifamily-specific cap rate. Sector-specific variants (office,
    # retail, industrial) do not appear to exist as FRED series and were
    # incorrectly included in an earlier version of this file — removed.
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

async def fetch_bea_table(client: httpx.AsyncClient, table_name: str, frequency: str) -> pd.DataFrame:
    resp = await client.get(
        "https://apps.bea.gov/api/data",
        params={
            "UserID": BEA_API_KEY, "method": "GetData", "datasetname": "NIPA",
            "TableName": table_name, "Frequency": frequency, "Year": "ALL",
            "ResultFormat": "JSON",
        },
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    results = payload.get("BEAAPI", {}).get("Results", {})
    if "Error" in results:
        raise RuntimeError(f"BEA API error: {results['Error'].get('APIErrorDescription')}")
    rows = results["Data"]
    df = pd.DataFrame(rows)[["TimePeriod", "DataValue"]]
    df["DataValue"] = pd.to_numeric(df["DataValue"].str.replace(",", ""), errors="coerce")
    return df.rename(columns={"TimePeriod": "date", "DataValue": "value"}).dropna()

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
async def fetch_census_population(client: httpx.AsyncClient) -> pd.DataFrame:
    # Vintage 2021 uses year-stamped variable names (POP_2021), not a
    # generic "POP" column like earlier vintages (e.g. 2019) did.
    params = {"get": "NAME,POP_2021", "for": "state:*"}
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY
    resp = await client.get("https://api.census.gov/data/2021/pep/population", params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df = df.rename(columns={"POP_2021": "POP"})
    df["POP"] = pd.to_numeric(df["POP"], errors="coerce")
    return df[df["state"].isin(MIDWEST_STATE_FIPS)]

async def fetch_all_census(client: httpx.AsyncClient) -> dict:
    results, failures = {}, {}
    try:
        pop = await fetch_census_population(client)
        results["midwest_population"] = {
            "label": "State Population Estimates (Midwest, 2021 vintage)", "source": "Census PEP",
            "rows": pop.to_dict("records"),
        }
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


# ---------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------
async def fetch_all_indicators() -> dict:
    _check_required_keys()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        fred, bls, bea, census, zillow, sloos_result = await asyncio.gather(
            fetch_all_fred(client),
            fetch_all_bls(client),
            fetch_all_bea(client),
            fetch_all_census(client),
            fetch_zillow(client),
            fetch_sloos_summary(client),
            return_exceptions=True,
        )

    data, failures = {}, {}
    for group in (fred, bls, bea, census, zillow):
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
