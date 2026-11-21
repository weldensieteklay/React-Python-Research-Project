import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import DataFilters, { EMPTY_FILTERS, applyFilters } from "../../components/DataFilters";
import { columnLabel, csvEscape, downloadCsv } from "./utils";
import { GROUP_LEVELS, NEXT_LEVEL, MEASURES, numericColumns, buildExplorerData, toChartRows } from "./explorerData";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

const cardSx = { borderColor: "gray.200", borderRadius: 2 };
const fieldLabelSx = { display: "block", fontSize: "0.75rem", fontWeight: 600, color: "gray.500", textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.5 };
const outlineButtonSx = { px: 1.5, py: 0.75, fontSize: "0.875rem", fontWeight: 600, borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { borderColor: "gray.300", bgcolor: "gray.50" } };
const selectStyles = { container: (base) => ({ ...base, fontSize: "0.875rem" }) };

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
    <Box sx={{ p: 3, bgcolor: "gray.50", minHeight: "100vh" }}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "center" }, justifyContent: "space-between", pb: 2, mb: 2, borderBottom: 1, borderColor: "gray.200", gap: 2 }}>
        <div>
          <Typography variant="h1" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", letterSpacing: "-0.025em" }}>Explore the DFW rent panel</Typography>
          <Typography variant="body2" sx={{ color: "gray.500", mt: 0.5 }}>Compare markets over time, find where rents peaked and how far they've moved since, then drill into cities and ZIP codes.</Typography>
        </div>
        {onBack && (
          <Button variant="outlined" onClick={onBack} sx={{ ...outlineButtonSx, px: 2, alignSelf: { xs: "flex-start", md: "auto" } }}>
            📋 Back to Grid
          </Button>
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <DataFilters
          rows={rows}
          filters={filters}
          onChange={setFilters}
          columns={FILTER_COLUMNS}
          dateColumn="month_year"
          labels={{ City: "City", county: "County", zip_code: "ZIP code", month_year: "Month" }}
          matchCount={filtered.length}
        />

        <Paper variant="outlined" sx={{ ...cardSx, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 2, px: 2, py: 1.5 }}>
          <Box sx={{ width: 192 }}>
            <Box component="label" sx={fieldLabelSx}>Group by</Box>
            <Select options={GROUP_LEVELS} value={GROUP_LEVELS.find((g) => g.value === groupBy)} onChange={(o) => setGroupBy(o.value)} styles={selectStyles} />
          </Box>
          <Box sx={{ width: 256 }}>
            <Box component="label" sx={fieldLabelSx}>Measure</Box>
            <Select
              options={metrics.map((m) => ({ value: m, label: columnLabel(m) }))}
              value={{ value: metric, label: columnLabel(metric) }}
              onChange={(o) => setMetric(o.value)}
              styles={selectStyles}
            />
          </Box>
          <Box sx={{ width: 224 }}>
            <Box component="label" sx={fieldLabelSx}>Show as</Box>
            <Select options={MEASURES} value={MEASURES.find((m) => m.value === measure)} onChange={(o) => setMeasure(o.value)} styles={selectStyles} />
          </Box>
          <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.875rem", color: "gray.700", pb: 1 }} title="Average only ZIPs observed in every month of the range, so groups don't jump when ZIPs enter the data">
            <Checkbox size="small" sx={{ p: 0 }} checked={balanced} onChange={(e) => setBalanced(e.target.checked)} />
            Only ZIPs with complete history
          </Box>
        </Paper>

        {balanced && result.droppedZips > 0 && (
          <Typography variant="caption" sx={{ color: "gray.500" }}>
            {result.droppedZips} ZIPs left out because they're missing months in this range ({result.zipsUsed} used). Narrow the date range to include more.
          </Typography>
        )}
        {!censusLoaded && (
          <Typography variant="caption" sx={{ color: "gray.500" }}>Census measures (income, distance to downtown, new construction) appear in the Measure list once they finish loading.</Typography>
        )}

        {result.summary.length === 0 ? (
          <Paper variant="outlined" sx={{ ...cardSx, p: 4, textAlign: "center", color: "gray.400" }}>No data matches these filters.</Paper>
        ) : (
          <>
            <Paper variant="outlined" sx={{ ...cardSx, p: 3 }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1.5, mb: 1.5 }}>
                <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.800" }}>
                  {columnLabel(metric)} by {GROUP_LEVELS.find((g) => g.value === groupBy).label.toLowerCase()}
                </Typography>
                {groupBy !== "market" && (
                  <Select
                    isMulti
                    styles={{ container: (base) => ({ ...base, minWidth: 280, maxWidth: 576, fontSize: "0.875rem" }) }}
                    options={sortedSummary.map((s) => ({ value: s.group, label: s.group }))}
                    value={groups.map((g) => ({ value: g, label: g }))}
                    onChange={(opts) => setShownGroups((opts ?? []).slice(0, MAX_LINES).map((o) => o.value))}
                    placeholder="Choose lines to show"
                  />
                )}
              </Box>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartRows} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" stroke="#6b7280" tick={{ fontSize: 13 }} minTickGap={24} />
                  <YAxis tickFormatter={yFormatter} stroke="#6b7280" tick={{ fontSize: 13 }} domain={["auto", "auto"]} width={70} />
                  {measure === "yoy" && <ReferenceLine y={0} stroke="#9ca3af" />}
                  {measure === "index" && <ReferenceLine y={100} stroke="#9ca3af" />}
                  <Tooltip formatter={(v) => (v == null ? "—" : yFormatter(v))} />
                  <Legend />
                  {groups.map((g, i) => (
                    <Line key={g} type="monotone" dataKey={g} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <Typography variant="caption" component="p" sx={{ color: "gray.400", mt: 0.5 }}>
                Each line is the average across the group's ZIPs in that month. Pick up to {MAX_LINES} lines.
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ ...cardSx, p: 3 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
                <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.800" }}>Peak and change, {result.months[0]} to {result.months[result.months.length - 1]}</Typography>
                <Button variant="outlined" onClick={exportSummary} sx={outlineButtonSx}>📥 Export table</Button>
              </Box>
              <Box sx={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                <Box component="table" sx={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                  <Box component="thead" sx={{ position: "sticky", top: 0, bgcolor: "common.white" }}>
                    <Box component="tr" sx={{ textAlign: "left", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "gray.500", borderBottom: 1, borderColor: "gray.200" }}>
                      {SUMMARY_COLUMNS.map((c) => (
                        <Box component="th" key={c.key} onClick={() => toggleSort(c.key)}
                            sx={{ py: 1, pr: 2, fontWeight: 600, cursor: "pointer", userSelect: "none", textAlign: c.numeric ? "right" : "left", "&:hover": { color: "gray.800" } }}>
                          {c.label}{sort.key === c.key ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
                        </Box>
                      ))}
                      {NEXT_LEVEL[groupBy] && <Box component="th" sx={{ py: 1 }} />}
                    </Box>
                  </Box>
                  <tbody>
                    {sortedSummary.map((s) => (
                      <Box component="tr" key={s.group} sx={{ borderBottom: 1, borderColor: "gray.100", "&:hover": { bgcolor: "gray.50" } }}>
                        {SUMMARY_COLUMNS.map((c) => {
                          const v = s[c.key];
                          const text = c.fmt === "num" ? fmtNum(v, metric) : c.fmt === "pct" ? fmtPct(v) : v;
                          const tone = c.fmt === "pct" && Number.isFinite(v) ? (v < 0 ? { color: "red.600" } : v > 0 ? { color: "emerald.700" } : {}) : {};
                          return (
                            <Box component="td" key={c.key}
                                 sx={{ py: 0.75, pr: 2, ...(c.numeric && { textAlign: "right", fontVariantNumeric: "tabular-nums" }), ...(c.key === "group" ? { fontWeight: 500, color: "gray.900" } : { color: "gray.700" }), ...tone }}>
                              {text}
                            </Box>
                          );
                        })}
                        {NEXT_LEVEL[groupBy] && (
                          <Box component="td" sx={{ py: 0.75, textAlign: "right" }}>
                            <Link component="button" underline="hover" onClick={() => drillIn(s.group)} sx={{ fontSize: "0.75rem", fontWeight: 600, color: "blue.700", whiteSpace: "nowrap" }}>
                              Drill in →
                            </Link>
                          </Box>
                        )}
                      </Box>
                    ))}
                  </tbody>
                </Box>
              </Box>
              <Typography variant="caption" component="p" sx={{ color: "gray.400", mt: 1 }}>
                Values are levels of {columnLabel(metric).toLowerCase()} averaged across the group's ZIPs. Click a column to sort.
              </Typography>
            </Paper>
          </>
        )}
      </Box>
    </Box>
  );
}
