import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import DataFilters, { EMPTY_FILTERS, applyFilters } from "../../components/DataFilters";
import { columnLabel, csvEscape, downloadCsv } from "./utils";
import { GROUP_LEVELS, NEXT_LEVEL, MEASURES, numericColumns, buildExplorerData, toChartRows } from "./explorerData";

const COLORS = ["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#4b5563", "#be185d", "#65a30d", "#0f766e"];
const MAX_LINES = 10;
const FILTER_COLUMNS = ["county", "City", "zip_code"];

const fmtNum = (v, metric) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (metric === "zori_rent" || metric === "median_household_income" || metric === "median_gross_rent_acs")
    return `$${Math.round(v).toLocaleString()}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

const SUMMARY_COLUMNS = [
  { key: "group", label: "Group" },
  { key: "zips", label: "ZIPs", numeric: true },
  { key: "first_value", label: "Start", numeric: true, fmt: "num" },
  { key: "last_value", label: "Latest", numeric: true, fmt: "num" },
  { key: "change_pct", label: "Change", numeric: true, fmt: "pct" },
  { key: "peak_value", label: "Peak", numeric: true, fmt: "num" },
  { key: "peak_month", label: "Peak month" },
  { key: "from_peak_pct", label: "Since peak", numeric: true, fmt: "pct" },
];

export default function DataExplorer({ rows, onBack, censusLoaded = false }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = useState("county");
  const [metric, setMetric] = useState("zori_rent");
  const [measure, setMeasure] = useState("level");
  const [balanced, setBalanced] = useState(true);
  const [shownGroups, setShownGroups] = useState(null);   // null = automatic (largest groups)
  const [sort, setSort] = useState({ key: "zips", dir: "desc" });

  const filtered = useMemo(() => applyFilters(rows, filters, "month_year"), [rows, filters]);
  const metrics = useMemo(() => numericColumns(rows), [rows]);
  const result = useMemo(
    () => buildExplorerData(filtered, { groupBy, metric, measure, balanced }),
    [filtered, groupBy, metric, measure, balanced]
  );

  // Reset the hand-picked lines whenever the grouping changes
  useEffect(() => setShownGroups(null), [groupBy, filters]);

  const sortedSummary = useMemo(() => {
    const out = [...result.summary];
    const { key, dir } = sort;
    out.sort((a, b) => {
      const av = a[key], bv = b[key];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [result.summary, sort]);

  const defaultGroups = useMemo(
    () => [...result.summary].sort((a, b) => b.zips - a.zips).slice(0, groupBy === "zip_code" ? 6 : 8).map((s) => s.group),
    [result.summary, groupBy]
  );
  const groups = useMemo(
    () => (shownGroups ?? defaultGroups).filter((g) => result.series[g]),
    [shownGroups, defaultGroups, result.series]
  );
  const chartRows = useMemo(() => toChartRows(result.months, result.series, groups), [result, groups]);

  const drillIn = (group) => {
    const next = NEXT_LEVEL[groupBy];
    if (!next) return;
    const others = filters.conditions.filter((c) => c.column !== groupBy);
    setFilters({ ...filters, conditions: [...others, { column: groupBy, values: [group] }] });
    setGroupBy(next);
  };

  const exportSummary = () => {
    const lines = [["group_by", ...SUMMARY_COLUMNS.map((c) => c.key), "metric", "zips_balanced_only"].join(",")];
    for (const s of sortedSummary) {
      lines.push([groupBy, ...SUMMARY_COLUMNS.map((c) => s[c.key]), metric, balanced].map(csvEscape).join(","));
    }
    downloadCsv(`dfw_${metric}_by_${groupBy}.csv`, lines);
  };

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const yFormatter = measure === "level" ? (v) => fmtNum(v, metric) : measure === "index" ? (v) => v.toFixed(0) : (v) => `${v.toFixed(0)}%`;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-gray-200 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Explore the DFW rent panel</h1>
          <p className="text-sm text-gray-500 mt-1">Compare markets over time, find where rents peaked and how far they've moved since, then drill into cities and ZIP codes.</p>
        </div>
        {onBack && (
          <button onClick={onBack} className="self-start md:self-auto px-4 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
            📋 Back to Grid
          </button>
        )}
      </div>

      <div className="space-y-4">
        <DataFilters
          rows={rows}
          filters={filters}
          onChange={setFilters}
          columns={FILTER_COLUMNS}
          dateColumn="month_year"
          labels={{ City: "City", county: "County", zip_code: "ZIP code", month_year: "Month" }}
          matchCount={filtered.length}
        />

        <div className="flex flex-wrap items-end gap-4 bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="w-48">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Group by</label>
            <Select options={GROUP_LEVELS} value={GROUP_LEVELS.find((g) => g.value === groupBy)} onChange={(o) => setGroupBy(o.value)} className="text-sm" />
          </div>
          <div className="w-64">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Measure</label>
            <Select
              options={metrics.map((m) => ({ value: m, label: columnLabel(m) }))}
              value={{ value: metric, label: columnLabel(metric) }}
              onChange={(o) => setMetric(o.value)}
              className="text-sm"
            />
          </div>
          <div className="w-56">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Show as</label>
            <Select options={MEASURES} value={MEASURES.find((m) => m.value === measure)} onChange={(o) => setMeasure(o.value)} className="text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2" title="Average only ZIPs observed in every month of the range, so groups don't jump when ZIPs enter the data">
            <input type="checkbox" checked={balanced} onChange={(e) => setBalanced(e.target.checked)} />
            Only ZIPs with complete history
          </label>
        </div>

        {balanced && result.droppedZips > 0 && (
          <div className="text-xs text-gray-500">
            {result.droppedZips} ZIPs left out because they're missing months in this range ({result.zipsUsed} used). Narrow the date range to include more.
          </div>
        )}
        {!censusLoaded && (
          <div className="text-xs text-gray-500">Census measures (income, distance to downtown, new construction) appear in the Measure list once they finish loading.</div>
        )}

        {result.summary.length === 0 ? (
          <div className="p-8 text-center text-gray-400 bg-white border border-gray-200 rounded-lg">No data matches these filters.</div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-md font-bold text-gray-800">
                  {columnLabel(metric)} by {GROUP_LEVELS.find((g) => g.value === groupBy).label.toLowerCase()}
                </h3>
                {groupBy !== "market" && (
                  <Select
                    isMulti
                    className="min-w-[280px] max-w-xl text-sm"
                    options={sortedSummary.map((s) => ({ value: s.group, label: s.group }))}
                    value={groups.map((g) => ({ value: g, label: g }))}
                    onChange={(opts) => setShownGroups((opts ?? []).slice(0, MAX_LINES).map((o) => o.value))}
                    placeholder="Choose lines to show"
                  />
                )}
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartRows} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" stroke="#6b7280" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tickFormatter={yFormatter} stroke="#6b7280" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={70} />
                  {measure === "yoy" && <ReferenceLine y={0} stroke="#9ca3af" />}
                  {measure === "index" && <ReferenceLine y={100} stroke="#9ca3af" />}
                  <Tooltip formatter={(v) => (v == null ? "—" : yFormatter(v))} />
                  <Legend />
                  {groups.map((g, i) => (
                    <Line key={g} type="monotone" dataKey={g} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-400 mt-1">
                Each line is the average across the group's ZIPs in that month. Pick up to {MAX_LINES} lines.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-md font-bold text-gray-800">Peak and change, {result.months[0]} to {result.months[result.months.length - 1]}</h3>
                <button onClick={exportSummary} className="px-3 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">📥 Export table</button>
              </div>
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                      {SUMMARY_COLUMNS.map((c) => (
                        <th key={c.key} onClick={() => toggleSort(c.key)}
                            className={`py-2 pr-4 font-semibold cursor-pointer select-none hover:text-gray-800 ${c.numeric ? "text-right" : ""}`}>
                          {c.label}{sort.key === c.key ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
                        </th>
                      ))}
                      {NEXT_LEVEL[groupBy] && <th className="py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummary.map((s) => (
                      <tr key={s.group} className="border-b border-gray-100 hover:bg-gray-50">
                        {SUMMARY_COLUMNS.map((c) => {
                          const v = s[c.key];
                          const text = c.fmt === "num" ? fmtNum(v, metric) : c.fmt === "pct" ? fmtPct(v) : v;
                          const tone = c.fmt === "pct" && Number.isFinite(v) ? (v < 0 ? "text-red-600" : v > 0 ? "text-emerald-700" : "") : "";
                          return (
                            <td key={c.key} className={`py-1.5 pr-4 ${c.numeric ? "text-right tabular-nums" : ""} ${c.key === "group" ? "font-medium text-gray-900" : "text-gray-700"} ${tone}`}>
                              {text}
                            </td>
                          );
                        })}
                        {NEXT_LEVEL[groupBy] && (
                          <td className="py-1.5 text-right">
                            <button onClick={() => drillIn(s.group)} className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap">
                              Drill in →
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Values are levels of {columnLabel(metric).toLowerCase()} averaged across the group's ZIPs. Click a column to sort.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
