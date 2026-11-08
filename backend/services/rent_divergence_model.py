"""
services/rent_divergence_model.py

Research question: did the 2021-22 rent boom end differently across a metro's ZIP codes,
and what explains the difference? Works for any Zillow metro (DFW by default).

Two-way fixed-effects panel model on monthly ZORI rents:

    ln(rent_it) = a_i + g_t + SUM_k b_k (Post_t x Z_ik) + SUM_c d_c (Post_t x County_ic)
                  [+ e (MortgageRate_t x ZlnBaseRent_i)] + u_it

  a_i   ZIP fixed effect   - permanent differences between ZIPs
  g_t   month fixed effect - everything common to the metro in a month (boom, rates, seasonality)
  Post  1 for months after the market peak (default: after 2022-08)
  Z_ik  standardized ZIP traits (1 SD units):
          boom, ln_base_rent                                      (from rents)
          dist_downtown_mi, ln_median_income, renter_share,
          ln_pop_density, renter_stock_growth, new_build_share    (from Census)

b_k reads as: after the peak, a ZIP one standard deviation higher on trait k had rents
(exp(b_k) - 1) x 100 percent higher/lower, relative to its own level around the peak
(compare_from .. post_after, default Mar-Aug 2022) and to the month's metro-wide level.

County terms: DFW keeps its fixed setup (Collin, Denton, Tarrant vs Dallas County, the rest as
"Outer counties"). Any other metro uses its own counties: the one with the most ZIP codes is the
reference, the next MAX_COUNTY_TERMS largest (with at least MIN_COUNTY_ZIPS ZIPs) get their own
term, and the rest are pooled as "Other counties".

How much is estimated depends on how many ZIPs have complete data (gaps of up to
MAX_GAP_MONTHS months are filled first). Trait effects are learned by comparing ZIPs, so the
number of ZIPs, not ZIP-months, is the sample size, and clustered errors need enough of them:
  full         MIN_ZIPS+ ZIPs: all traits, county terms, rate term, by-year view
  simplified   MIN_SIMPLE_ZIPS..MIN_ZIPS-1: boom + rent level + at most one county term
               (about 3 effects), CR1 clustered errors with t(G-1) p-values
  descriptive  fewer: no regression, peak vs latest rent by county and ZIP
Standard errors are clustered by ZIP. The months from `start` to `compare_from` are
used only to measure each ZIP's boom and starting rent, not in the regression.

Base month: the boom and starting rent are measured from `base_month` (default 2020-01). When a
metro's Zillow rents start later, but no later than `latest_base_month` (default 2020-12, before
the 2021 run-up), the metro's first month is used instead and the result says so
(panel.base_month_fallback, notes). Boom sizes are then measured over a shorter run-up and are
not directly comparable with metros measured from 2020-01. Metros starting after
`latest_base_month` are not modeled, since part of the boom would already be in the baseline.

Run on a balanced panel (ZIPs observed in every month of the window) so ZIPs entering
the Zillow data mid-window don't create composition effects.
"""

import numpy as np
import pandas as pd
from linearmodels.panel import PanelOLS
from scipy import stats


DFW_METRO = "Dallas-Fort Worth-Arlington, TX"
# Fixed county setup for DFW, so its results don't change with Zillow's ZIP coverage
COUNTY_PRESETS = {
    DFW_METRO: {
        "core": {"Dallas County", "Tarrant County", "Collin County", "Denton County"},
        "reference": "Dallas County",
        "other": "Outer counties",
    },
}
OTHER_GROUP = "Other counties"
MAX_COUNTY_TERMS = 3   # counties compared with the reference, besides the pooled "other" group
MIN_COUNTY_ZIPS = 5    # smaller counties are pooled
MIN_ZIPS = 30          # full model from here
MIN_SIMPLE_ZIPS = 12   # simplified model from here; below, a direct comparison only
MAX_GAP_MONTHS = 2     # missing months in a row that are filled in rather than dropping the ZIP


