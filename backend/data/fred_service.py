"""
services/fred_service.py

Async service for pulling DFW metro-level macroeconomic series from FRED,
for use as a FastAPI endpoint in EconWebCast.
"""

import httpx
import pandas as pd
from io import StringIO

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

SERIES = {
    "DALL148URN": "unemployment_rate_pct",
    "DALL148NA": "total_nonfarm_employment_thousands",
    # Add a confirmed DFW building-permits series ID here once verified
    # on fred.stlouisfed.org, e.g.:
    # "SERIES_ID": "housing_permits",
}


async def _fetch_series(client: httpx.AsyncClient, series_id: str, column_name: str) -> pd.DataFrame:
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
        for series_id, col_name in SERIES.items():
            s = await _fetch_series(client, series_id, col_name)
            merged = s if merged is None else merged.merge(s, on="date", how="outer")

    return merged.sort_values("date").reset_index(drop=True)


def dataframe_to_csv_bytes(df: pd.DataFrame) -> bytes:
    buf = StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue().encode("utf-8")
