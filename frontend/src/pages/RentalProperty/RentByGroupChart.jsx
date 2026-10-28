import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";

// ===========================================================================
// Rent chart for groups of ZIP codes (county by default; works for City too).
//
//   <RentByGroupChart rows={gridRows} />                                  // by county
//   <RentByGroupChart rows={gridRows} groupField="City" groupLabel="City" />
//
// rows: ZIP x month rows with month_year, zori_rent, is_forecast and the group field.
// A group's rent in a month = the average rent of its ZIPs that month.
//
// Dropdown "All": one bar per group for a chosen month (rent on the y axis, group on the x axis).
// Dropdown one group: that group's average rent over time, actual and forecast.
// ===========================================================================

const ALL = "__all__";
const ACTUAL = "#059669";
const FORECAST = "#d97706";

const usd = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${Math.round(v).toLocaleString()}`);
const shortName = (name) => String(name).replace(/ County$/, "");

/** Average rent per group per month: { [group]: { [month]: { avg, zips, forecast } } } */
function aggregate(rows, groupField, valueField) {
  const acc = {};
  for (const r of rows) {
    const g = r[groupField];
    const v = Number(r[valueField]);
    if (!g || !r.month_year || !Number.isFinite(v)) continue;
    const m = String(r.month_year).slice(0, 7);
    const cell = ((acc[g] ||= {})[m] ||= { sum: 0, zips: 0, forecast: false });
    cell.sum += v;
    cell.zips += 1;
    if (r.is_forecast) cell.forecast = true;
  }
  for (const g of Object.keys(acc)) {
    for (const m of Object.keys(acc[g])) {
      const c = acc[g][m];
      c.avg = c.sum / c.zips;
    }
  }
  return acc;
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload.find((x) => x.value != null);
  if (!p) return null;
  const isForecast = p.dataKey === "forecast_rent";
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-xs">
      <div className="font-semibold text-gray-900">{label}</div>
      <div style={{ color: isForecast ? FORECAST : ACTUAL }}>
        {isForecast ? "Forecast" : "Average rent"}: <b>{usd(p.value)}</b>
      </div>
      <div className="text-gray-500">{p.payload.zips} ZIP{p.payload.zips === 1 ? "" : "s"} averaged</div>
    </div>
  );
}

function BarTooltip({ active, payload, groupLabel }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-xs">
      <div className="font-semibold text-gray-900">{d.group}</div>
      <div>{d.forecast ? "Forecast average rent" : "Average rent"}: <b>{usd(d.avg)}</b></div>
      <div className="text-gray-500">{d.zips} ZIP{d.zips === 1 ? "" : "s"} in this {groupLabel.toLowerCase()}</div>
    </div>
  );
}

export default function RentByGroupChart({
  rows,
  groupField = "county",
  groupLabel = "County",
  valueField = "zori_rent",
  height = 400,
}) {
  const data = useMemo(() => aggregate(Array.isArray(rows) ? rows : [], groupField, valueField), [rows, groupField, valueField]);
  const groups = useMemo(() => Object.keys(data).sort((a, b) => a.localeCompare(b)), [data]);
  const months = useMemo(() => {
    const set = new Set();
    for (const g of groups) for (const m of Object.keys(data[g])) set.add(m);
    return [...set].sort();
  }, [data, groups]);
  const forecastMonths = useMemo(
    () => new Set(months.filter((m) => groups.some((g) => data[g][m]?.forecast))),
    [data, groups, months]
  );
  const latestActual = useMemo(() => [...months].reverse().find((m) => !forecastMonths.has(m)) ?? months.at(-1), [months, forecastMonths]);

  const [selected, setSelected] = useState(ALL);
  const [month, setMonth] = useState("");
  useEffect(() => { if (!month || !months.includes(month)) setMonth(latestActual || ""); }, [latestActual, months, month]);
  useEffect(() => { if (selected !== ALL && !groups.includes(selected)) setSelected(ALL); }, [groups, selected]);

  // One group over time
  const trend = useMemo(() => {
    if (selected === ALL || !data[selected]) return [];
    const points = months
      .filter((m) => data[selected][m])
      .map((m) => {
        const c = data[selected][m];
        return {
          month: m,
          zips: c.zips,
          actual_rent: c.forecast ? null : Math.round(c.avg),
          forecast_rent: c.forecast ? Math.round(c.avg) : null,
        };
      });
    // Start the dashed forecast line at the last actual month so the two lines join
    const lastActual = points.map((p) => p.actual_rent != null).lastIndexOf(true);
    if (lastActual >= 0 && points.slice(lastActual + 1).some((p) => p.forecast_rent != null)) {
      points[lastActual] = { ...points[lastActual], forecast_rent: points[lastActual].actual_rent };
    }
    return points;
  }, [selected, data, months]);

  // All groups in one month
  const bars = useMemo(() => {
    if (selected !== ALL || !month) return [];
    return groups
      .filter((g) => data[g][month])
      .map((g) => ({ group: g, short: shortName(g), avg: Math.round(data[g][month].avg), zips: data[g][month].zips, forecast: data[g][month].forecast }))
      .sort((a, b) => b.avg - a.avg);
  }, [selected, month, groups, data]);

  if (!groups.length) {
    return <div className="border border-gray-200 bg-white rounded-lg p-6 text-sm text-gray-400">No {groupLabel.toLowerCase()} data to chart.</div>;
  }

  const isAll = selected === ALL;
  const monthIsForecast = forecastMonths.has(month);
  const zipsInGroup = isAll ? null : trend.at(-1)?.zips;

  return (
    <div className="border border-gray-200 bg-white rounded-lg p-6">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-md font-bold text-gray-800">
            {isAll
              ? `Average rent by ${groupLabel.toLowerCase()}, ${month}${monthIsForecast ? " (forecast)" : ""}`
              : `Average rent over time: ${selected}`}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {isAll
              ? `Each bar is the average Zillow rent of the ${groupLabel.toLowerCase()}'s ZIP codes in that month. Hover a bar for the number of ZIPs.`
              : `Average Zillow rent of the ${groupLabel.toLowerCase()}'s ZIP codes each month${zipsInGroup ? ` (${zipsInGroup} ZIPs in the latest month)` : ""}. The number of ZIPs can change over time as Zillow adds coverage.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{groupLabel}:</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
                    className="border border-gray-300 bg-white rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none">
              <option value={ALL}>All</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          {isAll && (
            <label className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Month:</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                      className="border border-gray-300 bg-white rounded-md px-3 py-1.5 text-sm font-mono font-medium focus:outline-none">
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>{m}{forecastMonths.has(m) ? " (forecast)" : ""}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {isAll ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={bars} margin={{ top: 24, right: 20, bottom: 50, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="short" stroke="#6b7280" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end"
                   label={{ value: groupLabel, position: "insideBottom", offset: -40, fill: "#6b7280", fontSize: 12 }} />
            <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} stroke="#6b7280" tick={{ fontSize: 11 }}
                   label={{ value: "Average rent", angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 12 }} />
            <Tooltip content={<BarTooltip groupLabel={groupLabel} />} cursor={{ fill: "#f3f4f6" }} />
            <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
              {bars.map((b) => <Cell key={b.group} fill={b.forecast ? FORECAST : ACTUAL} />)}
              <LabelList dataKey="avg" position="top" formatter={(v) => usd(v)} style={{ fontSize: 10, fill: "#374151" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={trend} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" stroke="#6b7280" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} stroke="#6b7280" tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip content={<TrendTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="actual_rent" name="Average rent (Zillow)" stroke={ACTUAL} strokeWidth={3} dot={false} connectNulls />
            <Line type="monotone" dataKey="forecast_rent" name="Forecast" stroke={FORECAST} strokeWidth={3} strokeDasharray="5 5" dot={{ r: 3, fill: FORECAST }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}

      {isAll && bars.some((b) => b.zips < 3) && (
        <p className="text-xs text-gray-400 mt-2">
          Some {groupLabel.toLowerCase()} averages use fewer than 3 ZIP codes; hover a bar to see how many.
        </p>
      )}
    </div>
  );
}
