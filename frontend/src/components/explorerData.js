// ===========================================================================
// Data Explorer calculations (pure functions, no React)
// ===========================================================================

export const GROUP_LEVELS = [
  { value: "market", label: "All selected ZIPs" },
  { value: "county", label: "County" },
  { value: "City", label: "City" },
  { value: "zip_code", label: "ZIP code" },
];

// Where "drill in" goes from each level
export const NEXT_LEVEL = { county: "City", City: "zip_code" };

export const MEASURES = [
  { value: "level", label: "Level" },
  { value: "index", label: "Index (first month = 100)" },
  { value: "yoy", label: "Year-over-year % change" },
];

const NOT_METRICS = new Set(["zip_code", "year", "fiscal_year", "RegionID", "SizeRank", "months_since_start", "month_of_year"]);

/** Numeric columns that can be charted. */
export function numericColumns(rows, sample = 500) {
  const counts = {};
  for (const r of rows.slice(0, sample)) {
    for (const [k, v] of Object.entries(r)) {
      if (NOT_METRICS.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.keys(counts);
}

const groupKey = (r, groupBy) => (groupBy === "market" ? "All selected ZIPs" : String(r[groupBy] ?? "Unknown"));

/**
 * rows: ZIP x month rows (already filtered). Groups are averaged across their ZIPs each month.
 * balanced: keep only ZIPs with a value in every month of the range, so a group's average
 * doesn't jump when ZIPs enter or leave the data (the composition effect).
 */
export function buildExplorerData(rows, { groupBy = "county", metric = "zori_rent", measure = "level", balanced = true } = {}) {
  const valid = rows.filter((r) => typeof r[metric] === "number" && Number.isFinite(r[metric]) && r.month_year);
  const months = [...new Set(valid.map((r) => r.month_year))].sort();

  let used = valid;
  let droppedZips = 0;
  if (balanced && months.length > 0) {
    const perZip = {};
    for (const r of valid) (perZip[r.zip_code] ||= new Set()).add(r.month_year);
    const complete = new Set(Object.keys(perZip).filter((z) => perZip[z].size === months.length));
    droppedZips = Object.keys(perZip).length - complete.size;
    used = valid.filter((r) => complete.has(String(r.zip_code)));
  }

  // group -> month -> {sum, n}; group -> set of zips
  const acc = {};
  const zipsByGroup = {};
  for (const r of used) {
    const g = groupKey(r, groupBy);
    const cell = ((acc[g] ||= {})[r.month_year] ||= { sum: 0, n: 0 });
    cell.sum += r[metric];
    cell.n += 1;
    (zipsByGroup[g] ||= new Set()).add(r.zip_code);
  }

  const levels = {};   // group -> [{month, value}] in month order (level = mean across ZIPs)
  for (const [g, byMonth] of Object.entries(acc)) {
    levels[g] = months.filter((m) => byMonth[m]).map((m) => ({ month: m, value: byMonth[m].sum / byMonth[m].n }));
  }

  const transform = (series) => {
    if (measure === "index") {
      const base = series[0]?.value;
      return series.map((p) => ({ month: p.month, value: base ? (p.value / base) * 100 : null }));
    }
    if (measure === "yoy") {
      const byMonth = Object.fromEntries(series.map((p) => [p.month, p.value]));
      return series.map((p) => {
        const [y, m] = p.month.split("-");
        const prev = byMonth[`${Number(y) - 1}-${m}`];
        return { month: p.month, value: prev ? (p.value / prev - 1) * 100 : null };
      });
    }
    return series;
  };
  const series = Object.fromEntries(Object.entries(levels).map(([g, s]) => [g, transform(s)]));

  const summary = Object.entries(levels).map(([g, s]) => {
    const first = s[0];
    const last = s[s.length - 1];
    const peak = s.reduce((best, p) => (p.value > best.value ? p : best), s[0]);
    const trough = s.reduce((low, p) => (p.value < low.value ? p : low), s[0]);
    return {
      group: g,
      zips: zipsByGroup[g].size,
      first_month: first?.month,
      first_value: first?.value,
      last_month: last?.month,
      last_value: last?.value,
      change_pct: first?.value ? (last.value / first.value - 1) * 100 : null,
      peak_value: peak?.value,
      peak_month: peak?.month,
      from_peak_pct: peak?.value ? (last.value / peak.value - 1) * 100 : null,
      trough_month: trough?.month,
    };
  });

  return { months, series, summary, zipsUsed: new Set(used.map((r) => r.zip_code)).size, droppedZips };
}

/** Wide rows for a line chart: [{month, [group]: value}] */
export function toChartRows(months, series, groups) {
  return months.map((m) => {
    const row = { month: m };
    for (const g of groups) {
      const p = series[g]?.find((x) => x.month === m);
      row[g] = p?.value != null ? Number(p.value.toFixed(2)) : null;
    }
    return row;
  });
}
