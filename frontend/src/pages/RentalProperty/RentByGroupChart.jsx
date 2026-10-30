import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ===========================================================================
// Rent over time by group of ZIP codes (county by default; works for City too), as a line chart.
//
//   <RentByGroupChart rows={gridRows} />
//   <RentByGroupChart rows={gridRows} groupField="City" groupLabel="City" />
//
// rows: ZIP x month rows with month_year, zori_rent, is_forecast and the group field.
// A group's rent in a month = the average rent of its ZIPs that month.
//
// One line per selected group (up to MAX_LINES, picked with the chips; starts with the
// groups that have the most ZIP codes). Forecast months continue each line as a dashed line.
// Each line is labelled at its right end with the name and latest rent, so it never depends
// on telling colours apart. Colours stay with a group while it's selected.
// ===========================================================================

// Validated together (all pairs): blue, yellow, red, aqua. Four lines at most keeps them
// distinguishable, including for colour-blind readers, with the end labels as backup.
const LINE_COLORS = ["#2a78d6", "#eda100", "#e34948", "#1baf7a"];
const MAX_LINES = LINE_COLORS.length;

const RANGES = [
  ["2", "Last 2 years"],
  ["5", "Last 5 years"],
  ["all", "All years"],
];

// Plot geometry, fixed so the end labels can be placed next to their lines
const MARGIN = { top: 12, right: 150, bottom: 8, left: 8 };
const X_AXIS_HEIGHT = 30;
const LABEL_GAP = 17;   // min vertical space between end labels

