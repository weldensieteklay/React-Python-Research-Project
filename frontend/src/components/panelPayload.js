// ===========================================================================
// Checks and payload preparation for the panel model endpoints (panel/{method}).
// Pure functions, so they work the same for the dashboard data and any uploaded CSV.
//
// Backend contract (boosting.py / fixedEffect.py):
//   request:  data, id_column, date_column, dependent_variable, independent_variable,
//             categorical_variable, outliers, forecast_periods, trend
//   - every row with a missing value in the target or any predictor is dropped
//   - text predictors must be listed in categorical_variable
//   - the date column must be numbers (years) or dates; one row per (id, date)
// ===========================================================================

const NA_TOKENS = new Set(["", "na", "n/a", "null", "none", "nan", ".", "-"]);

export const isMissing = (v) =>
  v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ||
  (typeof v === "string" && NA_TOKENS.has(v.trim().toLowerCase()));

const isNumericLike = (v) =>
  typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

const pad = (n) => String(n).padStart(2, "0");

/** Dates go to the server as ISO text (YYYY-MM or YYYY-MM-DD) and years stay numbers, so
 *  periods sort correctly and the forecast labels come back in a format the UI can read. */
export function normalizeDate(v) {
  if (isMissing(v) || typeof v === "number") return v;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);             // 2026, 2026.0
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return s;              // already ISO
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;                     // leave it; the server reports it
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const timeValue = (v) => {
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : String(v);
};
const compareTime = (a, b) => {
  const x = timeValue(a), y = timeValue(b);
  return typeof x === typeof y ? (x < y ? -1 : x > y ? 1 : 0) : String(a).localeCompare(String(b));
};

/** Columns among `cols` holding text that isn't a number (e.g. "Dallas County"). */
export function textColumns(rows, cols) {
  return cols.filter((c) => rows.some((r) => !isMissing(r[c]) && !isNumericLike(r[c])));
}

/**
 * Inspect the rows that would be sent and report everything that would make the run fail
 * or quietly lose data. `fill` = predictors will be forward-filled within each ID.
 */
export function checkPanel(rows, { idColumn, dateColumn, dependentVar, predictors, categorical = [], fill = false }) {
  const out = { duplicates: 0, duplicateExample: null, textPredictors: [], missingByColumn: {}, emptyColumns: [],
                rowsUsable: 0, latestPeriod: null, latestUsable: null, latestLost: false };
  if (!idColumn || !dateColumn || !rows.length) return out;

  // one row per (id, date)
  const seen = new Map();
  for (const r of rows) {
    const k = `${r[idColumn]}\u0000${r[dateColumn]}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n === 2) {
      out.duplicates += 1;
      if (!out.duplicateExample) out.duplicateExample = `${idColumn} ${r[idColumn]} at ${r[dateColumn]}`;
    }
  }

  out.textPredictors = textColumns(rows, predictors.filter((c) => !categorical.includes(c)));

  const cols = [dependentVar, ...predictors].filter(Boolean);
  const prepared = fill ? fillForward(rows, idColumn, dateColumn, predictors) : rows;
  for (const c of cols) {
    const n = rows.reduce((s, r) => s + (isMissing(r[c]) ? 1 : 0), 0);
    if (n) out.missingByColumn[c] = n;
    if (n === rows.length) out.emptyColumns.push(c);
  }

  let latest = null, latestUsable = null;
  for (const r of prepared) {
    const d = r[dateColumn];
    if (isMissing(d)) continue;
    if (latest === null || compareTime(d, latest) > 0) latest = d;
    if (cols.every((c) => !isMissing(r[c]))) {
      out.rowsUsable += 1;
      if (latestUsable === null || compareTime(d, latestUsable) > 0) latestUsable = d;
    }
  }
  out.latestPeriod = latest;
  out.latestUsable = latestUsable;
  out.latestLost = latest !== null && latestUsable !== null && compareTime(latest, latestUsable) > 0;
  return out;
}

/** Within each ID, in date order, replace a missing predictor value with the ID's previous
 *  value. Never touches the target. Rows before an ID's first value stay missing. */
export function fillForward(rows, idColumn, dateColumn, predictors) {
  const byId = new Map();
  rows.forEach((r, i) => {
    const k = r[idColumn];
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(i);
  });
  const out = rows.map((r) => ({ ...r }));
  for (const idxs of byId.values()) {
    idxs.sort((a, b) => compareTime(rows[a][dateColumn], rows[b][dateColumn]));
    const last = {};
    for (const i of idxs) {
      for (const c of predictors) {
        if (isMissing(out[i][c])) {
          if (c in last) out[i][c] = last[c];
        } else {
          last[c] = out[i][c];
        }
      }
    }
  }
  return out;
}

/** The rows exactly as they go to the server: only the needed columns, dates normalized,
 *  predictors optionally forward-filled. */
export function buildPanelRows(rows, { idColumn, dateColumn, dependentVar, predictors, fill }) {
  const cols = [...new Set([idColumn, dateColumn, dependentVar, ...predictors])];
  const src = fill ? fillForward(rows, idColumn, dateColumn, predictors) : rows;
  return src.map((r) => {
    const o = {};
    for (const c of cols) o[c] = c === dateColumn ? normalizeDate(r[c]) : r[c];
    return o;
  });
}
