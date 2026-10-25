"""
services/rent_divergence_model.py

Research question: did the 2021-22 rent boom end differently across DFW ZIP codes,
and what explains the difference?

Two-way fixed-effects panel model on monthly ZORI rents:

    ln(rent_it) = a_i + g_t + SUM_k b_k (Post_t x Z_ik) + SUM_c d_c (Post_t x County_ic)
                  [+ e (MortgageRate_t x ZlnBaseRent_i)] + u_it

  a_i   ZIP fixed effect   - permanent differences between ZIPs
  g_t   month fixed effect - everything common to DFW in a month (boom, rates, seasonality)
  Post  1 for months after the market peak (default: after 2022-08)
  Z_ik  standardized ZIP traits (1 SD units):
          boom, ln_base_rent                                      (from rents)
          dist_downtown_mi, ln_median_income, renter_share,
          ln_pop_density, renter_stock_growth, new_build_share    (from Census)

b_k reads as: after the peak, a ZIP one standard deviation higher on trait k had rents
(exp(b_k) - 1) x 100 percent higher/lower, relative to its own level around the peak
(compare_from .. post_after, default Mar-Aug 2022) and to the month's DFW-wide level.
Standard errors are clustered by ZIP. The months from `start` to `compare_from` are
used only to measure each ZIP's boom and starting rent, not in the regression.

Run on a balanced panel (ZIPs observed in every month of the window) so ZIPs entering
the Zillow data mid-window don't create composition effects.
"""

import numpy as np
import pandas as pd
from linearmodels.panel import PanelOLS


CORE_COUNTIES = {"Dallas County", "Tarrant County", "Collin County", "Denton County"}
REFERENCE_COUNTY = "Dallas County"
OUTER_GROUP = "Outer counties"

RENT_TRAITS = ["boom", "ln_base_rent"]
CENSUS_TRAITS = [
    "dist_downtown_mi", "ln_median_income", "renter_share",
    "ln_pop_density", "renter_stock_growth", "new_build_share",
]

