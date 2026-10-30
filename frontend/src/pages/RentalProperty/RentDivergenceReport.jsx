import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useFetchData } from "../../hooks/useFetchData";
import AnalysisModal from "./AnalysisModal";
import BackButton from "./BackButton";
import { traitLabel, parseTerm } from "./utils";
import { evidence, interpretDivergence, reportToText } from "./interpretDivergence";

// Research question: did the 2021-22 rent boom end differently across DFW ZIPs, and why?
// Reads GET data/dfw-rent-divergence (two-way fixed-effects model).

const SERIES_COLORS = ["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#4b5563", "#be185d"];

const pct = (b) => (Math.exp(b) - 1) * 100;
const fmtPct = (v, digits = 1) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(digits)}%` : "—");
const fmtP = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));

// Same cut-offs as the written interpretation (interpretDivergence.evidence)
const EVIDENCE_CLASSES = {
  strong: "bg-emerald-100 text-emerald-800",
  moderate: "bg-emerald-50 text-emerald-700",
  weak: "bg-amber-50 text-amber-700",
  none: "bg-gray-100 text-gray-600",
};
function significance(p) {
  const ev = evidence(p);
  return { label: ev.label, cls: EVIDENCE_CLASSES[ev.key] };
}

function ExplainButton({ onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
            className="px-3 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
      📝 Explain these results
    </button>
  );
}

/** Horizontal 95% interval on a shared % scale, with a zero line. */
function IntervalBar({ low, high, est, scale }) {
  const pos = (v) => `${((v + scale) / (2 * scale)) * 100}%`;
  const clamp = (v) => Math.max(-scale, Math.min(scale, v));
  const color = low > 0 ? "bg-emerald-600" : high < 0 ? "bg-red-500" : "bg-gray-400";
  return (
    <div className="relative h-4 w-full min-w-[140px]">
      <div className="absolute inset-y-0 w-px bg-gray-300" style={{ left: "50%" }} />
      <div className={`absolute top-1.5 h-1 rounded ${color}`}
           style={{ left: pos(clamp(low)), width: `calc(${pos(clamp(high))} - ${pos(clamp(low))})` }} />
      <div className={`absolute top-0.5 h-3 w-1 rounded ${color}`} style={{ left: pos(clamp(est)) }} />
    </div>
  );
}

function CoefficientTable({ coefficients }) {
  const rows = coefficients.map((c) => ({
    ...c,
    trait: parseTerm(c.term).trait,
    pctLow: pct(c.ci_low),
    pctHigh: pct(c.ci_high),
  }));
  const scale = Math.max(2, ...rows.map((r) => Math.max(Math.abs(r.pctLow), Math.abs(r.pctHigh)))) * 1.05;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-4 font-semibold">Factor</th>
            <th className="py-2 pr-4 font-semibold text-right">Effect on rent</th>
            <th className="py-2 pr-4 font-semibold">95% interval</th>
            <th className="py-2 pr-4 font-semibold text-right">p-value</th>
            <th className="py-2 font-semibold">Reading</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sig = significance(r.p_value);
            return (
              <tr key={r.term} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-900">{traitLabel(r.trait)}</td>
                <td className="py-2 pr-4 text-right tabular-nums font-semibold">{fmtPct(r.pct_effect, 2)}</td>
                <td className="py-2 pr-4">
                  <IntervalBar low={r.pctLow} high={r.pctHigh} est={r.pct_effect} scale={scale} />
                  <div className="text-[11px] text-gray-400 tabular-nums">{fmtPct(r.pctLow)} to {fmtPct(r.pctHigh)}</div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-mono text-gray-700">{fmtP(r.p_value)}</td>
                <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${sig.cls}`}>{sig.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
      <div className="flex flex-wrap gap-2 mb-3">
        {traits.map((t, i) => (
          <button key={t} onClick={() => toggle(t)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${shown.has(t) ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-300"}`}
                  style={shown.has(t) ? { backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] } : undefined}>
            {traitLabel(t)}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="year" stroke="#6b7280" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => `${v}%`} stroke="#6b7280" tick={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="#9ca3af" />
          <Tooltip formatter={(v, name) => [fmtPct(v, 2), traitLabel(name)]} />
          <Legend formatter={(name) => traitLabel(name)} />
          {traits.filter((t) => shown.has(t)).map((t) => (
            <Line key={t} type="monotone" dataKey={t} stroke={SERIES_COLORS[traits.indexOf(t) % SERIES_COLORS.length]}
                  strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 mt-1">Effect per 1 SD of each trait, by post-peak year. A line moving away from 0 means the gap is widening.</p>
    </div>
  );
}

export default function RentDivergenceReport({ onBack, onTrainForecast }) {
  const { data, loading, error, handleFetch } = useFetchData();
  const [spec, setSpec] = useState("full");
  const [eventStudy, setEventStudy] = useState(false);

  const path = `data/dfw-rent-divergence?spec=${spec}&event_study=${eventStudy}`;
  useEffect(() => { handleFetch(path); }, [path]);

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
      setResultsBySetting((prev) => ({ ...prev, [`${data.spec}|${Boolean(data.event_study)}`]: data }));
    }
  }, [data]);

  // Only interpret results that match what's selected right now
  const current = data && data.spec === spec && Boolean(data.event_study) === eventStudy ? data : null;
  const otherSpecData = resultsBySetting[`${spec === "full" ? "base" : "full"}|false`] ?? null;

  const [explainFocus, setExplainFocus] = useState(null);   // null | "pooled" | "byYear"
  const report = useMemo(
    () => (current && explainFocus ? interpretDivergence(current, { focus: explainFocus, otherSpecData }) : null),
    [current, explainFocus, otherSpecData]
  );
  const reportText = useMemo(() => (report ? reportToText(report) : ""), [report]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-gray-200 gap-4">
        <div className="flex items-start gap-2">
          {onBack && <BackButton onClick={onBack} />}
          <div className="pt-1">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Did the 2021–22 rent boom end differently across DFW ZIPs?</h1>
            <p className="text-sm text-gray-500 mt-1">Two-way fixed-effects model on monthly ZORI rents (ZIP and month fixed effects, ZIP-clustered errors)</p>
          </div>
        </div>
        <div className="flex flex-wrap md:flex-nowrap items-center gap-2 self-start md:self-auto whitespace-nowrap">
          <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm font-semibold">
            {[["base", "Rent & county only"], ["full", "With Census factors"]].map(([v, label]) => (
              <button key={v} onClick={() => setSpec(v)}
                      className={`px-3 py-1.5 ${spec === v ? "bg-gray-800 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 px-2">
            <input type="checkbox" checked={eventStudy} onChange={(e) => setEventStudy(e.target.checked)} />
            By year
          </label>
          {onTrainForecast && (
            <button onClick={onTrainForecast} className="px-4 py-1.5 text-sm font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
              ⚡ Train Forecast Engine
            </button>
          )}
        </div>
      </div>

      {loading && <div className="p-8 text-center text-gray-500 font-medium animate-pulse">Fitting the panel model…</div>}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          Error: {error}
          <button onClick={() => handleFetch(path)} className="ml-4 font-semibold underline text-red-900">Retry</button>
        </div>
      )}

      {data && !loading && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["ZIP codes", data.n_zips],
              ["Months", data.panel?.months],
              ["Peak comparison", data.panel?.pre_period?.join(" → ")],
              ["Within R²", data.r2_within?.toFixed(3)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
                <div className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{value ?? "—"}</div>
              </div>
            ))}
          </div>

          {(failures.length > 0 || data.traits_unavailable?.length > 0) && (
            <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-900">
              {data.traits_unavailable?.length > 0 && (
                <div>Not included (no data): {data.traits_unavailable.map(traitLabel).join(", ")}.</div>
              )}
              {failures.length > 0 && <div className="mt-1">Data sources that failed to load: {failures.join(", ")}.</div>}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-md font-bold text-gray-800">{eventStudy ? "Effects that don't vary by year" : "What explains post-peak rents"}</h3>
              <ExplainButton onClick={() => setExplainFocus("pooled")} disabled={!current || pooled.length === 0} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">{data.how_to_read}</p>
            <CoefficientTable coefficients={pooled} />
          </div>

          {eventStudy && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <h3 className="text-md font-bold text-gray-800">How each effect evolved after the peak</h3>
                <ExplainButton onClick={() => setExplainFocus("byYear")} disabled={!current} />
              </div>
              <EventStudyChart coefficients={data.coefficients} />
            </div>
          )}

          <div className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-1">
           
          </div>
{/* 
          {onTrainForecast && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4">
              <div>
                <div className="text-sm font-bold text-emerald-950">Want to try it yourself?</div>
                <p className="text-sm text-emerald-900 mt-0.5">
                  Train your own forecast on the same rent data: pick the factors, choose how many months ahead, and see the predicted rents on the dashboard.
                </p>
              </div>
              <button onClick={onTrainForecast} className="shrink-0 px-4 py-2 text-sm font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                ⚡ Train Forecast Engine
              </button>
            </div>
          )} */}
        </div>
      )}

      <AnalysisModal
        open={Boolean(report)}
        onClose={() => setExplainFocus(null)}
        report={report}
        copyText={reportText}
      />
    </div>
  );
}
