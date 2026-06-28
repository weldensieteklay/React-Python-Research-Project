import React, { useState } from "react";

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

const fmt = (v) => {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") return v.toFixed(4);
  return String(v);
};

const PBadge = ({ p }) => {
  if (p === null || p === undefined) return <span>-</span>;
  const sig = p < 0.05;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        sig ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
      }`}
    >
      {p.toFixed(4)} {sig ? "✕" : "✓"}
    </span>
  );
};

const ConclusionBadge = ({ text }) => {
  if (!text) return null;
  const isWarning =
    text.toLowerCase().includes("detected") ||
    text.toLowerCase().includes("deviate") ||
    text.toLowerCase().includes("misspecified") ||
    text.toLowerCase().includes("non-linearity") ||
    text.toLowerCase().includes("influential");
  return (
    <span
      className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
        isWarning
          ? "bg-orange-100 text-orange-700"
          : "bg-green-100 text-green-700"
      }`}
    >
      {text}
    </span>
  );
};

const SectionCard = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg mb-3 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 py-3 bg-white">{children}</div>}
    </div>
  );
};

const DiagRow = ({ label, value, isP = false }) => (
  <div className="flex justify-between items-start py-1 border-b border-gray-100 last:border-0 text-sm">
    <span className="text-gray-500 w-1/2">{label}</span>
    <span className="text-gray-800 w-1/2 text-right">
      {isP ? <PBadge p={value} /> : fmt(value)}
    </span>
  </div>
);

// ─────────────────────────────────────────
// DIAGNOSTICS SECTIONS
// ─────────────────────────────────────────

const HeteroskedasticitySection = ({ data }) => {
  if (!data) return null;
  const { breusch_pagan, white_test } = data;
  return (
    <SectionCard title="Heteroskedasticity">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {breusch_pagan && !breusch_pagan.error && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Breusch-Pagan</p>
            <DiagRow label="LM Statistic" value={breusch_pagan.lm_statistic} />
            <DiagRow label="P-Value" value={breusch_pagan.p_value} isP />
            <ConclusionBadge text={breusch_pagan.conclusion} />
          </div>
        )}
        {white_test && !white_test.error && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">White's Test</p>
            <DiagRow label="LM Statistic" value={white_test.lm_statistic} />
            <DiagRow label="P-Value" value={white_test.p_value} isP />
            <ConclusionBadge text={white_test.conclusion} />
          </div>
        )}
      </div>
    </SectionCard>
  );
};

