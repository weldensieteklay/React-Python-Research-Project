import React, { useId, useMemo, useState } from "react";
import { METHOD_LABELS, FORECAST_MODE_TEXT, joinList, monthLabel, factorLabel, runDetails } from "./utils";
import AnalysisModal from "./AnalysisModal";
import { reportToText } from "./interpretDivergence";
import { interpretModel } from "../../components/interpretModel";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";

const outlineButtonSx = { px: 2, py: 1, fontSize: "0.875rem", fontWeight: 600, borderRadius: 1.5, borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { borderColor: "gray.300", bgcolor: "gray.50" }, "&.Mui-disabled": { opacity: 0.5, borderColor: "gray.300", color: "gray.700" } };
const focusRing = { outline: "none", "&.Mui-focusVisible": { boxShadow: (t) => `0 0 0 2px ${t.palette.emerald[500]}` } };

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
    <Paper component="section" variant="outlined" aria-labelledby="model-report-title" sx={{ mb: 3, borderColor: "gray.200", borderRadius: 2, boxShadow: 1, overflow: "hidden" }}>
      {/* Header: always visible. Clicking the title or the button expands/collapses the details. */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap", px: 2.5, py: 2, borderLeft: 4, borderLeftColor: "emerald.500", ...(open && { borderBottom: 1, borderBottomColor: "gray.100" }) }}>
        <ButtonBase onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                    sx={{ display: "block", textAlign: "left", minWidth: 0, flex: 1, borderRadius: 1.5, ...focusRing }}>
          <Box component="span" sx={{ display: "block", fontSize: "0.875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "emerald.700" }}>Your forecast</Box>
          <Box component="span" id="model-report-title" sx={{ display: "block", fontSize: "1.25rem", fontWeight: 700, color: "gray.900", mt: 0.25 }}>
            {methodLabel} <Box component="span" sx={{ fontWeight: 600, color: "gray.500" }}>({fitText})</Box>
          </Box>
          {!open && (
            <Typography noWrap component="span" variant="body2" sx={{ display: "block", mt: 0.25, color: forecastRowCount > 0 ? "gray.600" : "amber.800" }}>
              {forecastRowCount > 0
                ? <>Forecast for {info?.periods?.length ? joinList(info.periods.map(monthLabel)) : "the coming months"} · {forecastRowCount.toLocaleString()} ZIP-month forecasts{hasChecks ? " · some things to check" : ""}</>
                : <>{reason} Showing actual rents only.</>}
            </Typography>
          )}
        </ButtonBase>
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon sx={{ "&&": { fontSize: 24 }, transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />}
                sx={{ flexShrink: 0, px: 2, py: 1, borderRadius: 2, border: 2, borderColor: "emerald.600", bgcolor: "emerald.50", color: "emerald.800", fontSize: "1rem", fontWeight: 600, "&:hover": { border: 2, borderColor: "emerald.600", bgcolor: "emerald.100" } }}>
          {open ? "Hide details" : "Show details"}
        </Button>
      </Box>

      {/* Details (collapsed by default) */}
      {open && (
      <Box id={bodyId} sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
        <Box sx={{ gridColumn: { lg: "span 2" }, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 1 }}>
          <Button variant="outlined" onClick={() => setExplainOpen(true)} disabled={!best?.result} sx={outlineButtonSx}>
            📝 Explain these results
          </Button>
          <Button variant="outlined" onClick={onReset} sx={outlineButtonSx}>
            Remove forecast
          </Button>
        </Box>
        <ReportSection title="How accurate is it?">
          <p>{basisText}</p>
          {trend && TREND_TEXT[trend] && <Box component="p" sx={{ mt: 0.5, color: "gray.600" }}>{TREND_TEXT[trend]}</Box>}
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
              {info?.mode && FORECAST_MODE_TEXT[info.mode] && <Box component="p" sx={{ mt: 0.5, color: "gray.600" }}>{FORECAST_MODE_TEXT[info.mode]}</Box>}
            </>
          ) : (
            <Box component="p" sx={{ fontWeight: 500 }}>{reason} Showing actual ZORI values only.</Box>
          )}
        </ReportSection>

        {top.length > 0 && (
          <ReportSection title="What the model relied on most" sx={{ gridColumn: { lg: "span 2" } }} note={coefNote}>
            <Box component="ul" sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 672 }}>
              {top.map((f) => (
                <Box component="li" key={f.variable} sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <Typography noWrap component="span" sx={{ width: 240, flexShrink: 0, fontSize: "inherit", color: "gray.800" }} title={factorLabel(f.variable)}>{factorLabel(f.variable)}</Typography>
                  {isImportance ? (
                    <>
                      <Box sx={{ flex: 1, height: 8, bgcolor: "gray.100", borderRadius: 999, overflow: "hidden" }}>
                        <Box sx={{ height: 8, bgcolor: "emerald.600", borderRadius: 999 }} style={{ width: `${totalImportance ? (Math.abs(f.importance) / totalImportance) * 100 : 0}%` }} />
                      </Box>
                      <Box component="span" sx={{ width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "gray.900" }}>
                        {totalImportance ? `${((Math.abs(f.importance) / totalImportance) * 100).toFixed(0)}%` : "—"}
                      </Box>
                    </>
                  ) : (
                    <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", fontFamily: "monospace", fontSize: "0.75rem", color: "gray.700" }}>
                      β: {Number(f.coefficient).toFixed(3)} · p: {f.pValue != null ? Number(f.pValue).toFixed(4) : "—"}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </ReportSection>
        )}

        {hasChecks && (
          <ReportSection title="Things to check" tone="warning" sx={{ gridColumn: { lg: "span 2" } }}>
            <Box component="ul" sx={{ listStyle: "disc", pl: 2.5, "& > li + li": { mt: 0.5 } }}>
              {run.forecastError && <li>Forecast failed: {run.forecastError}</li>}
              {dataWarning && <li>{dataWarning}</li>}
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
              {run.dropped?.length > 0 && (
                <li>Not estimated (constant within each ZIP, absorbed by the ZIP effect): {run.dropped.map(factorLabel).join(", ")}.</li>
              )}
            </Box>
          </ReportSection>
        )}
      </Box>
      )}

      <AnalysisModal
        open={Boolean(explainReport)}
        onClose={() => setExplainOpen(false)}
        report={explainReport}
        copyText={explainText}
      />
    </Paper>
  );
}

// ===========================================================================
// One titled box inside a report. Reusable:
//   <ReportSection title="How accurate is it?">...</ReportSection>
//   <ReportSection title="Things to check" tone="warning" note="Small print">...</ReportSection>
// ===========================================================================
const SECTION_TONES = {
  neutral: { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.800" },
  warning: { bgcolor: "amber.50", borderColor: "amber.200", color: "amber.900" },
};

export function ReportSection({ title, tone = "neutral", note = null, sx, children }) {
  return (
    <Box sx={[{ borderRadius: 2, border: 1, px: 2, py: 1.5, fontSize: "0.875rem", lineHeight: 1.625, ...(SECTION_TONES[tone] ?? SECTION_TONES.neutral) }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Typography variant="h3" sx={{ fontSize: "0.875rem", fontWeight: 700, color: "gray.900", mb: 0.75 }}>{title}</Typography>
      {children}
      {note && <Typography variant="caption" component="p" sx={{ color: "gray.500", mt: 1 }}>{note}</Typography>}
    </Box>
  );
}
