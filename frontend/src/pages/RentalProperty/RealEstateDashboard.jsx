import React, { useEffect, useMemo, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

const panelSx = { border: 1, borderColor: "gray.200", borderRadius: 1 };
const dashedSx = { border: "1px dashed", borderColor: "gray.300", borderRadius: 1 };
const heading4Sx = { fontSize: "0.875rem", fontWeight: 600, mb: 1 };

const PHASE_BANDS = [
  { label: "Recession", min: 0, max: 20, color: "#dc2626" },
  { label: "Early Recovery", min: 20, max: 40, color: "#ea580c" },
  { label: "Mid-Cycle Expansion", min: 40, max: 60, color: "#ca8a04" },
  { label: "Late-Cycle Expansion", min: 60, max: 80, color: "#16a34a" },
  { label: "Overheating", min: 80, max: 100, color: "#2563eb" },
];

function phaseColor(phase) {
  return PHASE_BANDS.find((b) => b.label === phase)?.color || "#6b7280";
}

function CycleScoreGauge({ score }) {
  if (score == null) return null;
  return (
    <Box sx={{ position: "relative", height: 16, borderRadius: 999, overflow: "hidden", display: "flex" }}>
      {PHASE_BANDS.map((b) => (
        <div key={b.label} style={{ width: `${b.max - b.min}%`, backgroundColor: b.color }} />
      ))}
      <Box
        sx={{ position: "absolute", top: "-4px", width: 4, height: 24, bgcolor: "common.black", borderRadius: 0.5 }}
        style={{ left: `calc(${Math.min(Math.max(score, 0), 100)}% - 2px)` }}
        title={`Cycle Score: ${score}`}
      />
    </Box>
  );
}

function CycleScorePanel({ cycleScore }) {
  const [expanded, setExpanded] = useState(false);
  if (!cycleScore) return null;

  const {
    cycle_score, phase, indicators_used, indicators_in_methodology,
    coverage_note, missing_indicators = [], indicator_breakdown = [],
  } = cycleScore;

  const cell = { px: 1.5, py: 0.75 };
  return (
    <Paper variant="outlined" sx={{ mb: 3, borderColor: "gray.200", borderRadius: 2, p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <div>
          <Box sx={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "gray.500" }}>Cycle Score</Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Box component="span" sx={{ fontSize: "2.25rem", fontWeight: 700 }} style={{ color: phaseColor(phase) }}>
              {cycle_score ?? "—"}
            </Box>
            <Box component="span" sx={{ fontSize: "0.875rem", color: "gray.500" }}>/ 100</Box>
          </Box>
          <Box
            sx={{ display: "inline-block", mt: 0.5, px: 1, py: 0.25, borderRadius: 1, fontSize: "0.75rem", fontWeight: 500, color: "common.white" }}
            style={{ backgroundColor: phaseColor(phase) }}
          >
            {phase || "Unknown"}
          </Box>
        </div>

        <Box sx={{ textAlign: "right", fontSize: "0.875rem", color: "gray.600" }}>
          <div>
            Based on <Box component="span" sx={{ fontWeight: 500 }}>{indicators_used}</Box> of{" "}
            <Box component="span" sx={{ fontWeight: 500 }}>{indicators_in_methodology}</Box> methodology indicators
          </div>
          <Link
            component="button"
            onClick={() => setExpanded((e) => !e)}
            underline="always"
            sx={{ color: "blue.600", fontSize: "0.75rem", mt: 0.5 }}
          >
            {expanded ? "Hide breakdown" : "Show breakdown"}
          </Link>
        </Box>
      </Box>

      <Box sx={{ mt: 2 }}>
        <CycleScoreGauge score={cycle_score} />
        <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "gray.500", mt: 0.5 }}>
          {PHASE_BANDS.map((b) => (
            <span key={b.label}>{b.label}</span>
          ))}
        </Box>
      </Box>

      {coverage_note && (
        <Typography variant="caption" component="p" sx={{ color: "gray.500", mt: 1.5 }}>{coverage_note}</Typography>
      )}

      {expanded && (
        <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          <div>
            <Typography variant="h4" sx={heading4Sx}>Indicator Breakdown</Typography>
            <Box sx={{ overflowX: "auto" }}>
              <Box component="table" sx={{ minWidth: "100%", fontSize: "0.875rem", borderCollapse: "collapse", "& th": { ...cell, borderBottom: 1, borderColor: "gray.200" }, "& td": cell, "& tbody tr:not(:last-of-type)": { borderBottom: 1, borderColor: "gray.200" } }}>
                <thead>
                  <Box component="tr" sx={{ bgcolor: "gray.50", textAlign: "left" }}>
                    <th>Indicator</th>
                    <Box component="th" sx={{ textAlign: "right" }}>Raw Value</Box>
                    <Box component="th" sx={{ textAlign: "center" }}>Score (0–5)</Box>
                    <th>Note</th>
                  </Box>
                </thead>
                <tbody>
                  {indicator_breakdown.map((ind) => (
                    <tr key={ind.key}>
                      <td>{ind.label}</td>
                      <Box component="td" sx={{ textAlign: "right", fontFamily: "monospace" }}>
                        {typeof ind.raw_value === "object"
                          ? JSON.stringify(ind.raw_value)
                          : ind.raw_value != null
                          ? Number(ind.raw_value).toFixed(2)
                          : "—"}
                      </Box>
                      <Box component="td" sx={{ textAlign: "center" }}>
                        <Box
                          component="span"
                          sx={{ display: "inline-block", width: 24, height: 24, lineHeight: "24px", borderRadius: 999, color: "common.white", fontSize: "0.75rem", fontWeight: 500 }}
                          style={{
                            backgroundColor:
                              ind.score >= 4 ? "#16a34a" : ind.score >= 2 ? "#ca8a04" : "#dc2626",
                          }}
                        >
                          {ind.score ?? "—"}
                        </Box>
                      </Box>
                      <Box component="td" sx={{ fontSize: "0.75rem", color: "amber.700" }}>{ind.note || ""}</Box>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          </div>

          {missing_indicators.length > 0 && (
            <div>
              <Typography variant="h4" sx={heading4Sx}>
                Excluded from Score ({missing_indicators.length})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
                {missing_indicators.map((m) => (
                  <Box key={m.key} sx={{ ...dashedSx, p: 1, fontSize: "0.75rem" }}>
                    <Box sx={{ fontWeight: 500 }}>{m.label}</Box>
                    <Box sx={{ color: "gray.500", mt: 0.25 }}>{m.reason}</Box>
                  </Box>
                ))}
              </Box>
            </div>
          )}
        </Box>
      )}
    </Paper>
  );
}

export default function MacroIndicatorsDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    handleFetch("data/macro-indicators");
  }, []);

  const automated = data?.automated || {};
  const manualRequired = data?.manual_required || {};
  const failures = data?.failures || {};
  const cycleScore = data?.cycle_score || null;
  const automatedKeys = Object.keys(automated).filter((k) => k !== "credit_conditions_sloos");

  useEffect(() => {
    if (!selectedKey && automatedKeys.length > 0) setSelectedKey(automatedKeys[0]);
  }, [automatedKeys, selectedKey]);

  const chartData = useMemo(() => {
    if (!selectedKey || !automated[selectedKey]?.rows) return [];
    return automated[selectedKey].rows.map((r) => ({
      date: r.date,
      value: r[selectedKey] ?? r.value ?? r.zori ?? r.POP ?? r.UNITSA,
    }));
  }, [selectedKey, automated]);

  if (loading) return <Box sx={{ p: 2, color: "gray.500" }}>Loading macro indicators…</Box>;
  if (error) {
    return (
      <Box sx={{ p: 2, color: "red.600" }}>
        {error}
        <Link component="button" underline="always" onClick={() => handleFetch("data/macro-indicators")} sx={{ ml: 1.5, color: "inherit", fontSize: "inherit", verticalAlign: "baseline" }}>
          Retry
        </Link>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h2" sx={{ fontSize: "1.125rem", fontWeight: 600, mb: 0.5 }}>Harvest Time Capital — Macro Indicators</Typography>
      <Typography variant="body2" sx={{ color: "gray.500", mb: 2 }}>
        {automatedKeys.length} automated indicators · {Object.keys(manualRequired).length} require manual import
      </Typography>

      <CycleScorePanel cycleScore={cycleScore} />

      {Object.keys(failures).length > 0 && (
        <Box sx={{ mb: 2, fontSize: "0.875rem", color: "amber.700", bgcolor: "amber.50", border: 1, borderColor: "amber.200", borderRadius: 1, px: 1.5, py: 1 }}>
          Some sources failed to load: {Object.entries(failures).map(([k, msg]) => `${k} (${msg})`).join(", ")}
        </Box>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(4, minmax(0, 1fr))" }, gap: 2 }}>
        <Box sx={{ gridColumn: { lg: "span 1" }, ...panelSx, overflow: "hidden" }}>
          {automatedKeys.map((key) => (
            <ButtonBase
              key={key}
              onClick={() => setSelectedKey(key)}
              sx={{
                display: "block", width: "100%", textAlign: "left", px: 1.5, py: 1, fontSize: "0.875rem",
                borderBottom: 1, borderColor: "gray.200", "&:last-of-type": { borderBottom: 0 },
                ...(selectedKey === key ? { bgcolor: "blue.50", fontWeight: 500 } : { "&:hover": { bgcolor: "gray.50" } }),
              }}
            >
              {automated[key].label}
              <Box sx={{ fontSize: "0.75rem", color: "gray.400" }}>{automated[key].source}</Box>
            </ButtonBase>
          ))}
        </Box>

        <Box sx={{ gridColumn: { lg: "span 3" }, ...panelSx, p: 2 }}>
          {selectedKey && chartData.length > 0 ? (
            <>
              <Typography variant="h3" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "gray.700", mb: 1.5 }}>
                {automated[selectedKey].label}
              </Typography>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 13 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <Box sx={{ fontSize: "0.875rem", color: "gray.500" }}>Select an indicator.</Box>
          )}
        </Box>
      </Box>

      {automated.credit_conditions_sloos && (
        <Box sx={{ mt: 2, ...panelSx, p: 2 }}>
          <Typography variant="h3" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "gray.700", mb: 1 }}>
            {automated.credit_conditions_sloos.label}
          </Typography>
          <Typography variant="body2" sx={{ color: "gray.600", mb: 1 }}>
            Keyword mentions — tightened: {automated.credit_conditions_sloos.keyword_counts.tightened_mentions},
            {" "}eased: {automated.credit_conditions_sloos.keyword_counts.eased_mentions}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: "gray.400" }}>{automated.credit_conditions_sloos.note}</Typography>
        </Box>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="h3" sx={{ fontSize: "0.875rem", fontWeight: 600, mb: 1 }}>Requires manual import (no free API)</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
          {Object.entries(manualRequired).map(([key, info]) => (
            <Box key={key} sx={{ ...dashedSx, p: 1.5 }}>
              <Box sx={{ fontWeight: 500, fontSize: "0.875rem" }}>{info.label}</Box>
              <Box sx={{ fontSize: "0.75rem", color: "gray.500", mt: 0.5 }}>{info.reason}</Box>
              <Box sx={{ fontSize: "0.75rem", color: "blue.600", mt: 0.5 }}>
                Free proxy already tracked: {info.free_substitute_keys.join(", ")}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
