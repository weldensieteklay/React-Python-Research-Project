import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

const cardSx = { borderColor: "gray.200", borderRadius: 2, p: 3 };
// Segmented control: dark fill on the chosen option
const segmentedSx = {
  bgcolor: "common.white", flexShrink: 0,
  "& .MuiToggleButton-root": {
    px: 1.5, fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.43, textTransform: "none", color: "gray.700", borderColor: "gray.300", borderRadius: 1.5,
    "&:hover": { bgcolor: "gray.50" },
    "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "gray.800", color: "common.white" },
  },
};
const chipSx = { display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, borderRadius: 999, border: 1, fontSize: "0.875rem", transition: "border-color 150ms, background-color 150ms" };
const swatchLine = { width: 12, height: 2, borderRadius: 0.5 };

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
// "All" view: every line grey; the one being pointed at turns blue and comes to the front
const ALL_BASE = "#9ca3af";
const ALL_FADED = "#d1d5db";
const ALL_HIGHLIGHT = "#2a78d6";

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

function ChartTooltip({ active, payload, label, selected, colorOf, data, groupLabel, focus }) {
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
    <Paper variant="outlined" sx={{ borderColor: "gray.200", borderRadius: 1.5, boxShadow: 1, px: 1.5, py: 1, fontSize: "0.875rem" }}>
      <Box sx={{ fontWeight: 600, color: "gray.900", mb: 0.5 }}>
        {monthName(label)}{items.some((i) => i.forecast) ? " (forecast)" : ""}
      </Box>
      {items.map((i) => (
        <Box key={i.g} sx={{ display: "flex", alignItems: "center", gap: 1, ...(focus === i.g ? { color: "blue.800", fontWeight: 600 } : { color: "gray.700" }) }}>
          <Box component="span" sx={swatchLine} style={{ background: colorOf[i.g] }} />
          <Box component="span" sx={{ flex: 1 }}>{shortName(i.g)}</Box>
          <Box component="b" sx={{ fontVariantNumeric: "tabular-nums", color: "gray.900" }}>{usd(i.value)}</Box>
        </Box>
      ))}
      <Box sx={{ fontSize: "0.75rem", color: "gray.400", mt: 0.5 }}>Average of each {groupLabel.toLowerCase()}'s ZIP codes</Box>
    </Paper>
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
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState(null);   // pointed at (All view)
  const [pinned, setPinned] = useState(null);     // clicked (All view)
  const focusGroup = hovered ?? pinned;
  const selected = useMemo(() => (showAll ? groups : groups.filter((g) => colorOf[g])), [groups, colorOf, showAll]);
  // Line colour per group for the current view
  const strokeOf = (g) => (showAll ? (focusGroup === g ? ALL_HIGHLIGHT : focusGroup ? ALL_FADED : ALL_BASE) : colorOf[g]);
  const widthOf = (g) => (showAll ? (focusGroup === g ? 3.5 : 1.75) : 2.5);
  // Draw the highlighted line last so it sits on top
  const drawOrder = showAll && focusGroup ? [...selected.filter((g) => g !== focusGroup), focusGroup] : selected;
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
  const full = !showAll && selected.length >= MAX_LINES;
  const plural = groupLabel === "County" ? "counties" : `${groupLabel.toLowerCase()}s`;

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
    return <Paper variant="outlined" sx={{ ...cardSx, fontSize: "0.875rem", color: "gray.400" }}>No {groupLabel.toLowerCase()} data to chart.</Paper>;
  }

  return (
    <Paper variant="outlined" sx={cardSx}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "flex-start" }, justifyContent: "space-between", gap: 1.5, mb: 1.5 }}>
        <div>
          <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900" }}>Rent over time by {groupLabel.toLowerCase()}</Typography>
          <Typography variant="body2" sx={{ color: "gray.500", mt: 0.25 }}>
            Average monthly rent of each {groupLabel.toLowerCase()}'s ZIP codes, from Zillow.
            {hasForecast ? " Dashed lines are the forecast." : ""} Hover the chart to read every value for a month.
          </Typography>
        </div>
        <ToggleButtonGroup exclusive size="small" aria-label="Time range" value={range}
                           onChange={(_, v) => { if (v != null) setRange(v); }}
                           sx={[segmentedSx, { alignSelf: { xs: "flex-start", md: "auto" }, "& .MuiToggleButton-root": { py: 0.75 } }]}>
          {RANGES.map(([v, text]) => (
            <ToggleButton key={v} value={v}>{text}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Group picker: also the legend */}
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mb: 1 }}>
          <ToggleButtonGroup exclusive size="small" aria-label="Which lines to show" value={showAll}
                             onChange={(_, v) => { if (v != null) { setShowAll(v); setHovered(null); setPinned(null); } }}
                             sx={[segmentedSx, { "& .MuiToggleButton-root": { py: 0.5 } }]}>
            {[[false, `Compare up to ${MAX_LINES}`], [true, `All ${plural}`]].map(([v, text]) => (
              <ToggleButton key={String(v)} value={v}>{text}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Box component="span" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "gray.500", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {showAll ? `Point at a ${groupLabel.toLowerCase()} to highlight its line · click to keep it highlighted` : "Click to add or remove"}
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {groups.map((g) => {
            if (showAll) {
              const on = focusGroup === g;
              return (
                <ButtonBase key={g} aria-pressed={pinned === g}
                        onMouseEnter={() => setHovered(g)} onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(g)} onBlur={() => setHovered(null)}
                        onClick={() => setPinned((p) => (p === g ? null : g))}
                        sx={{ ...chipSx, ...(on ? { bgcolor: "blue.50", borderColor: "blue.400", color: "blue.900", fontWeight: 600 } : { bgcolor: "common.white", borderColor: "gray.300", color: "gray.800", "&:hover": { borderColor: "gray.400" } }) }}>
                  <Box component="span" sx={swatchLine} style={{ background: strokeOf(g) }} />
                  {shortName(g)}
                  {latest[g] && <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", color: "gray.500", fontWeight: 400 }}>{usd(latest[g].rent)}</Box>}
                </ButtonBase>
              );
            }
            const on = Boolean(colorOf[g]);
            const disabled = !on && full;
            return (
              <ButtonBase key={g} onClick={() => toggle(g)} disabled={disabled} aria-pressed={on}
                      title={disabled ? `Remove one to add another (up to ${MAX_LINES} at a time), or choose All ${plural}` : on ? "Click to remove" : "Click to add"}
                      sx={{ ...chipSx,
                        ...(on ? { bgcolor: "common.white", borderColor: "gray.400", color: "gray.900", fontWeight: 600 }
                          : disabled ? { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.300", "&.Mui-disabled": { pointerEvents: "auto", cursor: "not-allowed" } }
                          : { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.600", "&:hover": { borderColor: "gray.400" } }) }}>
                <Box component="span" sx={{ width: 12, height: 12, borderRadius: 999, border: 1 }} style={on ? { background: colorOf[g], borderColor: colorOf[g] } : { borderColor: "#d1d5db" }} />
                {shortName(g)}
                {latest[g] && <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", color: on ? "gray.600" : "gray.400", fontWeight: 400 }}>{usd(latest[g].rent)}</Box>}
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      {selected.length === 0 ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "gray.400", border: "1px dashed", borderColor: "gray.200", borderRadius: 1.5 }} style={{ height }}>
          Pick a {groupLabel.toLowerCase()} above to draw its line.
        </Box>
      ) : (
        <Box sx={{ position: "relative" }} style={{ height }}>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="month" height={X_AXIS_HEIGHT} stroke="#9ca3af" tick={{ fontSize: 14, fill: "#4b5563" }} minTickGap={36}
                     tickFormatter={(m) => (m.endsWith("-01") ? m.slice(0, 4) : monthName(m))} />
              <YAxis domain={axis.domain} ticks={axis.ticks} allowDataOverflow tickFormatter={(v) => `$${v.toLocaleString()}`}
                     stroke="#9ca3af" tick={{ fontSize: 14, fill: "#4b5563" }} width={64} />
              <Tooltip content={<ChartTooltip selected={selected} colorOf={Object.fromEntries(selected.map((g) => [g, strokeOf(g)]))} data={data} groupLabel={groupLabel} focus={showAll ? focusGroup : null} />}
                       cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }} />
              {drawOrder.map((g) => (
                <Line key={g} type="monotone" dataKey={g} name={g} stroke={strokeOf(g)} strokeWidth={widthOf(g)}
                      dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls isAnimationActive={false} />
              ))}
              {drawOrder.map((g) => (
                <Line key={`${g}__f`} type="monotone" dataKey={`${g}__f`} name={`${g} (forecast)`} stroke={strokeOf(g)} strokeWidth={widthOf(g)}
                      strokeDasharray="6 4" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} connectNulls isAnimationActive={false}
                      legendType="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Direct labels at the right end of each line */}
          <Box sx={{ position: "absolute", top: 0, right: 0, pointerEvents: "none" }} style={{ width: MARGIN.right - 8, height }} aria-hidden="true">
            {endLabels.map((l) => (
              <Box key={l.g}
                   onMouseEnter={showAll ? () => setHovered(l.g) : undefined}
                   onMouseLeave={showAll ? () => setHovered(null) : undefined}
                   onClick={showAll ? () => setPinned((p) => (p === l.g ? null : l.g)) : undefined}
                   sx={{ position: "absolute", left: 8, display: "flex", alignItems: "center", gap: 0.75, whiteSpace: "nowrap", transform: "translateY(-50%)",
                         ...(showAll ? { pointerEvents: "auto", cursor: "pointer", fontSize: "15px" } : { fontSize: "0.875rem" }),
                         ...(showAll && focusGroup && focusGroup !== l.g && { opacity: 0.5 }) }}
                   style={{ top: l.y }}>
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0 }} style={{ background: strokeOf(l.g) }} />
                <Box component="span" sx={{ fontWeight: 600, color: showAll && focusGroup === l.g ? "blue.800" : "gray.900" }}>{shortName(l.g)}</Box>
                <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", color: "gray.600", fontStyle: l.forecast ? "italic" : "normal" }}>{l.forecast ? "≈" : ""}{usd(l.v)}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Typography variant="caption" component="p" sx={{ color: "gray.400", mt: 1.5 }}>
        A {groupLabel.toLowerCase()}'s line is the average of its ZIP codes each month. Zillow adds ZIP codes over time,
        so a line can shift slightly when new ZIP codes join the average.
      </Typography>
    </Paper>
  );
}