DEFAULTS = {
    "start": "2020-01",
    "end": None,
    "base_month": "2020-01",
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


def build_model_panel(zori: pd.DataFrame, start=DEFAULTS["start"], end=DEFAULTS["end"],
                      base_month=DEFAULTS["base_month"], peak_months=DEFAULTS["peak_months"],
                      post_after=DEFAULTS["post_after"], compare_from=DEFAULTS["compare_from"]):
    """Returns (long panel restricted to the comparison window, one-row-per-ZIP traits,
    metadata). Balance is required over the whole window from `start`."""
    if not (start <= base_month < compare_from <= post_after):
        raise ValueError("Months must satisfy start <= base_month < compare_from <= post_after")
    df = _clean_panel(zori)
    df = df[df["month_year"] >= start]
    if end:
        df = df[df["month_year"] <= end]

    wide = df.pivot_table(index="zip_code", columns="month_year", values="zori_rent")
    for m in [base_month, *peak_months]:
        if m not in wide.columns:
            raise ValueError(f"Month {m} is not in the panel window {start}..{end or 'latest'}")
    balanced = wide.dropna()
    if balanced.empty:
        raise ValueError("No ZIP has a complete history over the window; shorten the window.")

    base = balanced[base_month]
    peak = balanced[list(peak_months)].mean(axis=1)
    traits = pd.DataFrame({
        "boom": peak / base - 1,
        "ln_base_rent": np.log(base),
    })
    county = df.drop_duplicates("zip_code").set_index("zip_code")["county"]
    traits["county"] = county.reindex(traits.index)
    traits["county_group"] = traits["county"].where(traits["county"].isin(CORE_COUNTIES), OUTER_GROUP)
    traits.index.name = "zip_code"

    long = df[df["zip_code"].isin(balanced.index) & (df["month_year"] >= compare_from)].copy()
    if (long["month_year"] > post_after).sum() == 0:
        raise ValueError(f"No months after post_after={post_after} in the window")
    long["date"] = pd.to_datetime(long["month_year"])
    long["post"] = (long["month_year"] > post_after).astype(int)
    long["ln_rent"] = np.log(long["zori_rent"])

    meta = {
        "window": [long["month_year"].min(), long["month_year"].max()],
        "months": int(long["month_year"].nunique()),
        "base_month": base_month,
        "peak_months": list(peak_months),
        "post_after": post_after,
        "compare_from": compare_from,
        "pre_period": [compare_from, post_after],
        "zips_in_window": int(len(wide)),
        "zips_balanced": int(len(balanced)),
        "zips_dropped_incomplete": sorted(set(wide.index) - set(balanced.index)),
    }
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


def fit_divergence_model(zori: pd.DataFrame, covariates: pd.DataFrame | None = None,
                         macro_by_month: dict | None = None, spec: str = "full",
                         event_study: bool = False, **window) -> dict:
    """
    spec="base": boom, pre-boom rent level, county group
    spec="full": base + every Census trait with data (ZIPs missing any are dropped and listed)
    event_study=True: separate Post coefficients for each post-peak calendar year, which
                      shows whether a gap is widening, narrowing or stable.
    macro_by_month: {"YYYY-MM": {"mortgage_rate_30y": ...}}; adds the rate x price-tier term.
    """
    long, traits, meta = build_model_panel(zori, **window)
    traits = _attach_census(traits, covariates if spec == "full" else None)

    trait_cols = list(RENT_TRAITS)
    unavailable = []
    if spec == "full":
        for c in CENSUS_TRAITS:
            if c in traits and traits[c].notna().sum() >= 10:
                trait_cols.append(c)
            else:
                unavailable.append(c)

    missing_mask = traits[trait_cols].isna().any(axis=1)
    dropped_missing = sorted(traits.index[missing_mask])
    traits = traits[~missing_mask].copy()
    long = long[long["zip_code"].isin(traits.index)].copy()

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

    groups = sorted(g for g in long["county_group"].dropna().unique() if g != REFERENCE_COUNTY)
    for g in groups:
        X[f"post_x_{g.lower().replace(' ', '_')}"] = long["post"] * (long["county_group"] == g)

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

    res = PanelOLS(y, X, entity_effects=True, time_effects=True, drop_absorbed=True).fit(
        cov_type="clustered", cluster_entity=True)

    ci = res.conf_int()
    coefs = []
    for name in res.params.index:
        b = float(res.params[name])
        coefs.append({
            "term": name,
            "coef": b,
            "std_err": float(res.std_errors[name]),
            "t_stat": float(res.tstats[name]),
            "p_value": float(res.pvalues[name]),
            "ci_low": float(ci.loc[name, "lower"]),
            "ci_high": float(ci.loc[name, "upper"]),
            "pct_effect": (np.exp(b) - 1) * 100,
        })

    trait_summary = traits[trait_cols].describe().T[["mean", "std", "min", "max"]]
    county_counts = traits["county_group"].value_counts().to_dict()

    return {
        "spec": spec,
        "event_study": event_study,
        "dependent_variable": "ln(zori_rent)",
        "fixed_effects": ["zip_code", "month"],
        "std_errors": "clustered by zip_code",
        "reference_county": REFERENCE_COUNTY,
        "traits_used": trait_cols,
        "traits_unavailable": unavailable,
        "rate_interaction": rate_term,
        "n_obs": int(res.nobs),
        "n_zips": int(long["zip_code"].nunique()),
        "zips_by_county_group": {k: int(v) for k, v in county_counts.items()},
        "zips_dropped_missing_covariates": dropped_missing,
        "r2_within": float(res.rsquared_within),
        "coefficients": coefs,
        "trait_summary_raw_units": trait_summary.round(4).reset_index(names="trait").to_dict("records"),
        "panel": meta,
        "how_to_read": ("Each post_x_<trait> coefficient is the change in log rent after the peak "
                        "for a ZIP 1 SD higher on that trait, relative to its own level around "
                        f"the peak ({meta['compare_from']}..{meta['post_after']}) "
                        "and the month's DFW-wide level. pct_effect = (exp(coef)-1)*100. County "
                        f"terms are relative to {REFERENCE_COUNTY}."),
    }
