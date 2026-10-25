// ===========================================================================
// CONFIGURATIONS, LABELS & STATIC TRANSLATION MAPS
// ===========================================================================
export const METHOD_LABELS = {
  fixed: "Fixed Effects",
  random: "Random Effects",
  lasso: "LASSO Regression",
  ridge: "Ridge Regression",
  forest: "Random Forest",
  boosting: "Gradient Boosting",
  bagging: "Bagging Regressor",
};

export const FORECAST_MODE_TEXT = {
  carry_forward: "Economic indicators are held constant at their latest observed values.",
  future_data: "Utilizes external private investor macro scenarios.",
};

export const FACTOR_LABELS = {
  year: "Time Trend (Year)",
  month_year: "Historical Month Matrix",
  real_gdp: "Real GDP Baseline",
  real_gdp_growth: "Real GDP Growth Rate",
  unemployment_rate: "Unemployment Rate",
  unemployment_rate_change: "Unemployment, 12-mo Change",
  unemployment_rate_lag_6m: "Unemployment, 6-mo Lag",
  interest_rate: "Fed Funds Rate",
  interest_rate_change: "Fed Funds, 12-mo Change",
  mortgage_rate_30y: "30-Year Mortgage Rate",
  inflation_rate: "PCE Inflation (YoY)",
  month_of_year: "Calendar Month (seasonality)",
  months_since_start: "Months Since Start (trend)",
  time_index: "Period (model time index)",
  _time_index: "Period (model time index)",
};

// ZIP-level Census traits joined onto the panel (constant across a ZIP's months)
export const CENSUS_LABELS = {
  dist_downtown_mi: "Distance to Downtown (mi)",
  median_household_income: "Median Household Income (2019)",
  renter_share: "Renter Share (2019)",
  pop_density_sqmi: "Population Density (per sq mi)",
  new_build_share: "Share of Homes Built 2020+",
  renter_stock_growth: "Growth in Rented Homes since 2019",
};

export const columnLabel = (name) =>
  name === "zori_rent" ? "Rent (ZORI)" : FACTOR_LABELS[name] || CENSUS_LABELS[name] || humanize(name);

// Labels for the rent-divergence model terms (post_x_<trait>, post<YYYY>_x_<trait>)
export const TRAIT_LABELS = {
  boom: "Boom size (Jan 2020 → peak growth)",
  ln_base_rent: "Pre-boom rent level",
  dist_downtown_mi: "Distance to downtown",
  ln_median_income: "Median household income (2019)",
  renter_share: "Renter share (2019)",
  ln_pop_density: "Population density (2019)",
  renter_stock_growth: "Growth in rented homes since 2019",
  new_build_share: "Share of homes built 2020+",
  collin_county: "Collin County (vs Dallas)",
  denton_county: "Denton County (vs Dallas)",
  tarrant_county: "Tarrant County (vs Dallas)",
  outer_counties: "Outer counties (vs Dallas)",
  mortgage_rate_x_ln_base_rent: "Mortgage rate × pre-boom rent level",
};

export const traitLabel = (key) => TRAIT_LABELS[key] || humanize(key);

/** Splits a model term into {period, trait}. period is "all" for the pooled model,
 *  "YYYY" for event-study terms, null for terms not tied to the post period. */
export const parseTerm = (term) => {
  let m = /^post(\d{4})_x_(.+)$/.exec(term);
  if (m) return { period: m[1], trait: m[2] };
  m = /^post_x_(.+)$/.exec(term);
  if (m) return { period: "all", trait: m[1] };
  return { period: null, trait: term };
};

// ===========================================================================
// VALUE FORMATTERS & DECORATORS
// ===========================================================================
export const currencyFormatter = (params) =>
  params.value != null 
    ? `$${Number(params.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
    : "—";

// The backend sends rates already in percent (4.2 means 4.2%), so no rescaling here.
export const percentFormatter = (digits) => (params) => {
  if (params.value == null || params.value === "") return "—";
  const n = Number(params.value);
  return Number.isFinite(n)
    ? `${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
    : "—";
};

export const decimalFormatter = (digits) => (params) =>
  params.value != null 
    ? Number(params.value).toLocaleString(undefined, { maximumFractionDigits: digits }) 
    : "—";

export const ZORI_GRID_STYLES = `
  .zori-header-forecast { background-color: #ecfdf5 !important; }
  .zori-header-actual { background-color: #f3f4f6 !important; }
  .zori-cell-forecast { background-color: rgba(209, 250, 229, 0.4) !important; font-style: italic; color: #047857; }
`;

// ===========================================================================
// LOW-LEVEL STRING TRANSFORMERS & PARSERS
// ===========================================================================
export const humanize = (name) => {
  const text = String(name).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const factorLabel = (name) => {
  if (name === "entity_id") return "ZIP-Code Specific Alpha Baseline";
  return FACTOR_LABELS[name] || CENSUS_LABELS[name] || humanize(name);
};

export const monthLabel = (period) => String(period).slice(0, 7);

/**
 * Everything the dashboard reads from a model run, taken from the backend response
 * (best.result) with any fields the Redux slice copied onto `best` taking priority.
 * Backend fields (panel boosting / fixed effects): mse, mse_basis, out_of_sample,
 * forecast [{id, period, horizon, predicted, inputs}], forecast_info, forecast_error,
 * data_quality, model_spec, feature_importances_ranked | coefficients + p_values.
 */
export function runDetails(best) {
  const r = best?.result ?? {};
  let factors = best?.factors;
  if (!factors?.items?.length) {
    if (Array.isArray(r.feature_importances_ranked) && r.feature_importances_ranked.length) {
      factors = { type: "importance", items: r.feature_importances_ranked };
    } else if (r.coefficients && typeof r.coefficients === "object") {
      const robust = r.cluster_robust_p_values && !r.cluster_robust_p_values.error ? r.cluster_robust_p_values : null;
      const items = Object.entries(r.coefficients)
        .filter(([k, v]) => k !== "const" && v != null)
        .map(([k, v]) => ({ variable: k, coefficient: v, pValue: robust?.[k] ?? r.p_values?.[k] ?? null }))
        .sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1));
      factors = { type: "coefficient", items };
    }
  }
  return {
    forecast: best?.forecast ?? r.forecast ?? [],
    info: best?.forecastInfo ?? r.forecast_info ?? null,
    forecastError: r.forecast_error ?? null,
    basis: best?.basis ?? r.mse_basis ?? "in_sample",
    testPeriods: r.out_of_sample?.test_periods ?? [],
    holdoutNote: r.out_of_sample?.note ?? null,
    spec: r.model_spec ?? null,
    dataQuality: r.data_quality ?? null,
    dropped: r.dropped_time_invariant_variables ?? null,
    factors: factors ?? { type: null, items: [] },
  };
}

export const joinList = (items) =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export const csvEscape = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const downloadCsv = (filename, lines) => {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
