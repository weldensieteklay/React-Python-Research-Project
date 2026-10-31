"""
services/cycle_score_transform.py

Turns fetch_all_indicators()'s raw {date, value} rows into the derived values
(deltas, YoY %, QoQ %, ratios) that cycle_score_service's scorers expect, for all
17 indicators of Methodology v2.0. Called from the /macro-indicators route.

Each indicator reports the series it used (`source`) and the date of the latest
observation (`as_of`), so stale inputs are visible.

Settings (environment variables, all optional):
  HTC_CAP_RATE_ANCHOR    Market cap rate in % that the implied cap rate is built from
                         (#11). Default 6.5 is a PLACEHOLDER; set your own.
  HTC_VACANCY_SOURCE     "stress" (default, Methodology v2: STLFSI4) or
                         "rental_vacancy" (Census rental vacancy rate, RRVRUSQ156N).
  HTC_DISTRESS_SOURCE    "cppi" (default, Methodology v2: CRE price decline) or
                         "delinquency" (bank CRE delinquency rate, DRCRELEXFACBS).
"""
import os
import statistics

import pandas as pd

from services import cycle_score_service as cs

CAP_RATE_ANCHOR = float(os.environ.get("HTC_CAP_RATE_ANCHOR", "6.5"))
VACANCY_SOURCE = os.environ.get("HTC_VACANCY_SOURCE", "stress")
DISTRESS_SOURCE = os.environ.get("HTC_DISTRESS_SOURCE", "cppi")


# ---------------------------------------------------------------------
# Helpers: every FRED/BLS payload is {"rows": [{"date": ..., <key>: value}, ...]}
# ---------------------------------------------------------------------
def _series(automated: dict, key: str) -> pd.Series | None:
    """The indicator as a date-indexed float Series (sorted, NaNs dropped), or None."""
    payload = automated.get(key)
    if not payload or not payload.get("rows"):
        return None
    df = pd.DataFrame(payload["rows"])
    value_col = key if key in df.columns else "value" if "value" in df.columns else None
    if value_col is None or "date" not in df.columns:
        return None
    s = pd.Series(pd.to_numeric(df[value_col], errors="coerce").values,
                  index=pd.to_datetime(df["date"], errors="coerce"))
    s = s[s.index.notna()].dropna().sort_index()
    s = s[~s.index.duplicated(keep="last")]
    return s if not s.empty else None


def _as_of(s: pd.Series | None, quarterly: bool = False) -> str | None:
    if s is None or s.empty:
        return None
    d = s.index[-1]
    return f"{d.year}Q{(d.month - 1) // 3 + 1}" if quarterly else d.strftime("%Y-%m-%d")


def _value_near(s: pd.Series, target: pd.Timestamp, tolerance_days: int):
    """The observation closest to `target`, if one is within `tolerance_days`."""
    pos = s.index.get_indexer([target], method="nearest")[0]
    if pos < 0 or abs((s.index[pos] - target).days) > tolerance_days:
        return None
    return float(s.iloc[pos])


def _delta_days(s: pd.Series, days: int, tolerance_days: int = 20):
    past = _value_near(s, s.index[-1] - pd.Timedelta(days=days), tolerance_days)
    return None if past is None else float(s.iloc[-1]) - past


def _yoy_pct(s: pd.Series):
    past = _value_near(s, s.index[-1] - pd.DateOffset(years=1), tolerance_days=20)
    return None if not past else (float(s.iloc[-1]) / past - 1) * 100


def _annualized_qoq(s: pd.Series):
    """Latest quarter vs the previous one, annualized (how BEA reports GDP growth)."""
    if len(s) < 2 or not s.iloc[-2]:
        return None
    return ((float(s.iloc[-1]) / float(s.iloc[-2])) ** 4 - 1) * 100


def _complete_quarters(s: pd.Series, min_obs: int) -> pd.Series:
    """Quarterly means, keeping only quarters with at least `min_obs` observations
    (so a half-finished current quarter isn't compared with a full one)."""
    grouped = s.groupby(s.index.to_period("Q"))
    q = grouped.mean()[grouped.count() >= min_obs]
    return q.sort_index()


