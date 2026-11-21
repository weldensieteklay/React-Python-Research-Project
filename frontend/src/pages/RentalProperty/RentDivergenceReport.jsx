import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useFetchData } from "../../hooks/useFetchData";
import AnalysisModal from "./AnalysisModal";
import BackButton from "./BackButton";
import { traitLabel, parseTerm } from "./utils";
import { coverageText, evidence, interpretDivergence, reportToText } from "./interpretDivergence";
import { DFW_METRO } from "./useRentMetro";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Checkbox from "@mui/material/Checkbox";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { pulse } from "../../theme";

const cardSx = { borderColor: "gray.200", borderRadius: 2 };
const cardTitleSx = { fontSize: "1.125rem", fontWeight: 700, color: "gray.800" };
const howToReadSx = { color: "gray.500", mt: 0.25, mb: 2 };
const noteBoxSx = { fontSize: "0.875rem", bgcolor: "amber.50", border: 1, borderColor: "amber.200", borderRadius: 2, px: 2, py: 1.5, color: "amber.900" };

// Research question: did the 2021-22 rent boom end differently across a metro's ZIPs, and why?
// Reads GET data/dfw-rent-divergence?metro=... (two-way fixed-effects model). Works for any
// metro: county terms and their names come from the response.

const SERIES_COLORS = ["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#4b5563", "#be185d"];