class NotEnoughZips(ValueError):
    """The metro doesn't have enough ZIPs with complete data for this analysis."""


def county_groups(county: pd.Series, metro: str = DFW_METRO) -> tuple[pd.Series, str | None]:
    """Group per ZIP and the reference group. county: one value per ZIP (index = zip_code)."""
    preset = COUNTY_PRESETS.get(metro)
    if preset:
        return county.where(county.isin(preset["core"]), preset["other"]), preset["reference"]
    counts = county.dropna().value_counts()
    counts = counts.sort_index().sort_values(ascending=False, kind="stable")   # ties by name
    big = counts[counts >= MIN_COUNTY_ZIPS]
    if big.empty:
        return pd.Series(OTHER_GROUP, index=county.index), OTHER_GROUP
    core = set(big.index[: 1 + MAX_COUNTY_TERMS])
    return county.where(county.isin(core), OTHER_GROUP), big.index[0]


def county_term(group: str) -> str:
    return group.lower().replace(" ", "_")

RENT_TRAITS = ["boom", "ln_base_rent"]
CENSUS_TRAITS = [
    "dist_downtown_mi", "ln_median_income", "renter_share",
    "ln_pop_density", "renter_stock_growth", "new_build_share",
]

DEFAULTS = {
    "start": "2020-01",
    "end": None,
    "base_month": "2020-01",
    # Latest first month a metro's rents can have and still be measured from it when base_month
    # is missing. Rents were near pre-pandemic levels through 2020; the run-up began in 2021.
    "latest_base_month": "2020-12",
    "peak_months": ("2022-07", "2022-08", "2022-09"),   # 3-month average damps noise in the peak
    "post_after": "2022-08",
    # Regression comparison window starts here. Months before it are used only to measure
    # each ZIP's boom and starting rent. If the boom months stayed in the "pre" period, a
    # ZIP that rose more would look higher after the peak purely because its pre-period
    # average was dragged down by its own low early months - a mechanical, not real, effect.
    "compare_from": "2022-03",
}


def _clean_panel(zori: pd.DataFrame) -> pd.DataFrame:
    df = zori.copy()
    df["zip_code"] = df["zip_code"].astype(str).str.zfill(5)
    if "month_year" not in df:
        df["month_year"] = pd.to_datetime(df["raw_date"]).dt.strftime("%Y-%m")
    if "is_forecast" in df:
        df = df[df["is_forecast"].astype(str).str.lower().isin(["no", "false", "0"])]
    return df[["zip_code", "month_year", "zori_rent", "county"]].dropna(subset=["zori_rent"])


def fill_short_gaps(wide: pd.DataFrame, max_gap: int = None) -> tuple[pd.DataFrame, list]:
    """
    Fills interior runs of at most `max_gap` missing months in each ZIP's rent history by
    straight-line interpolation between the months on either side. Longer gaps, and months
    before a ZIP's first or after its last value, stay missing. Returns (filled, ZIPs filled).
    Zillow leaves a month blank when a ZIP had too few listings to measure; one or two such
    months say nothing about the ZIP, so dropping it for them would waste data.
    """
    max_gap = MAX_GAP_MONTHS if max_gap is None else max_gap
    values = wide.to_numpy(float)
    filled = values.copy()
    changed = []
    for i, row in enumerate(values):
        idx = np.flatnonzero(~np.isnan(row))
        if len(idx) < 2:
            continue
        j, last, did = idx[0], idx[-1], False
        while j < last:
            if np.isnan(row[j]):
                k = j
                while np.isnan(row[k]):
                    k += 1
                if k - j <= max_gap:
                    a, b, n = row[j - 1], row[k], k - j + 1
                    filled[i, j:k] = a + (b - a) * np.arange(1, n) / n
                    did = True
                j = k
            else:
                j += 1
        if did:
            changed.append(wide.index[i])
    return pd.DataFrame(filled, index=wide.index, columns=wide.columns), changed


