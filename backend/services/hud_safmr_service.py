"""
services/hud_safmr_service.py

HUD Small Area Fair Market Rents (SAFMR) for the DFW ZIP codes, by bedroom count and
HUD fiscal year (FY N runs Oct N-1 .. Sep N, the same fiscal_year used on the ZORI rows).

Source: HUD USER FMR API (free; public-domain U.S. government data).
  1. Get an access token at https://www.huduser.gov/portal/dataset/fmr-api.html
  2. Set HUD_API_TOKEN in the backend environment (never sent to the browser).

What SAFMR is: HUD's 40th-percentile gross rent (rent + utilities) for standard-quality
units rented by recent movers, set each year for the voucher program. It is a policy
benchmark, not a market median, so label it "HUD Fair Market Rent" in the UI.
"""
import asyncio
import json
import os
import time
from pathlib import Path

import httpx
import pandas as pd

HUD_API_TOKEN = os.environ.get("HUD_API_TOKEN", "")
HUD_FMR_URL = "https://www.huduser.gov/hudapi/public/fmr"

# HUD FMR areas covering DFW. Matched against the names HUD returns from listMetroAreas,
# so the exact HUD area codes don't have to be hard-coded.
DFW_AREA_KEYWORDS = [k.strip() for k in os.environ.get("HUD_DFW_AREAS", "Dallas,Fort Worth").split(",") if k.strip()]
DFW_STATE = "TX"

FIRST_YEAR = int(os.environ.get("HUD_SAFMR_FIRST_YEAR", "2018"))

BEDROOM_FIELDS = {
    "Efficiency": "safmr_0br",
    "One-Bedroom": "safmr_1br",
    "Two-Bedroom": "safmr_2br",
    "Three-Bedroom": "safmr_3br",
    "Four-Bedroom": "safmr_4br",
}
SAFMR_COLUMNS = list(BEDROOM_FIELDS.values())

CACHE_TTL_SECONDS = 7 * 24 * 60 * 60     # HUD publishes once a year
RETRY_AFTER_FAILURE = 10 * 60
REFETCH_RECENT_YEARS = 2                 # older fiscal years never change; only these are re-fetched
MAX_CONCURRENT_CALLS = 4                 # don't fire every HUD request at once
REQUEST_TIMEOUT = 20
# Saved copy so a server restart doesn't re-download every year from HUD
CACHE_FILE = Path(os.environ.get("HUD_SAFMR_CACHE_FILE", Path(__file__).resolve().parent.parent / "data" / "hud_safmr_cache.json"))

_cache = None                            # {"df", "failures", "fetched_at"}
_refresh_task: asyncio.Task | None = None


def current_hud_fiscal_year(today: pd.Timestamp | None = None) -> int:
    t = today or pd.Timestamp.today()
    return t.year + (1 if t.month >= 10 else 0)


def _num(v):
    try:
        return float(str(v).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
        return None


async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None):
    resp = await client.get(f"{HUD_FMR_URL}/{path}", params=params, timeout=REQUEST_TIMEOUT,
                            headers={"Authorization": f"Bearer {HUD_API_TOKEN}"})
    if resp.status_code == 401:
        raise RuntimeError("HUD API rejected the token (401). Check HUD_API_TOKEN.")
    resp.raise_for_status()
    return resp.json()


async def _dfw_areas(client: httpx.AsyncClient) -> list[dict]:
    """[{code, name}] for the HUD metro FMR areas whose names match DFW_AREA_KEYWORDS."""
    areas = await _get(client, "listMetroAreas")
    if isinstance(areas, dict):
        areas = areas.get("data", [])
    out = []
    for a in areas:
        name = str(a.get("area_name", ""))
        code = a.get("cbsa_code") or a.get("code")
        if code and f", {DFW_STATE}" in name and any(k.lower() in name.lower() for k in DFW_AREA_KEYWORDS):
            out.append({"code": code, "name": name})
    if not out:
        raise RuntimeError(f"No HUD metro FMR area matched {DFW_AREA_KEYWORDS} in {DFW_STATE}")
    return out


async def _area_year(client: httpx.AsyncClient, area: dict, year: int) -> list[dict]:
    payload = await _get(client, f"data/{area['code']}", {"year": year})
    data = payload.get("data", payload)
    basic = data.get("basicdata")
    if str(data.get("smallarea_status")) != "1" or not isinstance(basic, list):
        raise RuntimeError(f"{area['name']} FY{year}: HUD returned area-wide FMRs, not ZIP-level SAFMRs")
    rows = []
    for b in basic:
        zip_code = str(b.get("zip_code", "")).strip()
        if not zip_code.isdigit():
            continue                     # skips the "MSA level" summary row
        row = {"zip_code": zip_code.zfill(5), "fiscal_year": int(year), "hud_area": area["name"]}
        for field, col in BEDROOM_FIELDS.items():
            row[col] = _num(b.get(field))
        rows.append(row)
    return rows


async def _load(years: list[int]) -> tuple[pd.DataFrame, dict]:
    failures = {}
    sem = asyncio.Semaphore(MAX_CONCURRENT_CALLS)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        areas = await _dfw_areas(client)

        async def one(a, y):
            async with sem:
                return await _area_year(client, a, y)

        jobs = [(a, y) for a in areas for y in years]
        results = await asyncio.gather(*[one(a, y) for a, y in jobs], return_exceptions=True)
    rows = []
    for (a, y), res in zip(jobs, results):
        if isinstance(res, Exception):
            failures[f"{a['name']} FY{y}"] = str(res)
        else:
            rows.extend(res)
    df = pd.DataFrame(rows, columns=["zip_code", "fiscal_year", "hud_area", *SAFMR_COLUMNS])
    # A ZIP split between two HUD areas appears in both; keep the higher 2-BR value
    # (HUD's rule for a voucher holder in a split ZIP is the area the unit is in, which
    # the ZIP alone can't tell us).
    df = (df.sort_values("safmr_2br", ascending=False)
            .drop_duplicates(["zip_code", "fiscal_year"])
            .sort_values(["zip_code", "fiscal_year"])
            .reset_index(drop=True))
    df.attrs["hud_areas"] = [a["name"] for a in areas]
    return df, failures