const pct = (b) => (Math.exp(b) - 1) * 100;
const fmtPct = (v, digits = 1) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(digits)}%` : "—");
const fmtP = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));

// Same cut-offs as the written interpretation (interpretDivergence.evidence)
const EVIDENCE_TONES = {
  strong: { bgcolor: "emerald.100", color: "emerald.800" },
  moderate: { bgcolor: "emerald.50", color: "emerald.700" },
  weak: { bgcolor: "amber.50", color: "amber.700" },
  none: { bgcolor: "gray.100", color: "gray.600" },
};
function significance(p) {
  const ev = evidence(p);
  return { label: ev.label, tone: EVIDENCE_TONES[ev.key] };
}

function ExplainButton({ onClick, disabled }) {
  return (
    <Button variant="outlined" onClick={onClick} disabled={disabled}
            sx={{ px: 1.5, py: 0.75, fontSize: "0.875rem", fontWeight: 600, whiteSpace: "nowrap", borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { borderColor: "gray.300", bgcolor: "gray.50" }, "&.Mui-disabled": { opacity: 0.5, borderColor: "gray.300", color: "gray.700" } }}>
      📝 Explain these results
    </Button>
  );
}

/** Horizontal 95% interval on a shared % scale, with a zero line. */
function IntervalBar({ low, high, est, scale }) {
  const pos = (v) => `${((v + scale) / (2 * scale)) * 100}%`;
  const clamp = (v) => Math.max(-scale, Math.min(scale, v));
  const color = low > 0 ? "emerald.600" : high < 0 ? "red.500" : "gray.400";
  return (
    <Box sx={{ position: "relative", height: 16, width: "100%", minWidth: 140 }}>
      <Box sx={{ position: "absolute", top: 0, bottom: 0, width: "1px", bgcolor: "gray.300" }} style={{ left: "50%" }} />
      <Box sx={{ position: "absolute", top: 6, height: 4, borderRadius: 0.5, bgcolor: color }}
           style={{ left: pos(clamp(low)), width: `calc(${pos(clamp(high))} - ${pos(clamp(low))})` }} />
      <Box sx={{ position: "absolute", top: 2, height: 12, width: 4, borderRadius: 0.5, bgcolor: color }} style={{ left: pos(clamp(est)) }} />
    </Box>
  );
}

/** Row label: county terms use the response's county names ("Williamson County (vs Travis County)"). */
function factorName(trait, data) {
  const county = data?.county_terms?.[trait];
  return county ? `${county} (vs ${data.reference_county})` : traitLabel(trait);
}

// Report tables: small-caps header row, light rules between rows; `.num` cells are right-aligned figures
const tableSx = {
  width: "100%", fontSize: "0.875rem", borderCollapse: "collapse",
  "& th, & td": { py: 1, pr: 2, textAlign: "left" },
  "& thead tr": { fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "gray.500", borderBottom: 1, borderColor: "gray.200" },
  "& th": { fontWeight: 600 },
  "& tbody tr": { borderBottom: 1, borderColor: "gray.100" },
  "& .num": { textAlign: "right", fontVariantNumeric: "tabular-nums" },
};

function CoefficientTable({ coefficients, data }) {
  const rows = coefficients.map((c) => ({
    ...c,
    trait: parseTerm(c.term).trait,
    pctLow: pct(c.ci_low),
    pctHigh: pct(c.ci_high),
  }));
  const scale = Math.max(2, ...rows.map((r) => Math.max(Math.abs(r.pctLow), Math.abs(r.pctHigh)))) * 1.05;

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box component="table" sx={tableSx}>
        <thead>
          <tr>
            <th>Factor</th>
            <th className="num">Effect on rent</th>
            <th>95% interval</th>
            <th className="num">p-value</th>
            <Box component="th" sx={{ "&&": { pr: 0 } }}>Reading</Box>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sig = significance(r.p_value);
            return (
              <tr key={r.term}>
                <Box component="td" sx={{ color: "gray.900" }}>{factorName(r.trait, data)}</Box>
                <Box component="td" className="num" sx={{ fontWeight: 600 }}>{fmtPct(r.pct_effect, 2)}</Box>
                <td>
                  <IntervalBar low={r.pctLow} high={r.pctHigh} est={r.pct_effect} scale={scale} />
                  <Box sx={{ fontSize: "13px", color: "gray.400", fontVariantNumeric: "tabular-nums" }}>{fmtPct(r.pctLow)} to {fmtPct(r.pctHigh)}</Box>
                </td>
                <Box component="td" className="num" sx={{ fontFamily: "monospace", color: "gray.700" }}>{fmtP(r.p_value)}</Box>
                <Box component="td" sx={{ "&&": { pr: 0 } }}><Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 1, fontSize: "0.75rem", fontWeight: 500, ...sig.tone }}>{sig.label}</Box></Box>
              </tr>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}

function EventStudyChart({ coefficients }) {
  const { data, traits } = useMemo(() => {
    const byYear = {};
    const traitSet = new Set();
    for (const c of coefficients) {
      const { period, trait } = parseTerm(c.term);
      if (!period || period === "all") continue;
      traitSet.add(trait);
      byYear[period] = { ...(byYear[period] || { year: period }), [trait]: Number(c.pct_effect.toFixed(2)) };
    }
    return { data: Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year)), traits: [...traitSet] };
  }, [coefficients]);

  const [shown, setShown] = useState(() => new Set(["boom", "ln_base_rent"]));
  if (!data.length) return null;
  const toggle = (t) => setShown((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <div>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
        {traits.map((t, i) => (
          <ButtonBase key={t} onClick={() => toggle(t)}
                  sx={{ px: 1.25, py: 0.5, borderRadius: 999, fontSize: "0.75rem", fontWeight: 500, border: 1, transition: "background-color 150ms, color 150ms",
                        ...(shown.has(t) ? { color: "common.white", borderColor: "transparent" } : { bgcolor: "common.white", color: "gray.600", borderColor: "gray.300" }) }}
                  style={shown.has(t) ? { backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] } : undefined}>
            {traitLabel(t)}
          </ButtonBase>
        ))}
      </Box>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="year" stroke="#6b7280" tick={{ fontSize: 13 }} />
          <YAxis tickFormatter={(v) => `${v}%`} stroke="#6b7280" tick={{ fontSize: 13 }} />
          <ReferenceLine y={0} stroke="#9ca3af" />
          <Tooltip formatter={(v, name) => [fmtPct(v, 2), traitLabel(name)]} />
          <Legend formatter={(name) => traitLabel(name)} />
          {traits.filter((t) => shown.has(t)).map((t) => (
            <Line key={t} type="monotone" dataKey={t} stroke={SERIES_COLORS[traits.indexOf(t) % SERIES_COLORS.length]}
                  strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <Typography variant="caption" component="p" sx={{ color: "gray.400", mt: 0.5 }}>Effect per 1 SD of each trait, by post-peak year. A line moving away from 0 means the gap is widening.</Typography>
    </div>
  );
}

const usd = (v) => (Number.isFinite(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");

/** Too few ZIP codes for a model: rent at the peak vs the latest month, by county and by ZIP. */
function DescriptiveTables({ d }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ overflowX: "auto" }}>
        <Box component="table" sx={tableSx}>
          <thead><tr>
            <th>County</th>
            <th className="num">ZIP codes</th>
            <th className="num">Rent at peak</th>
            <th className="num">Rent now</th>
            <th className="num">Change since peak</th>
            <th className="num">Rise during boom</th>
          </tr></thead>
          <tbody>
            {d.by_county.map((c) => (
              <tr key={c.county}>
                <Box component="td" sx={{ color: "gray.900" }}>{c.county}</Box>
                <td className="num">{c.zips}</td>
                <td className="num">{usd(c.peak_rent)}</td>
                <td className="num">{usd(c.latest_rent)}</td>
                <Box component="td" className="num" sx={{ fontWeight: 600 }}>{fmtPct(c.change_pct)}</Box>
                <td className="num">{fmtPct(c.boom_pct)}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      <Box sx={{ overflowX: "auto" }}>
        <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "gray.500", textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.5 }}>Each ZIP code, best held up first</Box>
        <Box component="table" sx={tableSx}>
          <thead><tr>
            <th>ZIP code</th>
            <th>County</th>
            <th className="num">Rent at peak</th>
            <th className="num">Rent now</th>
            <th className="num">Change since peak</th>
          </tr></thead>
          <tbody>
            {d.by_zip.map((z) => (
              <tr key={z.zip_code}>
                <Box component="td" sx={{ fontFamily: "monospace", color: "gray.900" }}>{z.zip_code}</Box>
                <Box component="td" sx={{ color: "gray.700" }}>{z.county ?? "—"}</Box>
                <td className="num">{usd(z.peak_rent)}</td>
                <td className="num">{usd(z.latest_rent)}</td>
                <Box component="td" className="num" sx={{ fontWeight: 600 }}>{fmtPct(z.change_pct)}</Box>
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
    </Box>
  );
}

const TIER_SUBTITLE = {
  full: "Two-way fixed-effects model on monthly ZORI rents (ZIP and month fixed effects, ZIP-clustered errors)",
  simplified: "Simplified fixed-effects model for a metro with few ZIP codes: boom size, pre-boom rent and county, with small-sample p-values",
  descriptive: "Direct comparison of Zillow rents at the peak and now; too few ZIP codes for a model",
};

export default function RentDivergenceReport({ metro = DFW_METRO, areaName = "DFW", onBack, onTrainForecast }) {
  const { data: response, loading, error, handleFetch } = useFetchData();
  const [spec, setSpec] = useState("full");
  const [eventStudy, setEventStudy] = useState(false);

  const path = `data/dfw-rent-divergence?spec=${spec}&event_study=${eventStudy}&metro=${encodeURIComponent(metro)}`;
  useEffect(() => { handleFetch(path); }, [path]);
  // A response for another metro (still arriving after a switch) is never shown
  const data = response && (response.metro ?? DFW_METRO) === metro ? response : null;
  const unavailable = data?.available === false;
  const tier = data?.tier || "full";
  const isFull = tier === "full";
  // The lighter tiers have no Census version and no by-year view
  useEffect(() => { if (data && !isFull && eventStudy) setEventStudy(false); }, [data, isFull, eventStudy]);

  const pooled = useMemo(
    () => (data?.coefficients ?? []).filter((c) => { const p = parseTerm(c.term).period; return p === "all" || p === null; }),
    [data]
  );
  const failures = Object.keys(data?.data_failures ?? {});

  // Results already fetched, keyed by what the response says it is (not by the request),
  // so a slow response can never be filed under the wrong setting.
  const [resultsBySetting, setResultsBySetting] = useState({});
  useEffect(() => {
    if (data?.coefficients) {
      setResultsBySetting((prev) => ({ ...prev, [`${data.metro ?? DFW_METRO}|${data.spec}|${Boolean(data.event_study)}`]: data }));
    }
  }, [data]);

  // Only interpret results that match what's selected right now
  const current = data && data.spec === spec && Boolean(data.event_study) === eventStudy ? data : null;
  const otherSpecData = resultsBySetting[`${metro}|${spec === "full" ? "base" : "full"}|false`] ?? null;

  const [explainFocus, setExplainFocus] = useState(null);   // null | "pooled" | "byYear"
  const report = useMemo(
    () => (current && explainFocus ? interpretDivergence(current, { focus: explainFocus, otherSpecData }) : null),
    [current, explainFocus, otherSpecData]
  );
  const reportText = useMemo(() => (report ? reportToText(report) : ""), [report]);

  return (
    <Box sx={{ p: 3, bgcolor: "gray.50", minHeight: "100vh" }}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "center" }, justifyContent: "space-between", pb: 2, mb: 2, borderBottom: 1, borderColor: "gray.200", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          {onBack && <BackButton onClick={onBack} />}
          <Box sx={{ pt: 0.5 }}>
            <Typography variant="h1" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", letterSpacing: "-0.025em" }}>Did the 2021–22 rent boom end differently across {areaName} ZIPs?</Typography>
            <Typography variant="body2" sx={{ color: "gray.500", mt: 0.5 }}>{TIER_SUBTITLE[tier] ?? TIER_SUBTITLE.full}</Typography>
          </Box>
        </Box>
      {data && !unavailable && !loading && !error && <Box sx={{ display: "flex", flexWrap: { xs: "wrap", md: "nowrap" }, alignItems: "center", gap: 1, alignSelf: { xs: "flex-start", md: "auto" }, whiteSpace: "nowrap" }}>
        {isFull && <>
        <Box sx={{ display: "flex", borderRadius: 1.5, border: 1, borderColor: "gray.300", overflow: "hidden" }}>
          {[["base", "Rent & county only"], ["full", "With Census factors"]].map(([v, label]) => (
            <ButtonBase key={v} onClick={() => setSpec(v)}
                    sx={{ px: 1.5, py: 0.75, fontSize: "0.875rem", fontWeight: 600, ...(spec === v ? { bgcolor: "gray.800", color: "common.white" } : { bgcolor: "common.white", color: "gray.700", "&:hover": { bgcolor: "gray.50" } }) }}>
              {label}
            </ButtonBase>
          ))}
        </Box>
        <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.875rem", color: "gray.700", px: 1 }}>
          <Checkbox size="small" sx={{ p: 0 }} checked={eventStudy} onChange={(e) => setEventStudy(e.target.checked)} />
          By year
        </Box>
        </>}
        {onTrainForecast && (
          <Button variant="contained" color="success" onClick={onTrainForecast} sx={{ px: 2, py: 0.75, fontSize: "0.875rem", fontWeight: 600 }}>
            ⚡ Build your own forecast
          </Button>
        )}
      </Box>}
      </Box>

      {(loading || (!data && !error)) && <Box sx={{ p: 4, textAlign: "center", color: "gray.500", fontWeight: 500, ...pulse }}>Fitting the panel model…</Box>}
      {unavailable && !loading && (
        <Paper variant="outlined" sx={{ ...cardSx, p: 2.5, color: "gray.700" }}>
          <Box component="p" sx={{ fontWeight: 600, color: "gray.900" }}>This analysis isn't available for {areaName}.</Box>
          <Box component="p" sx={{ mt: 0.5 }}>{data.reason}</Box>
          <Box component="p" sx={{ mt: 0.5, color: "gray.500" }}>The rent map, charts and data grid on the dashboard still cover every ZIP code in this metro.</Box>
        </Paper>
      )}
      {error && (
        <Box sx={{ p: 2, bgcolor: "red.50", border: 1, borderColor: "red.200", borderRadius: 2, color: "red.700" }}>
          Error: {error}
          <Link component="button" underline="always" onClick={() => handleFetch(path)} sx={{ ml: 2, fontSize: "inherit", fontWeight: 600, color: "red.900", verticalAlign: "baseline" }}>Retry</Link>
        </Box>
      )}

      {data && !unavailable && !loading && !error && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
            {(tier === "descriptive" ? [
              ["ZIP codes", data.n_zips],
              ["Peak months", data.panel?.peak_months?.join(", ")],
              ["Latest month", data.descriptive?.latest_month],
              ["Change since peak", fmtPct(data.descriptive?.overall?.change_pct)],
            ] : [
              ["ZIP codes", data.n_zips],
              ["Months", data.panel?.months],
              ["Peak comparison", data.panel?.pre_period?.join(" → ")],
              ["Within R²", data.r2_within?.toFixed(3)],
            ]).map(([label, value]) => (
              <Paper key={label} variant="outlined" sx={{ ...cardSx, px: 2, py: 1.5 }}>
                <Box sx={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "gray.500", fontWeight: 600 }}>{label}</Box>
                <Box sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900", fontVariantNumeric: "tabular-nums", mt: 0.25 }}>{value ?? "—"}</Box>
              </Paper>
            ))}
          </Box>

          {!isFull && data.tier_reason && (
            <Box sx={noteBoxSx}>
              {data.tier_reason}
            </Box>
          )}
          {coverageText(data) && <Typography variant="body2" sx={{ color: "gray.500" }}>{coverageText(data)}</Typography>}

          {(failures.length > 0 || data.traits_unavailable?.length > 0) && (
            <Box sx={noteBoxSx}>
              {data.traits_unavailable?.length > 0 && (
                <div>Not included (no data): {data.traits_unavailable.map(traitLabel).join(", ")}.</div>
              )}
              {failures.length > 0 && <Box sx={{ mt: 0.5 }}>Data sources that failed to load: {failures.join(", ")}.</Box>}
            </Box>
          )}

          {tier === "descriptive" ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 3 }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}>
                <Typography variant="h3" sx={cardTitleSx}>Rent at the peak vs now</Typography>
                <ExplainButton onClick={() => setExplainFocus("pooled")} disabled={!current} />
              </Box>
              <Typography variant="caption" component="p" sx={howToReadSx}>{data.how_to_read}</Typography>
              <DescriptiveTables d={data.descriptive} />
            </Paper>
          ) : (
          <Paper variant="outlined" sx={{ ...cardSx, p: 3 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}>
              <Typography variant="h3" sx={cardTitleSx}>{eventStudy ? "Effects that don't vary by year" : "What explains post-peak rents"}</Typography>
              <ExplainButton onClick={() => setExplainFocus("pooled")} disabled={!current || pooled.length === 0} />
            </Box>
            <Typography variant="caption" component="p" sx={howToReadSx}>{data.how_to_read}</Typography>
            <CoefficientTable coefficients={pooled} data={data} />
          </Paper>
          )}

          {isFull && eventStudy && (
            <Paper variant="outlined" sx={{ ...cardSx, p: 3 }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, mb: 1.5 }}>
                <Typography variant="h3" sx={cardTitleSx}>How each effect evolved after the peak</Typography>
                <ExplainButton onClick={() => setExplainFocus("byYear")} disabled={!current} />
              </Box>
              <EventStudyChart coefficients={data.coefficients} />
            </Paper>
          )}

          <Paper variant="outlined" sx={{ ...cardSx, fontSize: "0.75rem", color: "gray.500", px: 2, py: 1.5 }}>
           
          </Paper>
{/* 
          {onTrainForecast && (
            <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" }, justifyContent: "space-between", gap: 1.5, bgcolor: "emerald.50", border: 1, borderColor: "emerald.200", borderRadius: 2, px: 2.5, py: 2 }}>
              <div>
                <Box sx={{ fontSize: "0.875rem", fontWeight: 700, color: "emerald.950" }}>Want to try it yourself?</Box>
                <Typography variant="body2" sx={{ color: "emerald.900", mt: 0.25 }}>
                  Train your own forecast on the same rent data: pick the factors, choose how many months ahead, and see the predicted rents on the dashboard.
                </Typography>
              </div>
              <Button variant="contained" color="success" onClick={onTrainForecast} sx={{ flexShrink: 0, px: 2, py: 1, fontSize: "0.875rem", fontWeight: 600 }}>
                ⚡ Train Forecast Engine
              </Button>
            </Box>
          )} */}
        </Box>
      )}

      <AnalysisModal
        open={Boolean(report)}
        onClose={() => setExplainFocus(null)}
        report={report}
        copyText={reportText}
      />
    </Box>
  );
}