def _coverage(wide: pd.DataFrame, filled: pd.DataFrame, balanced_index, gap_filled: list) -> dict:
    """Why each ZIP with rents in the window is or isn't usable, for the "uses X of Y" note."""
    ok = filled.notna()
    first = ok.idxmax(axis=1)
    last = ok.iloc[:, ::-1].idxmax(axis=1)
    complete = filled.index.isin(balanced_index)
    late = (first > filled.columns[0]) & ~complete
    early = (last < filled.columns[-1]) & ~complete & ~late
    return {
        "zips_with_rents": int(len(wide)),
        "zips_complete": int(complete.sum()),
        "zips_started_late": int(late.sum()),
        "zips_ended_early": int(early.sum()),
        "zips_with_long_gaps": int((~complete & ~late & ~early).sum()),
        "zips_gap_filled": int(len(set(gap_filled) & set(balanced_index))),
        "max_gap_filled_months": MAX_GAP_MONTHS,
        "first_month": str(filled.columns[0]),
        "last_month": str(filled.columns[-1]),
    }


def _resolve_base_month(first_month: str, base_month: str, latest_base_month: str,
                        area_name: str) -> str:
    """The base month to measure the boom from: base_month itself, or the metro's first month
    when its rents start after base_month but still before the boom (<= latest_base_month)."""
    if first_month <= base_month:
        return base_month
    if first_month <= latest_base_month:
        return first_month
    raise NotEnoughZips(
        f"Zillow's rents for {area_name} start in {first_month}. The boom is measured from a "
        f"month before the 2021 run-up ({base_month}, or at the latest {latest_base_month}), "
        f"so the 2021-22 boom can't be measured here.")


def _prepare_panel(zori, start, end, base_month, peak_months, post_after, compare_from, area_name,
                   latest_base_month=DEFAULTS["latest_base_month"]):
    if not (start <= base_month <= latest_base_month < compare_from <= post_after):
        raise ValueError("Months must satisfy start <= base_month <= latest_base_month "
                         "< compare_from <= post_after")
    df = _clean_panel(zori)
    df = df[df["month_year"] >= start]
    if end:
        df = df[df["month_year"] <= end]
    if df.empty:
        raise NotEnoughZips(f"Zillow has no rents for {area_name} since {start}.")

    wide = df.pivot_table(index="zip_code", columns="month_year", values="zori_rent")
    base_used = _resolve_base_month(str(wide.columns[0]), base_month, latest_base_month, area_name)
    for m in [base_used, *peak_months]:
        if m not in wide.columns:
            raise ValueError(f"Month {m} is not in the panel window {start}..{end or 'latest'}")
    filled, gap_filled = fill_short_gaps(wide)
    balanced = filled.dropna()
    county = df.drop_duplicates("zip_code").set_index("zip_code")["county"]
    return df, wide, filled, balanced, gap_filled, county, base_used


