import React from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

const fmt = (v) => {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") return v.toFixed(4);
  return String(v);
};

const TONES = {
  good: { bgcolor: "green.100", color: "green.700" },
  bad: { bgcolor: "red.100", color: "red.700" },
  warn: { bgcolor: "orange.100", color: "orange.700" },
  caution: { bgcolor: "yellow.100", color: "yellow.700" },
};

/** Small coloured label; `pill` rounds it fully. */
const Badge = ({ tone, pill = true, sx, children }) => (
  <Box
    component="span"
    sx={{ display: "inline-block", px: 1, py: 0.25, borderRadius: pill ? 999 : 1, fontSize: "0.75rem", fontWeight: 500, ...TONES[tone], ...sx }}
  >
    {children}
  </Box>
);

// Diagnostic tests: p < 0.05 means a PROBLEM was found (red, ✕).
// Coefficients (coef): p < 0.05 means the variable IS significant (green, ✓).
const PBadge = ({ p, coef = false }) => {
  if (p === null || p === undefined || typeof p !== "number") return <span>-</span>;
  const sig = p < 0.05;
  const good = coef ? sig : !sig;
  return (
    <Badge tone={good ? "good" : "bad"}>
      {p.toFixed(4)} {good ? "✓" : "✕"}
    </Badge>
  );
};

const ConclusionBadge = ({ text }) => {
  if (!text) return null;
  const lower = text.toLowerCase();
  // "No significant ... detected." is a PASS, so it must not be flagged
  const isWarning =
    !lower.startsWith("no ") &&
    (lower.includes("detected") ||
      lower.includes("deviate") ||
      lower.includes("misspecified") ||
      lower.includes("non-linearity") ||
      lower.includes("influential") ||
      lower.includes("not normally"));
  return (
    <Badge tone={isWarning ? "warn" : "good"} pill={false} sx={{ mt: 0.5 }}>
      {text}
    </Badge>
  );
};

const SectionCard = ({ title, children, defaultOpen = false }) => (
  <Accordion
    defaultExpanded={defaultOpen}
    disableGutters
    elevation={0}
    slotProps={{ transition: { unmountOnExit: true } }}
    sx={{ border: 1, borderColor: "gray.200", borderRadius: 2, mb: 1.5, overflow: "hidden", "&::before": { display: "none" } }}
  >
    <AccordionSummary
      expandIcon={<ExpandMoreIcon sx={{ fontSize: 18, color: "gray.400" }} />}
      sx={{ px: 2, minHeight: 0, bgcolor: "gray.50", "&:hover": { bgcolor: "gray.100" }, "& .MuiAccordionSummary-content": { my: 1.5 } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, color: "gray.700" }}>{title}</Typography>
    </AccordionSummary>
    <AccordionDetails sx={{ px: 2, py: 1.5, bgcolor: "common.white" }}>{children}</AccordionDetails>
  </Accordion>
);

const DiagRow = ({ label, value, isP = false }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", py: 0.5, borderBottom: 1, borderColor: "gray.100", "&:last-of-type": { borderBottom: 0 }, fontSize: "0.875rem" }}>
    <Box component="span" sx={{ color: "gray.500", width: "50%" }}>{label}</Box>
    <Box component="span" sx={{ color: "gray.800", width: "50%", textAlign: "right" }}>
      {isP ? <PBadge p={value} /> : fmt(value)}
    </Box>
  </Box>
);

/** Two columns from md up, one below. */
const TwoColumns = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>{children}</Box>
);

const SubHeading = ({ children, sx }) => (
  <Typography variant="caption" component="p" sx={{ fontWeight: 600, color: "gray.600", mb: 1, ...sx }}>{children}</Typography>
);

const headSx = { px: 2, py: 1, color: "gray.600", fontWeight: 700, fontSize: "0.875rem" };
const cellSx = { px: 2, py: 1, color: "gray.700", fontSize: "0.875rem" };

// ─────────────────────────────────────────
// DIAGNOSTICS SECTIONS
// ─────────────────────────────────────────

