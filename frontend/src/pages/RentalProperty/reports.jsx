import React from "react";
import { METHOD_LABELS, FORECAST_MODE_TEXT, joinList, monthLabel, factorLabel, runDetails } from "./utils";

const TREND_TEXT = {
  log: "Each ZIP's own growth rate is extrapolated (log trend).",
  linear: "Each ZIP's own dollar trend is extrapolated (linear trend).",
  none: "No trend: with predictors held at their latest values, every forecast month has the same value.",
};

export function ModelReport({ best, forecastRowCount, reason, onReset }) {
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

  return (
    <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-4 text-emerald-900 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap border-b border-emerald-100 pb-2 mb-2">
        <div>
          <div className="font-semibold text-emerald-950 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            Forecast model: {methodLabel} ({fitText})
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">{basisText}</div>
          {trend && TREND_TEXT[trend] && <div className="text-xs text-emerald-700 mt-0.5">{TREND_TEXT[trend]}</div>}
        </div>
        <button onClick={onReset} className="text-xs font-semibold underline text-emerald-800 hover:text-emerald-950">Remove forecast</button>
      </div>

      {forecastRowCount > 0 ? (
        <div className="mt-2 text-emerald-950">
          Showing forecast rents for{" "}
          {info?.periods?.length ? <b>{joinList(info.periods.map(monthLabel))}</b> : "the forecast months"}{" "}
          ({forecastRowCount.toLocaleString()} ZIP-month forecasts
          {best.config?.rowsUsed ? `, trained on ${best.config.rowsUsed.toLocaleString()} rows` : ""}
          {best.config?.filters && (best.config.filters.conditions?.some((c) => c.values?.length) || best.config.filters.start || best.config.filters.end) ? ", filtered" : ""}).{" "}
          {info?.mode && FORECAST_MODE_TEXT[info.mode] && <span className="italic opacity-90">{FORECAST_MODE_TEXT[info.mode]}</span>}
        </div>
      ) : (
        <div className="mt-2 text-amber-800 font-medium">{reason} Showing actual ZORI values only.</div>
      )}

      {run.dropped?.length > 0 && (
        <div className="mt-2 text-xs text-emerald-800">
          Not estimated (constant within each ZIP, absorbed by the ZIP effect): {run.dropped.map(factorLabel).join(", ")}.
        </div>
      )}

      {top.length > 0 && (
        <div className="mt-4">
          <div className="font-semibold text-emerald-950 mb-2">What the model relied on most</div>
          <ul className="space-y-2 max-w-xl">
            {top.map((f) => (
              <li key={f.variable} className="flex items-center gap-4 text-xs font-medium">
                <span className="w-40 truncate text-emerald-900" title={f.variable}>{factorLabel(f.variable)}</span>
                {isImportance ? (
                  <>
                    <div className="flex-1 h-2 bg-emerald-100 rounded-full overflow-hidden">
                      <div className="h-2 bg-emerald-600 rounded-full" style={{ width: `${totalImportance ? (Math.abs(f.importance) / totalImportance) * 100 : 0}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums font-bold text-emerald-950">{totalImportance ? `${((Math.abs(f.importance) / totalImportance) * 100).toFixed(0)}%` : "—"}</span>
                  </>
                ) : (
                  <span className="tabular-nums font-mono text-emerald-800">
                    β: {Number(f.coefficient).toFixed(3)} · p: {f.pValue != null ? Number(f.pValue).toFixed(4) : "—"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {run.spec?.coefficients_describe && run.spec.coefficients_describe !== "dependent variable" && !isImportance && (
            <div className="text-xs text-emerald-700 mt-2">Coefficients describe the {run.spec.coefficients_describe}.</div>
          )}
        </div>
      )}

      {(dataWarning || warnings.length > 0 || run.forecastError) && (
        <ul className="mt-3 text-xs text-amber-800 list-disc pl-4 space-y-0.5">
          {run.forecastError && <li>Forecast failed: {run.forecastError}</li>}
          {dataWarning && <li>{dataWarning}</li>}
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