def build_model_panel(zori: pd.DataFrame, start=DEFAULTS["start"], end=DEFAULTS["end"],
                      base_month=DEFAULTS["base_month"], peak_months=DEFAULTS["peak_months"],
                      post_after=DEFAULTS["post_after"], compare_from=DEFAULTS["compare_from"],
                      latest_base_month=DEFAULTS["latest_base_month"], area_name="DFW"):
    """Returns (long panel restricted to the comparison window, one-row-per-ZIP traits,
    metadata). Balance is required over the whole window from `start`, after filling gaps of
    up to MAX_GAP_MONTHS months. The regression itself uses only Zillow's actual values; filled
    months only decide which ZIPs count as complete and feed the base/peak averages.
    meta["base_month"] is the month the boom was actually measured from (see the module docstring)."""
    requested = base_month
    df, wide, filled, balanced, gap_filled, county, base_month = _prepare_panel(
        zori, start, end, base_month, peak_months, post_after, compare_from, area_name,
        latest_base_month)

    base = balanced[base_month]
    peak = balanced[list(peak_months)].mean(axis=1)
    traits = pd.DataFrame({
        "boom": peak / base - 1,
        "ln_base_rent": np.log(base),
    })
    traits["county"] = county.reindex(traits.index)
    traits.index.name = "zip_code"

    long = df[df["zip_code"].isin(balanced.index) & (df["month_year"] >= compare_from)].copy()
    if len(balanced) and (long["month_year"] > post_after).sum() == 0:
        raise ValueError(f"No months after post_after={post_after} in the window")
    long["date"] = pd.to_datetime(long["month_year"])
    long["post"] = (long["month_year"] > post_after).astype(int)
    long["ln_rent"] = np.log(long["zori_rent"])

    window_months = [m for m in filled.columns if m >= compare_from]
    meta = {
        "window": [window_months[0], window_months[-1]] if window_months else [compare_from, compare_from],
        "months": int(len(window_months)),
        "base_month": base_month,                     # month the boom is measured from
        "base_month_requested": requested,
        "base_month_fallback": base_month != requested,
        "peak_months": list(peak_months),
        "post_after": post_after,
        "compare_from": compare_from,
        "pre_period": [compare_from, post_after],
        "zips_in_window": int(len(wide)),
        "zips_balanced": int(len(balanced)),
        "zips_dropped_incomplete": sorted(set(wide.index) - set(balanced.index)),
        "coverage": _coverage(wide, filled, balanced.index, gap_filled),
    }
    meta["_filled"] = filled   # for the descriptive tier; removed before returning JSON
    meta["_county"] = county
    return long, traits, meta


def _attach_census(traits: pd.DataFrame, covariates: pd.DataFrame | None) -> pd.DataFrame:
    if covariates is None or covariates.empty:
        return traits
    cov = covariates.copy()
    cov["zip_code"] = cov["zip_code"].astype(str).str.zfill(5)
    cov = cov.set_index("zip_code")
    t = traits.join(cov, how="left", rsuffix="_cov")
    if "median_household_income" in t:
        t["ln_median_income"] = np.log(t["median_household_income"])
    if "pop_density_sqmi" in t:
        t["ln_pop_density"] = np.log(t["pop_density_sqmi"])
    return t.replace([np.inf, -np.inf], np.nan)


def _zscore(s: pd.Series) -> pd.Series:
    sd = s.std()
    return (s - s.mean()) / sd if sd and not np.isnan(sd) else s * np.nan


def _small_county_groups(county: pd.Series) -> tuple[pd.Series, str | None]:
    """Simplified tier: the largest county vs all the others pooled, and only when both
    sides have MIN_COUNTY_ZIPS ZIPs; otherwise no county term at all."""
    counts = county.dropna().value_counts().sort_index().sort_values(ascending=False, kind="stable")
    if counts.empty:
        return pd.Series(OTHER_GROUP, index=county.index), OTHER_GROUP
    ref = counts.index[0]
    others = int(len(county) - counts.iloc[0])
    if counts.iloc[0] < MIN_COUNTY_ZIPS or others < MIN_COUNTY_ZIPS:
        return pd.Series(ref, index=county.index), ref
    return county.where(county == ref, OTHER_GROUP), ref