const HeteroskedasticitySection = ({ data }) => {
  if (!data) return null;
  const { breusch_pagan, white_test } = data;
  return (
    <SectionCard title="Heteroskedasticity">
      <TwoColumns>
        {breusch_pagan && !breusch_pagan.error && (
          <div>
            <SubHeading>Breusch-Pagan</SubHeading>
            <DiagRow label="LM Statistic" value={breusch_pagan.lm_statistic} />
            <DiagRow label="P-Value" value={breusch_pagan.p_value} isP />
            <ConclusionBadge text={breusch_pagan.conclusion} />
          </div>
        )}
        {white_test && !white_test.error && (
          <div>
            <SubHeading>White's Test</SubHeading>
            <DiagRow label="LM Statistic" value={white_test.lm_statistic} />
            <DiagRow label="P-Value" value={white_test.p_value} isP />
            <ConclusionBadge text={white_test.conclusion} />
          </div>
        )}
      </TwoColumns>
    </SectionCard>
  );
};

const MulticollinearitySection = ({ data }) => {
  if (!data) return null;
  const { vif, high_correlation_pairs, conclusion } = data;
  return (
    <SectionCard title="Multicollinearity (VIF)">
      {vif && Object.keys(vif).length > 0 && (
        <TableContainer sx={{ mb: 1.5 }}>
          <Table size="small" sx={{ minWidth: "100%" }}>
            <TableHead>
              <TableRow sx={{ bgcolor: "gray.50" }}>
                <TableCell sx={{ ...headSx, px: 1.5 }}>Variable</TableCell>
                <TableCell sx={{ ...headSx, px: 1.5 }}>VIF</TableCell>
                <TableCell sx={{ ...headSx, px: 1.5 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(vif).map(([col, info]) => (
                <TableRow key={col} hover>
                  <TableCell sx={{ ...cellSx, px: 1.5 }}>{col}</TableCell>
                  <TableCell sx={{ ...cellSx, px: 1.5 }}>{fmt(info.vif)}</TableCell>
                  <TableCell sx={{ ...cellSx, px: 1.5 }}>
                    <Badge
                      tone={
                        info.conclusion === "Acceptable"
                          ? "good"
                          : info.conclusion === "Moderate multicollinearity"
                          ? "caution"
                          : "bad"
                      }
                    >
                      {info.conclusion}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {high_correlation_pairs && high_correlation_pairs.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <SubHeading sx={{ mb: 0.5 }}>
            High Correlation Pairs (|r| &gt; 0.8)
          </SubHeading>
          {high_correlation_pairs.map((pair, i) => (
            <Box key={i} sx={{ fontSize: "0.75rem", color: "orange.700", bgcolor: "orange.50", px: 1, py: 0.5, borderRadius: 1, mb: 0.5 }}>
              {pair.var1} ↔ {pair.var2}: {fmt(pair.correlation)}
            </Box>
          ))}
        </Box>
      )}
      {conclusion && <ConclusionBadge text={conclusion} />}
    </SectionCard>
  );
};

const NormalitySection = ({ data }) => {
  if (!data) return null;
  const { jarque_bera: jb, shapiro_wilk: sw } = data;
  return (
    <SectionCard title="Normality of Residuals">
      <TwoColumns>
        {jb && !jb.error && (
          <div>
            <SubHeading>Jarque-Bera</SubHeading>
            <DiagRow label="Statistic" value={jb.statistic} />
            <DiagRow label="P-Value" value={jb.p_value} isP />
            <DiagRow label="Skewness" value={jb.skewness} />
            <DiagRow label="Kurtosis" value={jb.kurtosis} />
            <ConclusionBadge text={jb.conclusion} />
          </div>
        )}
        {sw && !sw.error && (
          <div>
            <SubHeading>Shapiro-Wilk</SubHeading>
            <DiagRow label="Statistic" value={sw.statistic} />
            <DiagRow label="P-Value" value={sw.p_value} isP />
            <ConclusionBadge text={sw.conclusion} />
          </div>
        )}
      </TwoColumns>
    </SectionCard>
  );
};

const AutocorrelationSection = ({ data }) => {
  if (!data) return null;
  return (
    <SectionCard title="Autocorrelation (Durbin-Watson)">
      <DiagRow label="DW Statistic" value={data.durbin_watson_statistic} />
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

// Panel models (fixed / random effects) return these instead of Durbin-Watson
const SerialCorrelationSection = ({ data }) => {
  if (!data || data.error) return null;
  return (
    <SectionCard title="Serial Correlation (AR(1) of residuals)">
      <DiagRow label="AR(1) Coefficient" value={data.ar1_coefficient} />
      <DiagRow label="P-Value" value={data.p_value} isP />
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

const CrossSectionalDependenceSection = ({ data }) => {
  if (!data || data.error) return null;
  return (
    <SectionCard title="Cross-Sectional Dependence (Pesaran CD)">
      <DiagRow label="CD Statistic" value={data.cd_statistic} />
      <DiagRow label="P-Value" value={data.p_value} isP />
      <DiagRow label="Entities (N)" value={data.n_entities} />
      <DiagRow label="Periods (T)" value={data.t_periods} />
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

const SpecificationSection = ({ data }) => {
  if (!data) return null;
  return (
    <SectionCard title="Model Specification (Ramsey RESET)">
      <DiagRow label="F-Statistic" value={data.f_statistic} />
      <DiagRow label="P-Value" value={data.p_value} isP />
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

const InfluentialSection = ({ data }) => {
  if (!data) return null;
  return (
    <SectionCard title="Influential Observations (Cook's Distance)">
      <DiagRow label="Threshold (4/n)" value={data.threshold} />
      <DiagRow label="Max Cook's D" value={data.max_cooks_d} />
      <DiagRow label="# Influential Obs" value={data.n_influential} />
      {data.influential_indices?.length > 0 && (
        <Typography variant="caption" component="p" sx={{ color: "gray.500", mt: 1 }}>
          Indices: {data.influential_indices.join(", ")}
          {data.n_influential > 20 && ` ... (${data.n_influential - 20} more)`}
        </Typography>
      )}
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

const LinearitySection = ({ data }) => {
  if (!data) return null;
  return (
    <SectionCard title="Linearity">
      <DiagRow label="Fitted vs Residuals Corr." value={data.correlation_fitted_vs_residuals} />
      <DiagRow label="P-Value" value={data.p_value} isP />
      {data.conclusion && <ConclusionBadge text={data.conclusion} />}
    </SectionCard>
  );
};

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

const CrossSectionalTable = ({ result }) => {
  if (!result || !result.success) {
    return <Typography sx={{ color: "red.500" }}>No model summary available.</Typography>;
  }
  const isTreeModel = ["RANDOM_FOREST", "GRADIENT_BOOSTING", "BAGGING", "RANDOM_FOREST_CLASSIFIER", 
    "GRADIENT_BOOSTING_CLASSIFIER", "BAGGING_CLASSIFIER", "RANDOM FOREST PANEL", "BOOSTING PANEL"].includes(result.model);
  const coefficients = result.coefficients ? Object.entries(result.coefficients) : [];
  const featureImportance = result.feature_importance ? Object.entries(result.feature_importance) : [];
  const pValues = result.p_values || {};
  const standardErrors = result.standard_errors || {};
  const diag = result.diagnostics || {};

  // Panel models send cluster-robust SEs; the cross-sectional OLS model sends HC3.
  const hasCluster =
    result.cluster_robust_se && Object.keys(result.cluster_robust_se).length > 0;
  const robustSE = hasCluster
    ? result.cluster_robust_se
    : result.robust_standard_errors_hc3 || {};
  const robustP = hasCluster
    ? result.cluster_robust_p_values || {}
    : result.robust_p_values_hc3 || {};
  const robustLabel = hasCluster ? "Cluster-Robust SE" : "Robust SE (HC3)";

  // After the within transformation the fixed-effects constant is zero by construction
  const isFixedEffects = result.model === "FIXED EFFECTS";
  const coefRows = coefficients.filter(([key]) => !(isFixedEffects && key === "const"));

  // mse / mae from the panel models are out-of-sample; say which kind
  const mseBasisLabel = {
    holdout: "held-out periods",
    walk_forward_cv: "walk-forward CV",
    entity_cv: "entity CV",
    in_sample: "in-sample",
  }[result.mse_basis];
  const withBasis = (name) => (mseBasisLabel ? `${name} (${mseBasisLabel})` : name);

  const metrics = [
    { label: "Model", value: result.model },
    { label: "Rows Used", value: result.rows_used },
    { label: "R²", value: result.r2_score },
    { label: "Adj. R²", value: result.adj_r2 },
    { label: "Within R²", value: result.within_r2 },
    { label: "In-sample R²", value: result.in_sample_r2 },
    { label: withBasis("MSE"), value: result.mse },
    { label: withBasis("MAE"), value: result.mae },
    { label: "F-Statistic", value: result.f_statistic },
    { label: "F P-Value", value: result.f_pvalue },
    { label: "AIC", value: result.aic },
    { label: "BIC", value: result.bic },
    { label: "Log loss", value: result.log_loss },
    { label: "ROC AUC", value: result.roc_auc },
  ];

  return (
    <Box sx={{ mt: 3, width: "100%", maxWidth: 1024, mx: "auto" }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", fontWeight: 600, color: "gray.800", mb: 2 }}>
        {result.model} Results
      </Typography>

      {/* ── Model Metrics ── */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1.5, mb: 3 }}>
        {metrics.map(({ label, value }) =>
          value !== undefined && value !== null ? (
            <Box key={label} sx={{ bgcolor: "gray.50", border: 1, borderColor: "gray.200", borderRadius: 2, px: 1.5, py: 1 }}>
              <Typography variant="caption" component="p" sx={{ color: "gray.500" }}>{label}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: "gray.800" }}>{fmt(value)}</Typography>
            </Box>
          ) : null
        )}
      </Box>

      {/* ── Linear Model Coefficients ── */}
      {!isTreeModel && coefRows.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 600, color: "gray.800", mb: 1 }}>Model Coefficients</Typography>
          <TableContainer>
            <Table size="small" sx={{ minWidth: "100%", border: 1, borderColor: "gray.200" }}>
              <TableHead sx={{ bgcolor: "gray.100" }}>
                <TableRow>
                  <TableCell sx={headSx}>Variable</TableCell>
                  <TableCell sx={headSx}>Coefficient</TableCell>
                  <TableCell sx={headSx}>Std. Error</TableCell>
                  <TableCell sx={headSx}>P-Value</TableCell>
                  <TableCell sx={headSx}>{robustLabel}</TableCell>
                  <TableCell sx={headSx}>Robust P</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {coefRows.map(([key, value], idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ ...cellSx, fontWeight: 500 }}>{key}</TableCell>
                    <TableCell sx={cellSx}>{fmt(value)}</TableCell>
                    <TableCell sx={cellSx}>{fmt(standardErrors[key])}</TableCell>
                    <TableCell sx={cellSx}><PBadge p={pValues[key]} coef /></TableCell>
                    <TableCell sx={cellSx}>{fmt(robustSE[key])}</TableCell>
                    <TableCell sx={cellSx}><PBadge p={robustP[key]} coef /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ── Tree Model Feature Importance ── */}
      {isTreeModel && featureImportance.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 600, color: "gray.800", mb: 1 }}>Feature Importance</Typography>
          <TableContainer>
            <Table size="small" sx={{ minWidth: "100%", border: 1, borderColor: "gray.200" }}>
              <TableHead sx={{ bgcolor: "gray.100" }}>
                <TableRow>
                  <TableCell sx={headSx}>Feature</TableCell>
                  <TableCell sx={headSx}>Importance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {featureImportance.map(([key, value], idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={cellSx}>{key}</TableCell>
                    <TableCell sx={cellSx}>{fmt(value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ── Diagnostic Tests ── */}
      {Object.keys(diag).length > 0 && !isTreeModel && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 600, color: "gray.800", mb: 1.5 }}>Diagnostic Tests</Typography>
          <HeteroskedasticitySection data={diag.heteroskedasticity} />
          <MulticollinearitySection data={diag.multicollinearity} />
          <NormalitySection data={diag.normality_of_residuals} />
          <AutocorrelationSection data={diag.autocorrelation} />
          <SerialCorrelationSection data={diag.serial_correlation} />
          <CrossSectionalDependenceSection data={diag.cross_sectional_dependence} />
          <SpecificationSection data={diag.model_specification} />
          <InfluentialSection data={diag.influential_observations} />
          <LinearitySection data={diag.linearity} />
        </Box>
      )}
    </Box>
  );
};

export default CrossSectionalTable;