def compute_indicator_scores(automated: dict) -> list[cs.IndicatorScore]:
    scores: list[cs.IndicatorScore] = []

    def add(key, label, raw_value=None, score=None, note=None, source=None, as_of=None):
        available = raw_value is not None and score is not None
        scores.append(cs.IndicatorScore(
            key=key, label=label, raw_value=raw_value, score=score, available=available,
            note=note, source=source, as_of=as_of,
        ))

    def unavailable(key, label, why="Source data unavailable", source=None):
        add(key, label, note=why, source=source)

    # 1. Fed Funds Rate Trend: change over 90 days, percentage points
    s = _series(automated, "fed_funds_rate")
    d = _delta_days(s, 90) if s is not None else None
    if d is None:
        unavailable("fed_funds_trend", "Federal Funds Rate Trend", source="FRED EFFR")
    else:
        add("fed_funds_trend", "Federal Funds Rate Trend", round(d, 3), cs.score_fed_funds_trend(d),
            note="Change over the last 90 days, percentage points", source="FRED EFFR", as_of=_as_of(s))

    # 2. Inflation: CPI year-over-year %
    s = _series(automated, "cpi_all_items")
    yoy = _yoy_pct(s) if s is not None else None
    if yoy is None:
        unavailable("cpi_yoy", "Inflation (CPI YoY)", source="BLS CUUR0000SA0")
    else:
        add("cpi_yoy", "Inflation (CPI YoY)", round(yoy, 2), cs.score_cpi_yoy(yoy),
            source="BLS CUUR0000SA0", as_of=_as_of(s))

    # 3. 10-Year Treasury Yield
    s = _series(automated, "treasury_10y")
    if s is None:
        unavailable("treasury_10y", "10-Year Treasury Yield", source="FRED DGS10")
    else:
        v = float(s.iloc[-1])
        add("treasury_10y", "10-Year Treasury Yield", v, cs.score_treasury_10y(v), source="FRED DGS10", as_of=_as_of(s))

    # 4. Credit Conditions: SLOOS net % of banks tightening CRE standards,
    #    averaged over the three CRE loan types for the latest survey quarter
    sloos_keys = {"sloos_cre_construction": "construction", "sloos_cre_nonfarm": "nonfarm nonresidential",
                  "sloos_cre_multifamily": "multifamily"}
    parts = {k: _series(automated, k) for k in sloos_keys}
    parts = {k: v for k, v in parts.items() if v is not None}
    if not parts:
        unavailable("credit_conditions_sloos", "Credit Conditions (SLOOS)", source="FRED SUBLPDRCSC/N/M")
    else:
        latest_q = max(v.index[-1] for v in parts.values())
        at_latest = {sloos_keys[k]: float(v.loc[latest_q]) for k, v in parts.items() if latest_q in v.index}
        net = statistics.mean(at_latest.values())
        signal = cs.classify_sloos(net)
        add("credit_conditions_sloos", "Credit Conditions (SLOOS, CRE lending standards)",
            {"net_pct_tightening": round(net, 1), "signal": signal, "by_loan_type": at_latest},
            cs.score_credit_conditions(signal),
            note="Positive = more banks tightening than easing. Average of the CRE loan types reported for the latest survey.",
            source="FRED SUBLPDRCSC, SUBLPDRCSN, SUBLPDRCSM",
            as_of=f"{latest_q.year}Q{(latest_q.month - 1) // 3 + 1}")

    # 5. GDP Growth: latest quarter, annualized
    s = _series(automated, "real_gdp")
    g = _annualized_qoq(s) if s is not None else None
    if g is None:
        unavailable("gdp_growth", "GDP Growth", source="FRED GDPC1")
    else:
        add("gdp_growth", "GDP Growth (QoQ, annualized)", round(g, 2), cs.score_gdp_growth(g),
            source="FRED GDPC1", as_of=_as_of(s, quarterly=True))

    # 6. Labor Market Strength: unemployment trend + JOLTS vs its own median
    u, j = _series(automated, "unemployment_rate"), _series(automated, "jolts_job_openings")
    u_delta = _delta_days(u, 90, tolerance_days=31) if u is not None else None
    if u_delta is None or j is None:
        unavailable("labor_market", "Labor Market Strength", "Unemployment or JOLTS data unavailable",
                    source="FRED UNRATE, JTSJOL")
    else:
        j_latest, j_median = float(j.iloc[-1]), float(j.median())
        u_trend = "rising_fast" if u_delta >= 0.5 else "rising" if u_delta > 0.1 else "falling" if u_delta < -0.1 else "flat"
        j_strength = "very_strong" if j_latest > j_median * 1.2 else "strong" if j_latest > j_median else "weak"
        add("labor_market", "Labor Market Strength",
            {"unemployment_delta_3m": round(u_delta, 2), "unemployment_trend": u_trend,
             "jolts_latest": j_latest, "jolts_median": j_median, "jolts_strength": j_strength},
            cs.score_labor_market(u_trend, j_strength), source="FRED UNRATE, JTSJOL", as_of=_as_of(u))

    # 7. Midwest PMI substitute: Chicago Fed National Activity Index, 3-month average
    s = _series(automated, "cfnai_ma3")
    if s is None:
        unavailable("midwest_pmi", "Midwest PMI substitute (CFNAI-MA3)", source="FRED CFNAIMA3")
    else:
        v = float(s.iloc[-1])
        add("midwest_pmi", "Midwest PMI substitute (Chicago Fed National Activity Index, 3-mo avg)", v,
            cs.score_cfnai_ma3(v),
            note="Chicago PMI is a licensed product. CFNAI-MA3 (0 = trend growth) is scored on the Chicago Fed's own cutoffs.",
            source="FRED CFNAIMA3", as_of=_as_of(s))

    # 8. Migration: Midwest total population, YoY %, over states present in both years
    pop = automated.get("midwest_population")
    if not pop or not pop.get("rows"):
        unavailable("migration", "Migration (Annual Population Change, Midwest)", source="FRED state POP series")
    else:
        df = pd.DataFrame(pop["rows"])
        df["year"] = pd.to_datetime(df["date"]).dt.year
        wide = df.pivot_table(index="year", columns="state", values="POP", aggfunc="last").sort_index()
        if len(wide) < 2:
            unavailable("migration", "Migration (Annual Population Change, Midwest)", "Insufficient history")
        else:
            last, prev = wide.iloc[-1], wide.iloc[-2]
            both = last.notna() & prev.notna()
            pct = (last[both].sum() / prev[both].sum() - 1) * 100 if both.any() else None
            if pct is None:
                unavailable("migration", "Migration (Annual Population Change, Midwest)", "No state has two years of data")
            else:
                add("migration", "Migration (Annual Population Change, Midwest)", round(pct, 3), cs.score_migration(pct),
                    note=f"{int(both.sum())} of 12 Midwest states", source="FRED state POP series",
                    as_of=str(int(wide.index[-1])))

    # 9. Wage Growth: average hourly earnings, quarterly average, annualized QoQ
    s = _series(automated, "avg_hourly_earnings")
    q = _complete_quarters(s, min_obs=3) if s is not None else None
    w = _annualized_qoq(q) if q is not None else None
    if w is None:
        unavailable("wage_growth", "Wage Growth", source="FRED CES0500000003")
    else:
        add("wage_growth", "Wage Growth (QoQ, annualized)", round(w, 2), cs.score_wage_growth(w),
            source="FRED CES0500000003", as_of=str(q.index[-1]))

    # 10. Construction Pipeline: Midwest building permits vs their 10-year average
    s = _series(automated, "building_permits_midwest")
    if s is None:
        unavailable("construction_pipeline", "Construction Pipeline (Midwest permits)", source="FRED PERMITMW")
    else:
        window = s[s.index >= s.index[-1] - pd.DateOffset(years=10)]
        ratio = float(s.iloc[-1]) / float(window.mean())
        add("construction_pipeline", "Construction Pipeline (Midwest permits vs 10-yr average)", round(ratio, 3),
            cs.score_construction_pipeline(ratio), source="FRED PERMITMW", as_of=_as_of(s))

    # 11. Cap Rate Spread (v2): implied cap rate from CRE price and CPI changes, minus 10-yr Treasury.
    #     If prices rose faster than income (CPI as the NOI-growth proxy), cap rates compressed.
    cppi, cpi, t10 = (_series(automated, k) for k in ("cre_price_index", "cpi_all_items", "treasury_10y"))
    if cppi is None or cpi is None or t10 is None:
        unavailable("cap_rate_spread", "Cap Rate Spread (implied)", "CRE price, CPI or Treasury data unavailable",
                    source="FRED COMREPUSQ159N, BLS CPI, FRED DGS10")
    else:
        price_yoy = float(cppi.iloc[-1])
        quarter_end = cppi.index[-1] + pd.offsets.QuarterEnd(0)
        cpi_at = cpi[cpi.index <= quarter_end]
        income_yoy = _yoy_pct(cpi_at) if len(cpi_at) else None
        if income_yoy is None:
            unavailable("cap_rate_spread", "Cap Rate Spread (implied)", "No CPI for the CRE price quarter")
        else:
            implied_cap = CAP_RATE_ANCHOR * (1 + income_yoy / 100) / (1 + price_yoy / 100)
            spread = implied_cap - float(t10.iloc[-1])
            add("cap_rate_spread", "Cap Rate Spread (implied cap rate - 10-yr Treasury)",
                {"spread_pct": round(spread, 2), "implied_cap_rate": round(implied_cap, 2),
                 "anchor_cap_rate": CAP_RATE_ANCHOR, "cre_price_yoy": round(price_yoy, 2),
                 "cpi_yoy": round(income_yoy, 2), "treasury_10y": float(t10.iloc[-1])},
                cs.score_cap_rate_spread(spread),
                note="Inferred, not observed: anchor cap rate x (1 + CPI YoY) / (1 + CRE price YoY). "
                     "Set HTC_CAP_RATE_ANCHOR to your market's cap rate.",
                source="FRED COMREPUSQ159N + BLS CPI + FRED DGS10", as_of=_as_of(cppi, quarterly=True))

    # 12. Rent Growth: ZORI month-over-month %, Midwest metros present in both months
    z = automated.get("rent_growth_zori")
    if not z or not z.get("rows"):
        unavailable("rent_growth_zori", "Rent Growth (ZORI, Midwest)", source="Zillow ZORI")
    else:
        df = pd.DataFrame(z["rows"])
        wide = df.pivot_table(index="date", columns="RegionName", values="zori", aggfunc="mean").sort_index()
        if len(wide) < 2:
            unavailable("rent_growth_zori", "Rent Growth (ZORI, Midwest)", "Insufficient history")
        else:
            last, prev = wide.iloc[-1], wide.iloc[-2]
            both = last.notna() & prev.notna()
            m = (last[both].mean() / prev[both].mean() - 1) * 100 if both.any() else None
            if m is None:
                unavailable("rent_growth_zori", "Rent Growth (ZORI, Midwest)", "No metro has two months of data")
            else:
                add("rent_growth_zori", "Rent Growth (ZORI, Midwest metros, MoM)", round(m, 3), cs.score_rent_growth(m),
                    note=f"{int(both.sum())} metros", source="Zillow ZORI", as_of=str(wide.index[-1])[:10])

    # 13. Vacancy (v2): quarterly change in the Financial Stress Index (or rental vacancy rate)
    if VACANCY_SOURCE == "rental_vacancy":
        s = _series(automated, "rental_vacancy_rate")
        d = float(s.iloc[-1] - s.iloc[-2]) if s is not None and len(s) >= 2 else None
        src, note, as_of = "FRED RRVRUSQ156N", "Quarterly change in the rental vacancy rate, percentage points", _as_of(s, True)
    else:
        s = _series(automated, "financial_stress_index")
        q = _complete_quarters(s, min_obs=12) if s is not None else None
        d = float(q.iloc[-1] - q.iloc[-2]) if q is not None and len(q) >= 2 else None
        src = "FRED STLFSI4"
        note = "Change in the quarterly average Financial Stress Index (index points; rising stress -> rising vacancy)"
        as_of = str(q.index[-1]) if q is not None and len(q) else None
    if d is None:
        unavailable("vacancy", "Vacancy", source=src)
    else:
        add("vacancy", "Vacancy (QoQ change)", round(d, 3), cs.score_vacancy(d), note=note, source=src, as_of=as_of)

    # 14. Distress (v2): size of the year-over-year CRE price decline (or bank CRE delinquency rate)
    if DISTRESS_SOURCE == "delinquency":
        s = _series(automated, "cre_delinquency_rate")
        if s is None:
            unavailable("distress", "Distress (CRE delinquency rate)", source="FRED DRCRELEXFACBS")
        else:
            v = float(s.iloc[-1])
            add("distress", "Distress (CRE Loan Delinquency Rate)", v, cs.score_distress(v),
                source="FRED DRCRELEXFACBS", as_of=_as_of(s, quarterly=True))
    else:
        s = _series(automated, "cre_price_index")
        if s is None:
            unavailable("distress", "Distress (CRE price decline)", source="FRED COMREPUSQ159N")
        else:
            yoy = float(s.iloc[-1])
            decline = max(0.0, -yoy)
            add("distress", "Distress (CRE price decline, YoY)",
                {"price_decline_pct": round(decline, 2), "cre_price_yoy": round(yoy, 2)}, cs.score_distress(decline),
                note="0 when CRE prices rose. COMREPUSQ159N is published as % change from a year ago and lags ~2 quarters.",
                source="FRED COMREPUSQ159N", as_of=_as_of(s, quarterly=True))

    # 15. Transaction Volume (v2): construction spending, quarterly average, QoQ %
    s = _series(automated, "construction_spending")
    q = _complete_quarters(s, min_obs=3) if s is not None else None
    if q is None or len(q) < 2:
        unavailable("transaction_volume", "Transaction Volume (construction spending)", source="FRED TTLCONS")
    else:
        pct = (float(q.iloc[-1]) / float(q.iloc[-2]) - 1) * 100
        add("transaction_volume", "Transaction Volume (construction spending, QoQ)", round(pct, 2),
            cs.score_transaction_volume_cppi(pct), source="FRED TTLCONS", as_of=str(q.index[-1]))

    # 16. Consumer Confidence (UMCSENT, scored on the CCI thresholds)
    s = _series(automated, "consumer_sentiment_umcsent")
    if s is None:
        unavailable("consumer_confidence", "Consumer Confidence", source="FRED UMCSENT")
    else:
        v = float(s.iloc[-1])
        add("consumer_confidence", "Consumer Confidence (UMCSENT proxy for Conference Board CCI)", v,
            cs.score_consumer_confidence(v),
            note="Thresholds were set for the Conference Board CCI, which runs on a different scale; read with caution.",
            source="FRED UMCSENT", as_of=_as_of(s))

    # 17. Mortgage Rate
    s = _series(automated, "mortgage_rate_30y")
    if s is None:
        unavailable("mortgage_rate", "30-Year Mortgage Rate", source="FRED MORTGAGE30US")
    else:
        v = float(s.iloc[-1])
        add("mortgage_rate", "30-Year Mortgage Rate", v, cs.score_mortgage_rate(v),
            source="FRED MORTGAGE30US", as_of=_as_of(s))

    return scores


def compute_cycle_score(automated: dict) -> dict:
    scores = compute_indicator_scores(automated)
    return cs.aggregate_cycle_score(scores)