def _describe(filled: pd.DataFrame, county: pd.Series, base_month, peak_months) -> dict:
    """Descriptive tier: rent at the peak vs the latest month, by county and by ZIP. Uses every
    ZIP with a value at the base month, the peak months and the latest month."""
    last = filled.columns[-1]
    need = [base_month, *peak_months, last]
    w = filled.dropna(subset=need)
    peak = w[list(peak_months)].mean(axis=1)
    t = pd.DataFrame({
        "zip_code": w.index,
        "county": county.reindex(w.index).values,
        "base_rent": w[base_month].values,
        "peak_rent": peak.values,
        "latest_rent": w[last].values,
    })
    t["boom_pct"] = (t["peak_rent"] / t["base_rent"] - 1) * 100
    t["change_pct"] = (t["latest_rent"] / t["peak_rent"] - 1) * 100

    def summarize(g):
        return {"zips": int(len(g)), "peak_rent": float(g["peak_rent"].mean()),
                "latest_rent": float(g["latest_rent"].mean()),
                "change_pct": float((g["latest_rent"].mean() / g["peak_rent"].mean() - 1) * 100),
                "boom_pct": float((g["peak_rent"].mean() / g["base_rent"].mean() - 1) * 100)}

    by_county = [{"county": c if isinstance(c, str) else "Unknown county", **summarize(g)}
                 for c, g in t.groupby(t["county"].fillna("Unknown county"))]
    by_county.sort(key=lambda r: r["change_pct"], reverse=True)
    by_zip = t.sort_values("change_pct", ascending=False).round(2)
    by_zip = by_zip.astype(object).where(by_zip.notna(), None).to_dict("records")
    return {"latest_month": str(last), "overall": summarize(t) if len(t) else None,
            "by_county": by_county, "by_zip": by_zip}


def _fit(long, traits, trait_cols, reference, macro_by_month, event_study, small_sample):
    """Two-way FE regression with ZIP-clustered errors. small_sample: p-values and intervals
    from t(G-1), G = number of ZIPs, the standard correction when there are few clusters."""
    z = traits[trait_cols].apply(_zscore)
    z.columns = [f"z_{c}" for c in trait_cols]
    long = long.join(z, on="zip_code").join(traits[["county_group"]], on="zip_code")

    X = pd.DataFrame(index=long.index)
    post_mask = long["post"] == 1
    if event_study:
        long["post_period"] = np.where(post_mask, long["date"].dt.year.astype(str), "pre")
        periods = sorted(p for p in long["post_period"].unique() if p != "pre")
        for p in periods:
            d = (long["post_period"] == p).astype(float)
            for c in trait_cols:
                X[f"post{p}_x_{c}"] = d * long[f"z_{c}"]
    else:
        for c in trait_cols:
            X[f"post_x_{c}"] = long["post"] * long[f"z_{c}"]

    groups = sorted(g for g in long["county_group"].dropna().unique() if g != reference)
    for g in groups:
        X[f"post_x_{county_term(g)}"] = long["post"] * (long["county_group"] == g)

    rate_term = None
    if macro_by_month:
        rates = long["month_year"].map(lambda m: (macro_by_month.get(m) or {}).get("mortgage_rate_30y"))
        rates = pd.to_numeric(rates, errors="coerce")
        if rates.notna().all():
            X["mortgage_rate_x_ln_base_rent"] = (rates - rates.mean()) * long["z_ln_base_rent"]
            rate_term = "mortgage_rate_x_ln_base_rent"

    y = long.set_index(["zip_code", "date"])["ln_rent"]
    X.index = y.index
    X = X.astype(float)

    # linearmodels' default debiased=True (CR1 scaling; p-values from t with df = observations
    # minus parameters, which is close to normal). The small-sample tier keeps the same errors
    # but takes p-values and intervals from t(G-1) below, since the ZIPs are the real sample.
    res = PanelOLS(y, X, entity_effects=True, time_effects=True, drop_absorbed=True).fit(
        cov_type="clustered", cluster_entity=True)

    n_clusters = int(long["zip_code"].nunique())
    ci = res.conf_int()
    coefs = []
    for name in res.params.index:
        b = float(res.params[name])
        se = float(res.std_errors[name])
        if small_sample:
            df_t = n_clusters - 1
            t_stat = b / se
            p = float(2 * stats.t.sf(abs(t_stat), df_t))
            half = float(stats.t.ppf(0.975, df_t)) * se
            lo, hi = b - half, b + half
        else:
            t_stat, p = float(res.tstats[name]), float(res.pvalues[name])
            lo, hi = float(ci.loc[name, "lower"]), float(ci.loc[name, "upper"])
        coefs.append({
            "term": name, "coef": b, "std_err": se, "t_stat": float(t_stat), "p_value": p,
            "ci_low": lo, "ci_high": hi, "pct_effect": (np.exp(b) - 1) * 100,
        })
    return res, coefs, groups, rate_term, long


