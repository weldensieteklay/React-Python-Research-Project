import React, { useId, useMemo, useState } from "react";
import { METHOD_LABELS, FORECAST_MODE_TEXT, joinList, monthLabel, factorLabel, runDetails } from "./utils";
import AnalysisModal from "./AnalysisModal";
import { reportToText } from "./interpretDivergence";
import { interpretModel } from "../../components/interpretModel";

const TREND_TEXT = {
  log: "Each ZIP's own growth rate is extrapolated (log trend).",
  linear: "Each ZIP's own dollar trend is extrapolated (linear trend).",
  none: "No trend: with predictors held at their latest values, every forecast month has the same value.",
};

/**
 * The saved forecast model, shown on the dashboard and the data pages.
 * Collapsed by default (one header line); the ▾ button expands the details.
 * "Explain these results" opens the same plain-language explanation as the forecast screen.
 */
export function ModelReport({ best, forecastRowCount, reason, onReset, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [explainOpen, setExplainOpen] = useState(false);
  const bodyId = useId();
  const explainReport = useMemo(
    () => (explainOpen && best?.result
      ? interpretModel({ method: best.method, result: best.result, config: best.config ?? {}, best, context: best.context ?? null })
      : null),
    [explainOpen, best]
  );
  const explainText = useMemo(() => (explainReport ? reportToText(explainReport) : ""), [explainReport]);

  const run = runDetails(best);
  const methodLabel = METHOD_LABELS[best.method] || best.method;
  const factors = run.factors.items ?? [];
  const isImportance = run.factors.type === "importance";
  const top = factors.slice(0, 5);
  const totalImportance = isImportance ? factors.reduce((sum, f) => sum + Math.abs(f.importance ?? 0), 0) : 0;
  const info = run.info;

  const basisText =
    run.basis === "holdout" && run.testPeriods.length > 0
      ? `Error measured on held-out months the model never saw: ${joinList(run.testPeriods.map(monthLabel))}.`
      : run.basis === "walk_forward_cv"
        ? "Error measured by walk-forward cross-validation (train on earlier periods, test on later ones)."
        : run.basis === "entity_cv"
          ? "Error measured on ZIPs left out of training."
          : "Error measured on the training data itself, so it is optimistic.";

  const mse = Number(best.mse ?? best.result?.mse);
  const fitText = Number.isFinite(mse)
    ? `typical error ±$${Math.round(Math.sqrt(mse)).toLocaleString()}`
    : "error not available";

  const warnings = (info?.warnings ?? []).filter(
    (w) => !(info?.mode === "carry_forward" && String(w).startsWith("Regressors were held"))
  );
  // The data warning also arrives inside forecast warnings; show it once
  const dataWarning = run.dataQuality?.warning && !warnings.includes(run.dataQuality.warning) ? run.dataQuality.warning : null;
  const trend = info?.trend ?? run.spec?.trend;

  const filtered = best.config?.filters && (best.config.filters.conditions?.some((c) => c.values?.length) || best.config.filters.start || best.config.filters.end);
  const hasChecks = Boolean(dataWarning || warnings.length > 0 || run.forecastError || run.dropped?.length > 0);
  const coefNote = run.spec?.coefficients_describe && run.spec.coefficients_describe !== "dependent variable" && !isImportance
    ? `Coefficients describe the ${run.spec.coefficients_describe}.`
    : null;

  return (
    <section aria-labelledby="model-report-title" className="mb-6 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      {/* Header: always visible. Clicking the title or the button expands/collapses the details. */}
      <div className={`flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-l-4 border-l-emerald-500 ${open ? "border-b border-gray-100" : ""}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                className="text-left min-w-0 flex-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
          <span className="block text-sm font-semibold uppercase tracking-wider text-emerald-700">Your forecast</span>
          <span id="model-report-title" className="block text-xl font-bold text-gray-900 mt-0.5">
            {methodLabel} <span className="font-semibold text-gray-500">({fitText})</span>
          </span>
          {!open && (
            <span className={`block text-sm mt-0.5 truncate ${forecastRowCount > 0 ? "text-gray-600" : "text-amber-800"}`}>
              {forecastRowCount > 0
                ? <>Forecast for {info?.periods?.length ? joinList(info.periods.map(monthLabel)) : "the coming months"} · {forecastRowCount.toLocaleString()} ZIP-month forecasts{hasChecks ? " · some things to check" : ""}</>
                : <>{reason} Showing actual rents only.</>}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-emerald-600 bg-emerald-50 text-emerald-800 text-base font-semibold hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 shrink-0">
          {open ? "Hide details" : "Show details"}
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
               className={`w-6 h-6 transition-transform ${open ? "rotate-180" : ""}`}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Details (collapsed by default) */}
      {open && (
      <div id={bodyId} className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="lg:col-span-2 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setExplainOpen(true)} disabled={!best?.result}
                  className="px-4 py-2 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            📝 Explain these results
          </button>
          <button type="button" onClick={onReset}
                  className="px-4 py-2 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
            Remove forecast
          </button>
        </div>
        <ReportSection title="How accurate is it?">
          <p>{basisText}</p>
          {trend && TREND_TEXT[trend] && <p className="mt-1 text-gray-600">{TREND_TEXT[trend]}</p>}
        </ReportSection>

        <ReportSection title="What's on the dashboard" tone={forecastRowCount > 0 ? "neutral" : "warning"}>
          {forecastRowCount > 0 ? (
            <>
              <p>
                Forecast rents for{" "}
                {info?.periods?.length ? <b>{joinList(info.periods.map(monthLabel))}</b> : "the forecast months"}:{" "}
                {forecastRowCount.toLocaleString()} ZIP-month forecasts
                {best.config?.rowsUsed ? `, trained on ${best.config.rowsUsed.toLocaleString()} rows` : ""}
                {filtered ? " (filtered data)" : ""}.
              </p>
              {info?.mode && FORECAST_MODE_TEXT[info.mode] && <p className="mt-1 text-gray-600">{FORECAST_MODE_TEXT[info.mode]}</p>}
            </>
          ) : (
            <p className="font-medium">{reason} Showing actual ZORI values only.</p>
          )}
        </ReportSection>

        {top.length > 0 && (
          <ReportSection title="What the model relied on most" className="lg:col-span-2" note={coefNote}>
            <ul className="space-y-2 max-w-2xl">
              {top.map((f) => (
                <li key={f.variable} className="flex items-center gap-4">
                  <span className="w-60 shrink-0 truncate text-gray-800" title={factorLabel(f.variable)}>{factorLabel(f.variable)}</span>
                  {isImportance ? (
                    <>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-2 bg-emerald-600 rounded-full" style={{ width: `${totalImportance ? (Math.abs(f.importance) / totalImportance) * 100 : 0}%` }} />
                      </div>
                      <span className="w-12 text-right tabular-nums font-bold text-gray-900">
                        {totalImportance ? `${((Math.abs(f.importance) / totalImportance) * 100).toFixed(0)}%` : "—"}
                      </span>
                    </>
                  ) : (
                    <span className="tabular-nums font-mono text-xs text-gray-700">
                      β: {Number(f.coefficient).toFixed(3)} · p: {f.pValue != null ? Number(f.pValue).toFixed(4) : "—"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </ReportSection>
        )}

        {hasChecks && (
          <ReportSection title="Things to check" tone="warning" className="lg:col-span-2">
            <ul className="list-disc pl-5 space-y-1">
              {run.forecastError && <li>Forecast failed: {run.forecastError}</li>}
              {dataWarning && <li>{dataWarning}</li>}
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
              {run.dropped?.length > 0 && (
                <li>Not estimated (constant within each ZIP, absorbed by the ZIP effect): {run.dropped.map(factorLabel).join(", ")}.</li>
              )}
            </ul>
          </ReportSection>
        )}
      </div>
      )}

      <AnalysisModal
        open={Boolean(explainReport)}
        onClose={() => setExplainOpen(false)}
        report={explainReport}
        copyText={explainText}
      />
    </section>
  );
}

// ===========================================================================
// One titled box inside a report. Reusable:
//   <ReportSection title="How accurate is it?">...</ReportSection>
//   <ReportSection title="Things to check" tone="warning" note="Small print">...</ReportSection>
// ===========================================================================
const SECTION_TONES = {
  neutral: "bg-gray-50 border-gray-200 text-gray-800",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
};

export function ReportSection({ title, tone = "neutral", note = null, className = "", children }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${SECTION_TONES[tone] ?? SECTION_TONES.neutral} ${className}`}>
      <h3 className="text-sm font-bold text-gray-900 mb-1.5">{title}</h3>
      {children}
      {note && <p className="text-xs text-gray-500 mt-2">{note}</p>}
    </div>
  );
}
