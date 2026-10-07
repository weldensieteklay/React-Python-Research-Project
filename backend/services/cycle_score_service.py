"""
services/cycle_score_service.py

Implements the Harvest Time Capital Macro Intelligence Engine
methodology (v1.0, Oct 2026): scores each available indicator 0-5
against the thresholds in the methodology doc, then aggregates into a
0-100 Cycle Score.

COVERAGE NOTE: the methodology specifies 17 indicators. As of this
build, 3-4 have no free equivalent (see MISSING_INDICATORS below) and
are excluded from the denominator rather than silently imputed with a
neutral score -- the resulting score is explicitly labeled with how
many of the 17 indicators it's actually based on, rather than claiming
full coverage it doesn't have.
"""
from dataclasses import dataclass, field

TOTAL_INDICATORS_IN_METHODOLOGY = 17
MAX_SCORE_PER_INDICATOR = 5

MISSING_INDICATORS = {
    "midwest_pmi": "Licensed data product (ISM-Chicago/MNI) — not available via any free API.",
    "cap_rate_spread": "No free true cap-rate series exists; only an aggregate CRE price index is available, which cannot be substituted for cap rate minus Treasury yield without materially changing what's being measured.",
    "transaction_volume_cppi": "No free commercial property price/transaction-volume index distinct from the aggregate CRE price index was found.",
}

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

def score_credit_conditions(sloos_signal: str) -> int:
    """sloos_signal: one of 'tightened_significantly','tightened','unchanged','eased','eased_significantly'.
    NOTE: your current SLOOS fetcher only returns keyword counts, not this classification --
    this needs a real sentiment rule (e.g. net % of banks reporting tightening from the actual
    SLOOS release table) before this scorer can be fed real data. Flagging rather than guessing."""
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
    return _score_ascending(pmi_value, [(42, 0), (48, 1), (50, 2), (52, 3), (55, 4), (float("inf"), 5)])

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

def score_vacancy(qoq_change_pct: float) -> int:
    # doc's thresholds are unusual (0% appears twice, for scores 2 and 3) -- kept exactly as
    # specified; ties resolve to the first match (score 2) per standard threshold-list order
    if qoq_change_pct >= 1: return 0
    if qoq_change_pct >= 0.5: return 1
    if qoq_change_pct == 0: return 2
    if qoq_change_pct < 0 and qoq_change_pct >= -1: return 4
    if qoq_change_pct < -1: return 5
    return 3

def score_distress(delinquency_pct: float) -> int:
    return _score_descending(delinquency_pct, [(8, 0), (6, 1), (4, 2), (2, 3), (1, 4), (float("-inf"), 5)])

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
    raw_value: float | None
    score: int | None
    available: bool
    note: str | None = None


def aggregate_cycle_score(scores: list[IndicatorScore]) -> dict:
    """Computes the Cycle Score over AVAILABLE indicators only (option
    (a) from the coverage discussion), explicitly reporting how many of
    the methodology's 17 indicators were actually used."""
    available = [s for s in scores if s.available and s.score is not None]
    missing = [s for s in scores if not s.available]

    total_score = sum(s.score for s in available)
    max_possible = len(available) * MAX_SCORE_PER_INDICATOR
    cycle_score = round((total_score / max_possible) * 100, 1) if max_possible else None

    return {
        "cycle_score": cycle_score,
        "phase": classify_phase(cycle_score) if cycle_score is not None else None,
        "indicators_used": len(available),
        "indicators_in_methodology": TOTAL_INDICATORS_IN_METHODOLOGY,
        "coverage_note": (
            f"Based on {len(available)} of {TOTAL_INDICATORS_IN_METHODOLOGY} methodology "
            f"indicators. Missing indicators are excluded from both the numerator and "
            f"denominator, not imputed with a neutral score."
        ),
        "missing_indicators": [
            {"key": s.key, "label": s.label, "reason": s.note} for s in missing
        ],
        "indicator_breakdown": [
            {"key": s.key, "label": s.label, "raw_value": s.raw_value, "score": s.score, "note": s.note}
            for s in available
        ],
    }
