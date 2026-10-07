"""
services/cycle_score_transform.py

Bridges fetch_all_indicators()'s raw {date, value} rows to the derived
values (deltas, YoY%, QoQ%, ratios) that cycle_score_service's scorers
expect. Called from the /macro-indicators route, not a separate one.
"""
import re
from datetime import datetime, timedelta
import statistics
from services import cycle_score_service as cs
import pandas as pd


def _parse_date(date_str: str) -> datetime:
    """Handles the date formats actually seen across sources:
      - ISO:        '2026-09-01'
      - BEA quarter: '2026Q2'   -> treated as the quarter's first month
      - BEA month:   '2026M01'  -> treated as that month's 1st
    Raises ValueError (caller's problem to handle) for anything else,
    rather than silently misparsing."""
    s = str(date_str).strip()

    m = re.fullmatch(r"(\d{4})Q([1-4])", s)
    if m:
        year, q = int(m.group(1)), int(m.group(2))
        month = (q - 1) * 3 + 1
        return datetime(year, month, 1)

    m = re.fullmatch(r"(\d{4})M(\d{2})", s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        return datetime(year, month, 1)

    # fall back to ISO (handles '2026-09-01' and '2026-09-01T00:00:00' etc.)
    return datetime.fromisoformat(s[:10])


def _rows_sorted(indicator: dict, value_key: str) -> list[dict]:
    rows = indicator.get("rows", [])
    try:
        return sorted(rows, key=lambda r: _parse_date(r["date"]))
    except (KeyError, ValueError):
        return rows  # no usable date — assume input order is already chronological


def _latest(indicator: dict, value_key: str):
    rows = _rows_sorted(indicator, value_key)
    return rows[-1][value_key] if rows else None


def _value_near_days_ago(indicator: dict, value_key: str, days: int):
    """Finds the observation closest to `days` ago from the latest date."""
    rows = _rows_sorted(indicator, value_key)
    if not rows:
        return None
    try:
        latest_date = _parse_date(rows[-1]["date"])
        target = latest_date - timedelta(days=days)
        closest = min(rows, key=lambda r: abs(_parse_date(r["date"]) - target))
        return closest[value_key]
    except (KeyError, ValueError):
        return None


def _pct_change_vs_days_ago(indicator: dict, value_key: str, days: int):
    latest = _latest(indicator, value_key)
    past = _value_near_days_ago(indicator, value_key, days)
    if latest is None or past in (None, 0):
        return None
    return (latest - past) / past * 100


def _delta_vs_days_ago(indicator: dict, value_key: str, days: int):
    latest = _latest(indicator, value_key)
    past = _value_near_days_ago(indicator, value_key, days)
    if latest is None or past is None:
        return None
    return latest - past


def _ratio_to_historical_avg(indicator: dict, value_key: str, lookback_years: int = 10):
    """Ratio of the most recent observation to the historical average.
    Falls back to list order (last element = most recent) if rows lack
    a 'date' field, since the permits data's exact schema can vary by
    source (JSON API vs. scraped Excel)."""
    rows = indicator.get("rows", [])
    if not rows:
        return None
    try:
        rows = sorted(rows, key=lambda r: r["date"])
    except KeyError:
        pass  # no date field — assume input order is already chronological

    values = [r[value_key] for r in rows if r.get(value_key) is not None]
    if not values:
        return None
    latest = values[-1]
    avg = statistics.mean(values[-min(len(values), lookback_years * 12):])
    return latest / avg if avg else None


def compute_indicator_scores(automated: dict) -> list[cs.IndicatorScore]:
    scores: list[cs.IndicatorScore] = []

    def add(key, label, available, raw_value=None, score=None, note=None):
        scores.append(cs.IndicatorScore(key=key, label=label, raw_value=raw_value,
                                         score=score, available=available, note=note))

    # 1. Fed Funds Rate Trend (90-day delta)
    if "fed_funds_rate" in automated:
        delta = _delta_vs_days_ago(automated["fed_funds_rate"], "fed_funds_rate", 90)
        add("fed_funds_trend", "Federal Funds Rate Trend", delta is not None,
            raw_value=delta, score=cs.score_fed_funds_trend(delta) if delta is not None else None)
    else:
        add("fed_funds_trend", "Federal Funds Rate Trend", False, note="Source data unavailable")

    # 2. Inflation (CPI YoY)
    if "cpi_all_items" in automated:
        yoy = _pct_change_vs_days_ago(automated["cpi_all_items"], "cpi_all_items", 365)
        add("cpi_yoy", "Inflation (CPI YoY)", yoy is not None,
            raw_value=yoy, score=cs.score_cpi_yoy(yoy) if yoy is not None else None)
    else:
        add("cpi_yoy", "Inflation (CPI YoY)", False, note="Source data unavailable")

    # 3. 10-Year Treasury Yield (latest)
    if "treasury_10y" in automated:
        latest = _latest(automated["treasury_10y"], "treasury_10y")
        add("treasury_10y", "10-Year Treasury Yield", latest is not None,
            raw_value=latest, score=cs.score_treasury_10y(latest) if latest is not None else None)
    else:
        add("treasury_10y", "10-Year Treasury Yield", False, note="Source data unavailable")

    # 4. Credit Conditions (SLOOS) — EXCLUDED: current fetcher only returns
    # keyword counts, not the real net-%-tightening classification the
    # methodology requires. Flagging as a gap rather than guessing.
    add("credit_conditions_sloos", "Credit Conditions (SLOOS)", False,
        note="Current SLOOS fetcher returns raw keyword counts, not a validated tightened/eased classification per the methodology's definition. Needs real parsing of the SLOOS release's net % figures before this can be scored.")

    # 5. GDP Growth (QoQ)
    if "real_gdp" in automated:
        qoq = _pct_change_vs_days_ago(automated["real_gdp"], "real_gdp", 90)
        add("gdp_growth", "GDP Growth (QoQ)", qoq is not None,
            raw_value=qoq, score=cs.score_gdp_growth(qoq) if qoq is not None else None)
    else:
        add("gdp_growth", "GDP Growth (QoQ)", False, note="Source data unavailable (BEA key likely not yet activated)")

    # 6. Labor Market Strength (unemployment trend + JOLTS level, simplified)
    if "unemployment_rate" in automated and "jolts_job_openings" in automated:
        u_delta = _delta_vs_days_ago(automated["unemployment_rate"], "unemployment_rate", 90)
        jolts_latest = _latest(automated["jolts_job_openings"], "jolts_job_openings")
        jolts_rows = _rows_sorted(automated["jolts_job_openings"], "jolts_job_openings")
        jolts_values = [r["jolts_job_openings"] for r in jolts_rows if r["jolts_job_openings"] is not None]
        jolts_median = statistics.median(jolts_values) if jolts_values else None

        if u_delta is None or jolts_latest is None or jolts_median is None:
            add("labor_market", "Labor Market Strength", False, note="Insufficient history to compute trend")
        else:
            u_trend = "rising_fast" if u_delta >= 0.5 else "rising" if u_delta > 0.1 else "falling" if u_delta < -0.1 else "flat"
            jolts_strength = "very_strong" if jolts_latest > jolts_median * 1.2 else "strong" if jolts_latest > jolts_median else "weak"
            score = cs.score_labor_market(u_trend, jolts_strength)
            add("labor_market", "Labor Market Strength", True,
                raw_value={"unemployment_delta_90d": u_delta, "jolts_latest": jolts_latest}, score=score)
    else:
        add("labor_market", "Labor Market Strength", False, note="Source data unavailable")

    # 7. Midwest PMI — EXCLUDED (confirmed no free source exists)
    add("midwest_pmi", "Midwest PMI (Chicago Business Barometer)", False,
        note=cs.MISSING_INDICATORS["midwest_pmi"])

    # 8. Migration (YoY % change, Midwest total population, summed across
    # states). Source switched from Census pep/charv to FRED's per-state
    # population series (e.g. ILPOP, MIPOP), which publish continuous
    # annual history through the present -- no more single-vintage
    # staleness, and a real YoY change can finally be computed here.
    if "midwest_population" in automated:
        pop_rows = automated["midwest_population"]["rows"]
        by_date = {}
        for r in pop_rows:
            by_date.setdefault(r["date"], 0)
            by_date[r["date"]] += r["POP"] or 0

        sorted_dates = sorted(by_date.keys())
        if len(sorted_dates) >= 2:
            latest_date = sorted_dates[-1]
            latest_total = by_date[latest_date]

            # find the observation closest to 365 days before the latest date
            latest_dt = _parse_date(latest_date)
            target = latest_dt - timedelta(days=365)
            prior_date = min(sorted_dates[:-1], key=lambda d: abs(_parse_date(d) - target))
            prior_total = by_date[prior_date]

            yoy_pct = (latest_total - prior_total) / prior_total * 100 if prior_total else None
            add("migration", "Migration (Annual Population Change, Midwest total)", yoy_pct is not None,
                raw_value=yoy_pct, score=cs.score_migration(yoy_pct) if yoy_pct is not None else None)
        else:
            add("migration", "Migration (Annual Population Change)", False,
                note="Insufficient history to compute YoY change")
    else:
        add("migration", "Migration (Annual Population Change)", False, note="Source data unavailable")

    # 9. Wage Growth (QoQ, from avg hourly earnings as proxy)
    if "avg_hourly_earnings" in automated:
        qoq = _pct_change_vs_days_ago(automated["avg_hourly_earnings"], "avg_hourly_earnings", 90)
        add("wage_growth", "Wage Growth (QoQ, hourly earnings proxy)", qoq is not None,
            raw_value=qoq, score=cs.score_wage_growth(qoq) if qoq is not None else None,
            note=None if qoq is not None else "Insufficient history")
    else:
        add("wage_growth", "Wage Growth", False, note="Source data unavailable")

    # 10. Construction Pipeline (spending vs historical average)
        # 10. Construction Pipeline (spending vs historical average)
    if "construction_spending" in automated:
        spending_data = automated["construction_spending"]

        # Normalize to a DataFrame (handles DataFrame or {"rows": [...]} payloads)
        if isinstance(spending_data, pd.DataFrame):
            df = spending_data.copy()
        else:
            df = pd.DataFrame(spending_data.get("rows", []))

        # Normalize the value column name
        if "construction_spending" in df.columns:
            df = df.rename(columns={"construction_spending": "value"})

        ratio = None
        note = None

        if df.empty or "value" not in df.columns:
            note = f"No 'value' column found. Columns: {list(df.columns)}"
        else:
            # Coerce to numeric so strings / "." / None don't break statistics.mean
            df["value"] = pd.to_numeric(df["value"], errors="coerce")
            df = df.dropna(subset=["value"])

            # Rebuild the dict-with-rows shape the helper expects
            payload = {"rows": df.to_dict("records")}
            ratio = _ratio_to_historical_avg(payload, "value")

            if ratio is None:
                note = "Could not compute ratio to historical average"

        add("construction_pipeline", "Construction Pipeline", ratio is not None,
            raw_value=ratio,
            score=cs.score_construction_pipeline(ratio) if ratio is not None else None,
            note=note)
    else:
        add("construction_pipeline", "Construction Pipeline", False,
            note="Source data unavailable")
        
    # 11. Cap Rate Spread — EXCLUDED (no real cap rate series available)
    # add("cap_rate_spread", "Cap Rate Spread", False, note=cs.MISSING_INDICATORS["cap_rate_spread"])

    # 12. Rent Growth (ZORI, monthly %, Midwest average)
    if "rent_growth_zori" in automated:
        zori_rows = automated["rent_growth_zori"]["rows"]
        by_date = {}
        for r in zori_rows:
            by_date.setdefault(r["date"], []).append(r["zori"])
        avg_by_date = {d: statistics.mean(v) for d, v in by_date.items() if v}
        sorted_dates = sorted(avg_by_date.keys())
        if len(sorted_dates) >= 2:
            latest_val = avg_by_date[sorted_dates[-1]]
            prev_val = avg_by_date[sorted_dates[-2]]
            monthly_pct = (latest_val - prev_val) / prev_val * 100 if prev_val else None
            add("rent_growth_zori", "Rent Growth (ZORI, Midwest avg)", monthly_pct is not None,
                raw_value=monthly_pct, score=cs.score_rent_growth(monthly_pct) if monthly_pct is not None else None)
        else:
            add("rent_growth_zori", "Rent Growth (ZORI)", False, note="Insufficient history")
    else:
        add("rent_growth_zori", "Rent Growth (ZORI)", False, note="Source data unavailable")

    # 13. Vacancy (QoQ change in percentage points)
    if "rental_vacancy_rate" in automated:
        delta = _delta_vs_days_ago(automated["rental_vacancy_rate"], "rental_vacancy_rate", 90)
        add("vacancy", "Rental Vacancy (QoQ change)", delta is not None,
            raw_value=delta, score=cs.score_vacancy(delta) if delta is not None else None)
    else:
        add("vacancy", "Rental Vacancy", False, note="Source data unavailable")

    # 14. Distress (FDIC/Fed CRE delinquency rate, latest)
    if "cre_delinquency_rate" in automated:
        latest = _latest(automated["cre_delinquency_rate"], "cre_delinquency_rate")
        add("distress", "Distress (CRE Loan Delinquency Rate)", latest is not None,
            raw_value=latest, score=cs.score_distress(latest) if latest is not None else None)
    else:
        add("distress", "Distress (CRE Loan Delinquency Rate)", False, note="Source data unavailable — add cre_delinquency_rate (DRCRELEXFACBS) to FRED_SERIES")

    # 15. Transaction Volume (CPPI) — EXCLUDED
    add("transaction_volume_cppi", "Transaction Volume (CPPI)", False,
        note=cs.MISSING_INDICATORS["transaction_volume_cppi"])

    # 16. Consumer Confidence — available via UMCSENT, but flagged as a
    # DIFFERENT index than the methodology specifies (Conference Board CCI).
    # Scored anyway since it's directionally useful, but the scale mismatch
    # means the resulting score should be read with real caution.
    if "consumer_sentiment_umcsent" in automated:
        latest = _latest(automated["consumer_sentiment_umcsent"], "consumer_sentiment_umcsent")
        score = cs.score_consumer_confidence(latest) if latest is not None else None
        add("consumer_confidence", "Consumer Confidence (UMCSENT proxy — NOT Conference Board CCI)",
            latest is not None, raw_value=latest, score=score,
            note="Scored against thresholds calibrated for Conference Board CCI, which runs on a different scale than University of Michigan's index. Treat this score with caution until thresholds are recalibrated for UMCSENT specifically." if latest is not None else "Source data unavailable")
    else:
        add("consumer_confidence", "Consumer Confidence", False, note="Source data unavailable — add consumer_sentiment_umcsent (UMCSENT) to FRED_SERIES")

    # 17. Mortgage Rate (latest)
    if "mortgage_rate_30y" in automated:
        latest = _latest(automated["mortgage_rate_30y"], "mortgage_rate_30y")
        add("mortgage_rate", "30-Year Mortgage Rate", latest is not None,
            raw_value=latest, score=cs.score_mortgage_rate(latest) if latest is not None else None)
    else:
        add("mortgage_rate", "30-Year Mortgage Rate", False, note="Source data unavailable — add mortgage_rate_30y (MORTGAGE30US) to FRED_SERIES")

    return scores

def compute_cycle_score(automated: dict) -> dict:
    scores = compute_indicator_scores(automated)
    return cs.aggregate_cycle_score(scores)