EMPTY_COLUMNS = ["zip_code", "fiscal_year", "hud_area", *SAFMR_COLUMNS]


def _empty() -> pd.DataFrame:
    return pd.DataFrame(columns=EMPTY_COLUMNS)


def _read_disk() -> dict | None:
    try:
        saved = json.loads(CACHE_FILE.read_text())
        df = pd.DataFrame(saved["rows"], columns=EMPTY_COLUMNS)
        df["fiscal_year"] = df["fiscal_year"].astype(int)
        df.attrs["hud_areas"] = saved.get("hud_areas", [])
        return {"df": df, "failures": {}, "fetched_at": float(saved["fetched_at"])}
    except (OSError, ValueError, KeyError):
        return None


def _write_disk(entry: dict) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_FILE.with_suffix(".tmp")
        df = entry["df"]
        tmp.write_text(json.dumps({
            "fetched_at": entry["fetched_at"],
            "hud_areas": df.attrs.get("hud_areas", []),
            "rows": df.astype(object).where(df.notna(), None).to_dict("records"),
        }))
        tmp.replace(CACHE_FILE)          # atomic: a crash never leaves a half-written file
    except OSError as e:
        print(f"[SAFMR] could not save cache file {CACHE_FILE}: {e}")


async def _refresh() -> None:
    """Background job: fetch the years that are missing or recent, merge with what's kept."""
    global _cache
    now = time.time()
    if not HUD_API_TOKEN:
        _cache = {"df": _cache["df"] if _cache else _empty(),
                  "failures": {"hud_safmr": "HUD_API_TOKEN is not set "
                               "(free token: https://www.huduser.gov/portal/dataset/fmr-api.html)"},
                  "fetched_at": now - (CACHE_TTL_SECONDS - RETRY_AFTER_FAILURE)}
        return
    kept = _cache["df"] if _cache else _empty()
    current = current_hud_fiscal_year()
    have = set(kept["fiscal_year"].astype(int)) if not kept.empty else set()
    years = [y for y in range(FIRST_YEAR, current + 1) if y not in have or y > current - REFETCH_RECENT_YEARS]
    try:
        fresh, failures = await _load(years)
        if fresh.empty and kept.empty:
            raise RuntimeError(f"HUD returned no SAFMR rows: {failures}")
        old = kept[~kept["fiscal_year"].isin(fresh["fiscal_year"].unique())] if not fresh.empty else kept
        df = pd.concat([old, fresh], ignore_index=True).sort_values(["zip_code", "fiscal_year"]).reset_index(drop=True)
        df.attrs["hud_areas"] = fresh.attrs.get("hud_areas") or kept.attrs.get("hud_areas", [])
        _cache = {"df": df, "failures": failures, "fetched_at": now}
        if not failures:
            _write_disk(_cache)
    except Exception as e:
        _cache = {"df": kept, "failures": {"hud_safmr": str(e)},
                  "fetched_at": now - (CACHE_TTL_SECONDS - RETRY_AFTER_FAILURE)}


def start_safmr_refresh() -> None:
    """Start a background refresh if the data is missing or stale and none is running.
    Call it once at server startup to warm the cache (see main.py)."""
    global _cache, _refresh_task
    if _cache is None:
        _cache = _read_disk()            # instant: last saved copy, even if a week old
    stale = _cache is None or time.time() - _cache["fetched_at"] >= CACHE_TTL_SECONDS
    running = _refresh_task is not None and not _refresh_task.done()
    if stale and not running:
        _refresh_task = asyncio.get_running_loop().create_task(_refresh())


async def get_dfw_safmr(wait_seconds: float = 0) -> dict:
    """AWAIT this. Returns {"df", "failures", "fetched_at"} right away from memory or the saved
    file; HUD is only contacted in the background. With wait_seconds > 0 it waits up to that
    long for a running refresh (used by /dfw-safmr). Never raises."""
    start_safmr_refresh()
    if wait_seconds and _refresh_task is not None and not _refresh_task.done():
        try:
            await asyncio.wait_for(asyncio.shield(_refresh_task), timeout=wait_seconds)
        except asyncio.TimeoutError:
            pass
    if _cache is None:
        return {"df": _empty(), "fetched_at": None,
                "failures": {"hud_safmr_loading": "HUD Fair Market Rents are loading in the background; refresh in a minute."}}
    return _cache


def latest_safmr_by_zip(df: pd.DataFrame) -> pd.DataFrame:
    """One row per ZIP: the most recent fiscal year's SAFMRs, plus the 1-year change in 2-BR."""
    if df.empty:
        return pd.DataFrame(columns=["zip_code", "safmr_fiscal_year", *SAFMR_COLUMNS, "safmr_2br_yoy_pct"])
    d = df.sort_values(["zip_code", "fiscal_year"])
    d["safmr_2br_yoy_pct"] = d.groupby("zip_code")["safmr_2br"].pct_change(fill_method=None) * 100
    latest = d.groupby("zip_code").tail(1)
    return latest.rename(columns={"fiscal_year": "safmr_fiscal_year"})[
        ["zip_code", "safmr_fiscal_year", *SAFMR_COLUMNS, "safmr_2br_yoy_pct"]
    ].reset_index(drop=True)