const usd = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${Math.round(v).toLocaleString()}`);
const shortName = (name) => String(name).replace(/ County$/, "");
const toNum = (v) => (v == null || v === "" ? NaN : Number(v));   // a missing rent must not count as $0
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : String(ym);
};

/** Average rent per group per month: { [group]: { [month]: { avg, zips, forecast } } } */
function aggregate(rows, groupField, valueField) {
  const acc = {};
  for (const r of rows) {
    const g = r[groupField];
    const v = toNum(r[valueField]);
    if (!g || !r.month_year || !Number.isFinite(v)) continue;
    const m = String(r.month_year).slice(0, 7);
    const cell = ((acc[g] ||= {})[m] ||= { sum: 0, zips: 0, forecast: false });
    cell.sum += v;
    cell.zips += 1;
    if (r.is_forecast) cell.forecast = true;
  }
  for (const g of Object.keys(acc)) for (const m of Object.keys(acc[g])) acc[g][m].avg = acc[g][m].sum / acc[g][m].zips;
  return acc;
}

/** Round, even axis: [lo, hi] and 5 ticks */
function niceAxis(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { domain: [0, 1], ticks: [0, 1] };
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  const span = Math.max(hi - lo, 50);
  const step = [25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 5) ?? 1000;
  lo = Math.floor((lo - span * 0.04) / step) * step;
  hi = Math.ceil((hi + span * 0.04) / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
  return { domain: [lo, hi], ticks };
}

function ChartTooltip({ active, payload, label, selected, colorOf, data, groupLabel }) {
  if (!active || !payload?.length) return null;
  const items = selected
    .map((g) => {
      const c = data[g]?.[label];
      return c ? { g, value: c.avg, zips: c.zips, forecast: c.forecast } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-sm">
      <div className="font-semibold text-gray-900 mb-1">
        {monthName(label)}{items.some((i) => i.forecast) ? " (forecast)" : ""}
      </div>
      {items.map((i) => (
        <div key={i.g} className="flex items-center gap-2 text-gray-700">
          <span className="w-3 h-0.5 rounded" style={{ background: colorOf[i.g] }} />
          <span className="flex-1">{shortName(i.g)}</span>
          <b className="tabular-nums text-gray-900">{usd(i.value)}</b>
        </div>
      ))}
      <div className="text-xs text-gray-400 mt-1">Average of each {groupLabel.toLowerCase()}'s ZIP codes</div>
    </div>
  );
}

export default function RentByGroupChart({
  rows,
  groupField = "county",
  groupLabel = "County",
  valueField = "zori_rent",
  height = 420,
}) {
  const data = useMemo(() => aggregate(Array.isArray(rows) ? rows : [], groupField, valueField), [rows, groupField, valueField]);
  const groups = useMemo(() => Object.keys(data).sort((a, b) => a.localeCompare(b)), [data]);
  const months = useMemo(() => {
    const set = new Set();
    for (const g of groups) for (const m of Object.keys(data[g])) set.add(m);
    return [...set].sort();
  }, [data, groups]);

  // Latest actual rent per group (for the chips) and ZIP counts (to pick the defaults)
  const latest = useMemo(() => {
    const out = {};
    for (const g of groups) {
      const ms = Object.keys(data[g]).filter((m) => !data[g][m].forecast).sort();
      const m = ms.at(-1);
      out[g] = m ? { month: m, rent: data[g][m].avg, zips: data[g][m].zips } : null;
    }
    return out;
  }, [data, groups]);
  const defaults = useMemo(
    () => [...groups].sort((a, b) => (latest[b]?.zips ?? 0) - (latest[a]?.zips ?? 0) || a.localeCompare(b)).slice(0, MAX_LINES),
    [groups, latest]
  );

  // Selected groups and their colours. A group keeps its colour while selected.
  const [colorOf, setColorOf] = useState({});
  const selected = useMemo(() => groups.filter((g) => colorOf[g]), [groups, colorOf]);
  useEffect(() => {
    // first load, or the groups changed (different data): start from the defaults
    if (!groups.length) return;
    const valid = Object.keys(colorOf).filter((g) => groups.includes(g));
    if (valid.length === 0) setColorOf(Object.fromEntries(defaults.map((g, i) => [g, LINE_COLORS[i]])));
    else if (valid.length !== Object.keys(colorOf).length) setColorOf(Object.fromEntries(valid.map((g) => [g, colorOf[g]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, defaults]);

  const toggle = (g) => setColorOf((prev) => {
    if (prev[g]) {
      const next = { ...prev };
      delete next[g];
      return next;
    }
    const used = new Set(Object.values(prev));
    const free = LINE_COLORS.find((c) => !used.has(c));
    return free ? { ...prev, [g]: free } : prev;
  });
  const full = selected.length >= MAX_LINES;

  const [range, setRange] = useState("5");
  const shownMonths = useMemo(() => {
    if (range === "all" || !months.length) return months;
    const lastActual = [...months].reverse().find((m) => groups.some((g) => data[g][m] && !data[g][m].forecast)) ?? months.at(-1);
    const [y, mo] = lastActual.split("-").map(Number);
    const from = `${y - Number(range)}-${String(mo).padStart(2, "0")}`;
    return months.filter((m) => m >= from);
  }, [months, range, data, groups]);

  // One row per month: actual value per group, and a forecast value that starts at the
  // last actual month so the dashed line joins the solid one.
  const points = useMemo(() => {
    const pts = shownMonths.map((m) => ({ month: m }));
    for (const g of selected) {
      let lastActualIdx = -1;
      pts.forEach((p, i) => {
        const c = data[g][p.month];
        if (!c) return;
        if (c.forecast) p[`${g}__f`] = Math.round(c.avg);
        else { p[g] = Math.round(c.avg); lastActualIdx = i; }
      });
      if (lastActualIdx >= 0 && pts.slice(lastActualIdx + 1).some((p) => p[`${g}__f`] != null)) {
        pts[lastActualIdx][`${g}__f`] = pts[lastActualIdx][g];
      }
    }
    return pts;
  }, [shownMonths, selected, data]);

  const axis = useMemo(
    () => niceAxis(points.flatMap((p) => selected.flatMap((g) => [p[g], p[`${g}__f`]]))),
    [points, selected]
  );
  const hasForecast = points.some((p) => selected.some((g) => p[`${g}__f`] != null && p[g] == null));

  // End labels: name + last value, placed at the line's height, nudged apart so they never overlap
  const endLabels = useMemo(() => {
    const plotH = height - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;
    const [lo, hi] = axis.domain;
    const items = selected
      .map((g) => {
        const last = [...points].reverse().find((p) => p[g] != null || p[`${g}__f`] != null);
        if (!last) return null;
        const forecast = last[g] == null || (last[`${g}__f`] != null && last[`${g}__f`] !== last[g]);
        const v = last[`${g}__f`] ?? last[g];
        return { g, v, forecast, y: MARGIN.top + (1 - (v - lo) / (hi - lo || 1)) * plotH };
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + LABEL_GAP);
    const maxY = MARGIN.top + plotH;
    for (let i = items.length - 1; i >= 0; i--) {
      const limit = i === items.length - 1 ? maxY : items[i + 1].y - LABEL_GAP;
      items[i].y = Math.min(items[i].y, limit);
    }
    return items;
  }, [selected, points, axis, height]);

  if (!groups.length) {
    return <div className="border border-gray-200 bg-white rounded-lg p-6 text-sm text-gray-400">No {groupLabel.toLowerCase()} data to chart.</div>;
  }

  return (
    <div className="border border-gray-200 bg-white rounded-lg p-6">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Rent over time by {groupLabel.toLowerCase()}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Average monthly rent of each {groupLabel.toLowerCase()}'s ZIP codes, from Zillow.
            {hasForecast ? " Dashed lines are the forecast." : ""} Hover the chart to read every value for a month.
          </p>
        </div>
        <div role="group" aria-label="Time range" className="inline-flex rounded-md border border-gray-300 overflow-hidden bg-white shrink-0">
          {RANGES.map(([v, text]) => (
            <button key={v} onClick={() => setRange(v)} aria-pressed={range === v}
                    className={`px-3 py-1.5 text-sm font-semibold border-r last:border-r-0 border-gray-300 ${range === v ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {/* Group picker: also the legend */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Compare up to {MAX_LINES} {groupLabel === "County" ? "counties" : `${groupLabel.toLowerCase()}s`} · click to add or remove
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const on = Boolean(colorOf[g]);
            const disabled = !on && full;
            return (
              <button key={g} onClick={() => toggle(g)} disabled={disabled} aria-pressed={on}
                      title={disabled ? `Remove one to add another (up to ${MAX_LINES} at a time)` : on ? "Click to remove" : "Click to add"}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm transition-colors ${
                        on ? "bg-white border-gray-400 text-gray-900 font-semibold"
                          : disabled ? "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
                          : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"}`}>
                <span className="w-3 h-3 rounded-full border" style={on ? { background: colorOf[g], borderColor: colorOf[g] } : { borderColor: "#d1d5db" }} />
                {shortName(g)}
                {latest[g] && <span className={`tabular-nums ${on ? "text-gray-600" : "text-gray-400"} font-normal`}>{usd(latest[g].rent)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-md" style={{ height }}>
          Pick a {groupLabel.toLowerCase()} above to draw its line.
        </div>
      ) : (
        <div className="relative" style={{ height }}>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="month" height={X_AXIS_HEIGHT} stroke="#9ca3af" tick={{ fontSize: 12, fill: "#4b5563" }} minTickGap={36}
                     tickFormatter={(m) => (m.endsWith("-01") ? m.slice(0, 4) : monthName(m))} />
              <YAxis domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={(v) => `$${v.toLocaleString()}`}
                     stroke="#9ca3af" tick={{ fontSize: 12, fill: "#4b5563" }} width={64} />
              <Tooltip content={<ChartTooltip selected={selected} colorOf={colorOf} data={data} groupLabel={groupLabel} />}
                       cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }} />
              {selected.map((g) => (
                <Line key={g} type="monotone" dataKey={g} name={g} stroke={colorOf[g]} strokeWidth={2.5}
                      dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls isAnimationActive={false} />
              ))}
              {selected.map((g) => (
                <Line key={`${g}__f`} type="monotone" dataKey={`${g}__f`} name={`${g} (forecast)`} stroke={colorOf[g]} strokeWidth={2.5}
                      strokeDasharray="6 4" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls isAnimationActive={false}
                      legendType="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Direct labels at the right end of each line */}
          <div className="absolute top-0 right-0 pointer-events-none" style={{ width: MARGIN.right - 8, height }} aria-hidden="true">
            {endLabels.map((l) => (
              <div key={l.g} className="absolute left-2 flex items-center gap-1.5 text-sm whitespace-nowrap -translate-y-1/2" style={{ top: l.y }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf[l.g] }} />
                <span className="font-semibold text-gray-900">{shortName(l.g)}</span>
                <span className={`tabular-nums text-gray-600 ${l.forecast ? "italic" : ""}`}>{l.forecast ? "≈" : ""}{usd(l.v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        A {groupLabel.toLowerCase()}'s line is the average of its ZIP codes each month. Zillow adds ZIP codes over time,
        so a line can shift slightly when new ZIP codes join the average.
      </p>
    </div>
  );
}
