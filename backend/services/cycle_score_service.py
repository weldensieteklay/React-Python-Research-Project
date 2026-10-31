"""
services/cycle_score_service.py

Implements the Harvest Time Capital Macro Intelligence Engine
methodology (v2.0, Oct 2026): scores each indicator 0-5 against the
thresholds in the methodology doc, then aggregates into a 0-100 Cycle Score:

    Cycle Score = (sum of indicator scores) / (17 x 5) x 100

COVERAGE: all 17 indicators have a free, automated source in v2.0. If a source
fails on a given day, that indicator is reported as unavailable and two scores
are returned: `cycle_score` (over the indicators that loaded) and
`cycle_score_methodology` (the doc's fixed 17 x 5 denominator, missing = 0).
They are equal when all 17 load.
"""
from dataclasses import dataclass, field

TOTAL_INDICATORS_IN_METHODOLOGY = 17
MAX_SCORE_PER_INDICATOR = 5

# v2.0: every indicator has an automated source; nothing is permanently missing.
MISSING_INDICATORS: dict[str, str] = {}

CYCLE_PHASES = [
    (0, 20, "Recession"),
    (20, 40, "Early Recovery"),
    (40, 60, "Mid-Cycle Expansion"),
    (60, 80, "Late-Cycle Expansion"),
    (80, 101, "Overheating"),
]


def classify_phase(cycle_score: float) -> str:
    for low, high, label in CYCLE_PHASES:
        if low <= cycle_score < high:
            return label
    return "Unknown"


def _score_descending(value: float, thresholds: list[tuple[float, int]]) -> int:
    """thresholds: [(cutoff, score), ...] in DESCENDING cutoff order.
    Returns the score for the first cutoff the value meets or exceeds."""
    for cutoff, score in thresholds:
        if value >= cutoff:
            return score
    return thresholds[-1][1]


def _score_ascending(value: float, thresholds: list[tuple[float, int]]) -> int:
    """thresholds: [(cutoff, score), ...] in ASCENDING cutoff order.
    Returns the score for the first cutoff the value is below."""
    for cutoff, score in thresholds:
        if value < cutoff:
            return score
    return thresholds[-1][1]


# ---------------------------------------------------------------------
# Per-indicator scorers. Each takes the already-computed derived value
# (e.g. a 90-day delta, a YoY %, a ratio) -- NOT a raw time series.
# Deriving those values from your fetched raw series is a separate step
# (see cycle_score_router.py for how each is computed per indicator).
# ---------------------------------------------------------------------

def score_fed_funds_trend(delta_90d_pct: float) -> int:
    # thresholds are deltas in percentage points, e.g. +0.75 means rose 0.75pp
    if delta_90d_pct >= 0.75: return 0
    if delta_90d_pct >= 0.25: return 1
    if delta_90d_pct >= 0: return 2
    if delta_90d_pct <= -0.50: return 5
    if delta_90d_pct <= -0.25: return 4
    return 3

def score_cpi_yoy(yoy_pct: float) -> int:
    return _score_descending(yoy_pct, [(6, 0), (4, 1), (3, 2), (2, 3), (1.5, 4), (float("-inf"), 5)])

def score_treasury_10y(yield_pct: float) -> int:
    return _score_descending(yield_pct, [(5, 0), (4.5, 1), (4, 2), (3, 3), (2, 4), (float("-inf"), 5)])

# SLOOS net % of banks tightening -> the methodology's categories. Cutoffs follow the
# size words the Fed uses in SLOOS summaries; adjust here if your committee prefers others.
SLOOS_CUTOFFS = {"significant": 20.0, "modest": 5.0}


def classify_sloos(net_pct_tightening: float) -> str:
    """Net % of domestic banks tightening (positive) or easing (negative) CRE standards."""
    sig, mod = SLOOS_CUTOFFS["significant"], SLOOS_CUTOFFS["modest"]
    if net_pct_tightening >= sig: return "tightened_significantly"
    if net_pct_tightening >= mod: return "tightened"
    if net_pct_tightening > -mod: return "unchanged"
    if net_pct_tightening > -sig: return "eased"
    return "eased_significantly"


def score_credit_conditions(sloos_signal: str) -> int:
    """sloos_signal: one of 'tightened_significantly','tightened','unchanged','eased','eased_significantly'
    (use classify_sloos on the net % tightening)."""
    mapping = {
        "tightened_significantly": 0, "tightened": 1, "unchanged": 3,
        "eased": 4, "eased_significantly": 5,
    }
    return mapping.get(sloos_signal, 3)  # unchanged/unknown defaults to neutral

def score_gdp_growth(qoq_pct: float) -> int:
    return _score_ascending(qoq_pct, [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (float("inf"), 5)])

def score_labor_market(unemployment_trend: str, jolts_strength: str) -> int:
    """unemployment_trend: 'rising_fast','rising','flat','falling'
       jolts_strength: 'weak','strong','very_strong'"""
    if unemployment_trend == "rising_fast": return 0
    if unemployment_trend == "rising": return 1
    if unemployment_trend == "flat" and jolts_strength == "weak": return 2
    if unemployment_trend == "flat" and jolts_strength in ("strong", "very_strong"): return 3
    if unemployment_trend == "falling" and jolts_strength == "strong": return 4
    if unemployment_trend == "falling" and jolts_strength == "very_strong": return 5
    return 3

def score_midwest_pmi(pmi_value: float) -> int:
    """For a real PMI reading (50 = no change). Kept for when a licensed Chicago PMI is available."""
    return _score_ascending(pmi_value, [(42, 0), (48, 1), (50, 2), (52, 3), (55, 4), (float("inf"), 5)])