def _base_month_notes(meta: dict, area_name: str) -> list[str]:
    """Plain-language caveats for the report; empty when the requested base month was used."""
    if not meta.get("base_month_fallback"):
        return []
    used, req = meta["base_month"], meta["base_month_requested"]
    return [f"Zillow's rents for {area_name} start in {used}, so each ZIP's boom and pre-boom rent "
            f"are measured from {used} instead of {req}. That is still before the 2021 run-up, so the "
            f"boom is captured, but rent changes between {req} and {used} are not, and boom sizes "
            f"aren't directly comparable with metros measured from {req}."]


def fit_divergence_model(zori: pd.DataFrame, covariates: pd.DataFrame | None = None,
                         macro_by_month: dict | None = None, spec: str = "full",
                         event_study: bool = False, metro: str = DFW_METRO,
                         area_name: str = "DFW", **window) -> dict:
    """
    spec="base": boom, pre-boom rent level, county group
    spec="full": base + every Census trait with data (ZIPs missing any are dropped and listed)
    event_study=True: separate Post coefficients for each post-peak calendar year, which
                      shows whether a gap is widening, narrowing or stable.
    macro_by_month: {"YYYY-MM": {"mortgage_rate_30y": ...}}; adds the rate x price-tier term.
    metro / area_name: which Zillow metro this is, and its short name for sentences.

    The tier depends on how many ZIPs have complete data (see the module docstring):
      "full"         MIN_ZIPS+ ZIPs: the model above, unchanged
      "simplified"   MIN_SIMPLE_ZIPS..MIN_ZIPS-1: boom + rent level + at most one county term,
                     no Census traits, no rate term, no by-year view; small-sample p-values
      "descriptive"  fewer: no regression; peak vs latest rent by county and ZIP
    Raises NotEnoughZips only when not even a descriptive comparison is possible.
    """
    w = {**{k: DEFAULTS[k] for k in ("start", "end", "base_month", "latest_base_month", "peak_months",
                                     "post_after", "compare_from")},
         **{k: v for k, v in window.items() if v is not None or k == "end"}}
    long, traits, meta = build_model_panel(zori, area_name=area_name, **w)
    filled, county = meta.pop("_filled"), meta.pop("_county")
    cov_note = meta["coverage"]
    base_month = meta["base_month"]   # may differ from w["base_month"] (fallback)
    notes = _base_month_notes(meta, area_name)
    common = {"metro": metro, "area_name": area_name, "available": True, "spec": spec,
              "dependent_variable": "ln(zori_rent)", "panel": meta, "notes": notes}
    n_complete = len(traits)

    # ---- which tier
    unavailable, dropped_missing, trait_cols = [], [], list(RENT_TRAITS)
    full_traits = traits
    if n_complete:
        full_traits = _attach_census(traits, covariates if spec == "full" else None)
        if spec == "full":
            for c in CENSUS_TRAITS:
                if c in full_traits and full_traits[c].notna().sum() >= 10:
                    trait_cols.append(c)
                else:
                    unavailable.append(c)
        missing_mask = full_traits[trait_cols].isna().any(axis=1)
        dropped_missing = sorted(full_traits.index[missing_mask])
        full_traits = full_traits[~missing_mask].copy()

    if len(full_traits) >= MIN_ZIPS:
        tier = "full"
    elif n_complete >= MIN_SIMPLE_ZIPS:
        tier = "simplified"
    else:
        tier = "descriptive"

    # ---- descriptive: compare rents directly
    if tier == "descriptive":
        desc = _describe(filled, county, base_month, w["peak_months"])
        if not desc["overall"]:
            raise NotEnoughZips(
                f"None of the {cov_note['zips_with_rents']} ZIP codes Zillow tracks in {area_name} have rents "
                f"for both {base_month} and the latest month, so there's nothing to compare.")
        return {**common, "tier": "descriptive", "event_study": False, "coefficients": [],
                "n_zips": desc["overall"]["zips"], "descriptive": desc,
                "tier_reason": (f"Only {n_complete} ZIP codes in {area_name} have complete rent histories, too few "
                                f"for a model (it needs at least {MIN_SIMPLE_ZIPS}), so rents are compared directly."),
                "how_to_read": ("Each row compares a ZIP's or county's average rent at the peak "
                                f"({', '.join(w['peak_months'])}) with the latest month. No model is fitted.")}

    # ---- full or simplified: regression
    if tier == "full":
        traits = full_traits
        traits["county_group"], reference = county_groups(traits["county"], metro)
        small_sample, rate_input, es = False, macro_by_month, event_study
    else:
        trait_cols, unavailable = list(RENT_TRAITS), []
        traits = traits.copy()
        traits["county_group"], reference = _small_county_groups(traits["county"])
        small_sample, rate_input, es = True, None, False
        dropped_missing = []
    long = long[long["zip_code"].isin(traits.index)].copy()

    res, coefs, groups, rate_term, long = _fit(long, traits, trait_cols, reference, rate_input, es, small_sample)

    trait_summary = traits[trait_cols].describe().T[["mean", "std", "min", "max"]]
    county_counts = traits["county_group"].value_counts().to_dict()
    n_zips = int(long["zip_code"].nunique())

    result = {
        **common,
        "tier": tier,
        "event_study": es,
        "fixed_effects": ["zip_code", "month"],
        "std_errors": ("clustered by zip_code" if tier == "full" else
                       f"clustered by zip_code, small-sample corrected (t with {n_zips - 1} df)"),
        "reference_county": reference,
        # county term suffix -> county name, e.g. {"collin_county": "Collin County"}
        "county_terms": {county_term(g): g for g in groups},
        "traits_used": trait_cols,
        "traits_unavailable": unavailable,
        "rate_interaction": rate_term,
        "n_obs": int(res.nobs),
        "n_zips": n_zips,
        "zips_by_county_group": {k: int(v) for k, v in county_counts.items()},
        "zips_dropped_missing_covariates": dropped_missing,
        "r2_within": float(res.rsquared_within),
        "coefficients": coefs,
        "trait_summary_raw_units": trait_summary.round(4).reset_index(names="trait").to_dict("records"),
        "how_to_read": ("Each post_x_<trait> coefficient is the change in log rent after the peak "
                        "for a ZIP 1 SD higher on that trait, relative to its own level around "
                        f"the peak ({meta['compare_from']}..{meta['post_after']}) "
                        f"and the month's {area_name}-wide level. pct_effect = (exp(coef)-1)*100. "
                        f"boom = rent at the peak ({', '.join(w['peak_months'])}) vs {base_month}; "
                        f"ln_base_rent = log rent in {base_month}. "
                        + (f"County terms are relative to {reference}." if groups else
                           "All ZIPs are in one county group, so there are no county terms.")),
    }
    if tier == "simplified":
        result["tier_reason"] = (
            f"Only {n_complete} ZIP codes in {area_name} have complete rent histories (the full analysis needs "
            f"{MIN_ZIPS}), so this simplified version looks only at boom size, pre-boom rent"
            + (f" and {reference} vs the other counties" if groups else "")
            + ", with p-values corrected for the small number of ZIP codes.")
    return result