const MulticollinearitySection = ({ data }) => {
  if (!data) return null;
  const { vif, high_correlation_pairs, conclusion } = data;
  return (
    <SectionCard title="Multicollinearity (VIF)">
      {vif && Object.keys(vif).length > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-gray-600">Variable</th>
                <th className="px-3 py-2 text-left text-gray-600">VIF</th>
                <th className="px-3 py-2 text-left text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(vif).map(([col, info]) => (
                <tr key={col} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700">{col}</td>
                  <td className="px-3 py-2 text-gray-700">{fmt(info.vif)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        info.conclusion === "Acceptable"
                          ? "bg-green-100 text-green-700"
                          : info.conclusion === "Moderate multicollinearity"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {info.conclusion}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {high_correlation_pairs && high_correlation_pairs.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-gray-600 mb-1">
            High Correlation Pairs (|r| &gt; 0.8)
          </p>
          {high_correlation_pairs.map((pair, i) => (
            <div key={i} className="text-xs text-orange-700 bg-orange-50 px-2 py-1 rounded mb-1">
              {pair.var1} ↔ {pair.var2}: {fmt(pair.correlation)}
            </div>
          ))}
        </div>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jb && !jb.error && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Jarque-Bera</p>
            <DiagRow label="Statistic" value={jb.statistic} />
            <DiagRow label="P-Value" value={jb.p_value} isP />
            <DiagRow label="Skewness" value={jb.skewness} />
            <DiagRow label="Kurtosis" value={jb.kurtosis} />
            <ConclusionBadge text={jb.conclusion} />
          </div>
        )}
        {sw && !sw.error && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Shapiro-Wilk</p>
            <DiagRow label="Statistic" value={sw.statistic} />
            <DiagRow label="P-Value" value={sw.p_value} isP />
            <ConclusionBadge text={sw.conclusion} />
          </div>
        )}
      </div>
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
        <p className="text-xs text-gray-500 mt-2">
          Indices: {data.influential_indices.join(", ")}
          {data.n_influential > 20 && ` ... (${data.n_influential - 20} more)`}
        </p>
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
    return <p className="text-red-500">No model summary available.</p>;
  }
  const isTreeModel = ["RANDOM_FOREST", "GRADIENT_BOOSTING", "BAGGING", "RANDOM_FOREST_CLASSIFIER", 
    "GRADIENT_BOOSTING_CLASSIFIER", "BAGGING_CLASSIFIER"].includes(result.model);
  const coefficients = result.coefficients ? Object.entries(result.coefficients) : [];
  const featureImportance = result.feature_importance ? Object.entries(result.feature_importance) : [];
  const pValues = result.p_values || {};
  const standardErrors = result.standard_errors || {};
  const robustSE = result.robust_standard_errors_hc3 || {};
  const robustP = result.robust_p_values_hc3 || {};
  const diag = result.diagnostics || {};

  const metrics = [
    { label: "Model", value: result.model },
    { label: "Rows Used", value: result.rows_used },
    { label: "R²", value: result.r2_score },
    { label: "Adj. R²", value: result.adj_r2 },
    { label: "MSE", value: result.mse },
    { label: "MAE", value: result.mae },
    { label: "F-Statistic", value: result.f_statistic },
    { label: "F P-Value", value: result.f_pvalue },
    { label: "AIC", value: result.aic },
    { label: "BIC", value: result.bic },
    { label: "Log loss", value: result.log_loss },
    { label: "ROC AUC", value: result.roc_auc },
  ];

  return (
    <div className="mt-6 w-full max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">
        {result.model} Results
      </h2>

      {/* ── Model Metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {metrics.map(({ label, value }) =>
          value !== undefined && value !== null ? (
            <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm font-semibold text-gray-800">{fmt(value)}</p>
            </div>
          ) : null
        )}
      </div>

      {/* ── Linear Model Coefficients ── */}
      {!isTreeModel && coefficients.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Model Coefficients</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 rounded-lg text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left text-gray-600">Variable</th>
                  <th className="px-4 py-2 text-left text-gray-600">Coefficient</th>
                  <th className="px-4 py-2 text-left text-gray-600">Std. Error</th>
                  <th className="px-4 py-2 text-left text-gray-600">P-Value</th>
                  <th className="px-4 py-2 text-left text-gray-600">Robust SE (HC3)</th>
                  <th className="px-4 py-2 text-left text-gray-600">Robust P</th>
                </tr>
              </thead>
              <tbody>
                {coefficients.map(([key, value], idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700 font-medium">{key}</td>
                    <td className="px-4 py-2 text-gray-700">{fmt(value)}</td>
                    <td className="px-4 py-2 text-gray-700">{fmt(standardErrors[key])}</td>
                    <td className="px-4 py-2"><PBadge p={pValues[key]} /></td>
                    <td className="px-4 py-2 text-gray-700">{fmt(robustSE[key])}</td>
                    <td className="px-4 py-2"><PBadge p={robustP[key]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tree Model Feature Importance ── */}
      {isTreeModel && featureImportance.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Feature Importance</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 rounded-lg text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left text-gray-600">Feature</th>
                  <th className="px-4 py-2 text-left text-gray-600">Importance</th>
                </tr>
              </thead>
              <tbody>
                {featureImportance.map(([key, value], idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{key}</td>
                    <td className="px-4 py-2 text-gray-700">{fmt(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Diagnostic Tests ── */}
      {Object.keys(diag).length > 0 && !isTreeModel && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Diagnostic Tests</h3>
          <HeteroskedasticitySection data={diag.heteroskedasticity} />
          <MulticollinearitySection data={diag.multicollinearity} />
          <NormalitySection data={diag.normality_of_residuals} />
          <AutocorrelationSection data={diag.autocorrelation} />
          <SpecificationSection data={diag.model_specification} />
          <InfluentialSection data={diag.influential_observations} />
          <LinearitySection data={diag.linearity} />
        </div>
      )}
    </div>
  );
};

export default CrossSectionalTable;