def score_cfnai_ma3(cfnai_ma3: float) -> int:
    """PMI substitute: Chicago Fed National Activity Index, 3-month average (0 = trend growth).
    Cutoffs from the Chicago Fed's own guidance: below -0.70 signals recession; above +0.20
    after a contraction signals recovery; above +0.70 signals rising inflation pressure.
    -0.35 is the midpoint between recession and trend."""
    return _score_ascending(cfnai_ma3, [(-0.70, 0), (-0.35, 1), (0, 2), (0.20, 3), (0.70, 4), (float("inf"), 5)])

def score_migration(annual_pct_change: float) -> int:
    return _score_ascending(annual_pct_change, [(-1, 0), (-0.5, 1), (0, 2), (0.5, 3), (1, 4), (float("inf"), 5)])

def score_wage_growth(qoq_pct: float) -> int:
    return _score_ascending(qoq_pct, [(1, 0), (2, 1), (3, 2), (4, 3), (5, 4), (float("inf"), 5)])

def score_construction_pipeline(ratio_to_avg: float) -> int:
    # ratio_to_avg: current permits / historical average permits
    return _score_descending(ratio_to_avg, [(3, 0), (2, 1), (1.5, 2), (1, 3), (0.5, 4), (float("-inf"), 5)])

def score_cap_rate_spread(spread_pct: float) -> int:
    return _score_ascending(spread_pct, [(1.5, 0), (2, 1), (2.5, 2), (3, 3), (3.5, 4), (float("inf"), 5)])

def score_rent_growth(monthly_pct: float) -> int:
    return _score_ascending(monthly_pct, [(-3, 0), (-1, 1), (1, 2), (2, 3), (3, 4), (float("inf"), 5)])

VACANCY_FLAT_BAND = 0.05   # |change| below this counts as "0%" (flat)


def score_vacancy(qoq_change: float) -> int:
    """Quarterly change (vacancy rate in pp, or stress index points in v2). The doc lists
    "0% -> 2" and "0% -> 3"; read here as a small rise -> 2 and flat -> 3, so the score never
    goes UP as vacancy pressure rises (the old version scored a +0.3 rise above a flat quarter)."""
    if qoq_change >= 1: return 0
    if qoq_change >= 0.5: return 1
    if qoq_change >= VACANCY_FLAT_BAND: return 2
    if qoq_change > -VACANCY_FLAT_BAND: return 3
    if qoq_change >= -1: return 4
    return 5

def score_distress(distress_pct: float) -> int:
    """distress_pct: higher = more distress. v2: the year-over-year CRE price DECLINE in %
    (0 when prices rose). Also valid for a CRE delinquency rate in %."""
    return _score_descending(distress_pct, [(8, 0), (6, 1), (4, 2), (2, 3), (1, 4), (float("-inf"), 5)])

def score_transaction_volume_cppi(qoq_pct: float) -> int:
    return _score_ascending(qoq_pct, [(-10, 0), (-5, 1), (0, 2), (5, 3), (10, 4), (float("inf"), 5)])

def score_consumer_confidence(cci_level: float) -> int:
    return _score_ascending(cci_level, [(70, 0), (85, 1), (100, 2), (110, 3), (120, 4), (float("inf"), 5)])

def score_mortgage_rate(rate_pct: float) -> int:
    return _score_descending(rate_pct, [(7.5, 0), (7, 1), (6.5, 2), (6, 3), (5, 4), (float("-inf"), 5)])


@dataclass
class IndicatorScore:
    key: str
    label: str
    raw_value: float | dict | None
    score: int | None
    available: bool
    note: str | None = None
    source: str | None = None      # series used, e.g. "FRED STLFSI4"
    as_of: str | None = None       # date of the latest observation used


def aggregate_cycle_score(scores: list[IndicatorScore]) -> dict:
    available = [s for s in scores if s.available and s.score is not None]
    missing = [s for s in scores if not (s.available and s.score is not None)]

    total_score = sum(s.score for s in available)
    max_possible = len(available) * MAX_SCORE_PER_INDICATOR
    cycle_score = round(total_score / max_possible * 100, 1) if max_possible else None
    # Methodology formula: fixed 17 x 5 denominator (a missing indicator counts as 0)
    methodology_score = round(total_score / (TOTAL_INDICATORS_IN_METHODOLOGY * MAX_SCORE_PER_INDICATOR) * 100, 1)

    full = len(available) == TOTAL_INDICATORS_IN_METHODOLOGY
    return {
        "cycle_score": cycle_score,
        "phase": classify_phase(cycle_score) if cycle_score is not None else None,
        "cycle_score_methodology": methodology_score,
        "indicators_used": len(available),
        "indicators_in_methodology": TOTAL_INDICATORS_IN_METHODOLOGY,
        "coverage_note": (
            f"Based on all {TOTAL_INDICATORS_IN_METHODOLOGY} methodology indicators."
            if full else
            f"Based on {len(available)} of {TOTAL_INDICATORS_IN_METHODOLOGY} indicators; "
            f"{len(missing)} could not be loaded today. cycle_score excludes them; "
            f"cycle_score_methodology counts them as 0 per the fixed 17 x 5 formula."
        ),
        "missing_indicators": [
            {"key": s.key, "label": s.label, "reason": s.note} for s in missing
        ],
        "indicator_breakdown": [
            {"key": s.key, "label": s.label, "raw_value": s.raw_value, "score": s.score,
             "note": s.note, "source": s.source, "as_of": s.as_of}
            for s in available
        ],
    }
