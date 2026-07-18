import React from 'react';
import pptxgen from 'pptxgenjs';
import { ArrowDownTrayIcon } from "@heroicons/react/24/solid";

const TREE_MODELS = [
    "RANDOM_FOREST", "GRADIENT_BOOSTING", "BAGGING",
    "RANDOM_FOREST_CLASSIFIER", "GRADIENT_BOOSTING_CLASSIFIER", "BAGGING_CLASSIFIER",
];

const COLORS = {
    accent: "1D4ED8",
    textDark: "1F2937",
    textMuted: "6B7280",
    headerBg: "1D4ED8",
    rowAltBg: "F3F4F6",
    sigBg: "FEE2E2",
    sigText: "B91C1C",
    nonSigBg: "DCFCE7",
    nonSigText: "15803D",
};

const fmt = (v) => {
    if (v === null || v === undefined) return "-";
    if (typeof v === "number") return v.toFixed(4);
    return String(v);
};

const isSignificant = (p) => typeof p === "number" && p < 0.05;

const pCell = (p) => ({
    text: p === undefined || p === null ? "-" : p.toFixed(4),
    options: {
        fontSize: 10,
        bold: isSignificant(p),
        color: isSignificant(p) ? COLORS.sigText : COLORS.nonSigText,
        fill: { color: isSignificant(p) ? COLORS.sigBg : COLORS.nonSigBg },
        align: "center",
    },
});

const addSlideHeader = (slide, title) => {
    slide.addText(title, {
        x: 0.6, y: 0.4, w: 12, h: 0.6,
        fontSize: 22, bold: true, color: COLORS.textDark, fontFace: "Arial",
    });
};

/**
 * Builds a publication-ready .pptx from a model result object shaped like:
 * {
 *   success, model, rows_used,
 *   r2_score, adj_r2, mse, mae, f_statistic, f_pvalue, aic, bic, log_loss, roc_auc,
 *   coefficients, standard_errors, p_values, robust_standard_errors_hc3, robust_p_values_hc3,
 *   feature_importance,
 *   diagnostics: {
 *     heteroskedasticity: { breusch_pagan, white_test },
 *     multicollinearity: { vif, high_correlation_pairs, conclusion },
 *     normality_of_residuals: { jarque_bera, shapiro_wilk },
 *     autocorrelation: { durbin_watson_statistic, conclusion },
 *     model_specification: { f_statistic, p_value, conclusion },
 *     influential_observations: { threshold, max_cooks_d, n_influential, conclusion },
 *     linearity: { correlation_fitted_vs_residuals, p_value, conclusion },
 *   }
 * }
 *
 * @param {object} result - the model result (same shape rendered by CrossSectionalTable)
 * @param {object} options
 * @param {string} options.title - deck title slide heading (e.g. "Cross-Sectional Data Analysis")
 * @param {object} options.variables - { dependentVar, independentVar: [], categoricalVar: [], idColumn, outliers }
 * @param {string} options.filenamePrefix - prefix for the downloaded file name
 */
export const buildResultPptx = (result, options = {}) => {
    if (!result) return;

    const {
        title = "Data Analysis",
        variables = {},
        filenamePrefix = "model",
    } = options;

    const {
        dependentVar,
        independentVar = [],
        categoricalVar = [],
        idColumn,
        outliers,
    } = variables;

    const isTreeModel = TREE_MODELS.includes(result.model);
    const isTimeSeries =
        result.data &&
        result.data.length > 0 &&
        result.data[0].field_name !== undefined;

    const coefficients = isTimeSeries
        ? result.data.map(item => ({
            variable: item.field_name,
            coefficient: item.mean,
            standardError: item.standard_error,
            pValue: parseFloat(item.p_value),
        }))
        : result.coefficients
            ? Object.entries(result.coefficients)
            : [];


    const featureImportance = result.feature_importance
        ? Object.entries(result.feature_importance).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        : [];
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
        { label: "Log Loss", value: result.log_loss },
        { label: "ROC AUC", value: result.roc_auc },
    ].filter(m => m.value !== undefined && m.value !== null);

    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_WIDE"; // 13.33in x 7.5in

    // ── Slide 1: Title / methodology ──
    const titleSlide = pptx.addSlide();
    titleSlide.addText(title, {
        x: 0.6, y: 0.7, w: 12, h: 0.8,
        fontSize: 28, bold: true, color: COLORS.textDark, fontFace: "Arial",
    });
    titleSlide.addText(`${result.model} Results`, {
        x: 0.6, y: 1.5, w: 12, h: 0.5,
        fontSize: 16, color: COLORS.accent, fontFace: "Arial", bold: true,
    });

    const metaRows = [
        ["Dependent variable", dependentVar || "—"],
        ["Independent variables", independentVar.join(", ") || "—"],
        ["Categorical variables", categoricalVar.length ? categoricalVar.join(", ") : "None"],
        ["ID column", idColumn || "—"],
        ["Outlier treatment", outliers === "yes" ? "Applied" : "Not applied"],
        ["Rows used", fmt(result.rows_used)],
        ["Generated", new Date().toLocaleString()],
    ];
    titleSlide.addTable(
        metaRows.map(([label, value]) => ([
            { text: label, options: { bold: true, color: COLORS.textDark, fontSize: 12 } },
            { text: value, options: { color: COLORS.textMuted, fontSize: 12 } },
        ])),
        {
            x: 0.6, y: 2.3, w: 8, colW: [2.8, 5.2],
            border: { type: "solid", color: "E5E7EB", pt: 0.5 },
        }
    );

    // ── Slide 2: Model metrics ──
    if (metrics.length > 0) {
        const metricsSlide = pptx.addSlide();
        addSlideHeader(metricsSlide, "Model Summary");

        const perRow = 4;
        const cardW = 2.9, cardH = 1.3, gap = 0.25;
        metrics.forEach((m, i) => {
            const col = i % perRow;
            const row = Math.floor(i / perRow);
            const x = 0.6 + col * (cardW + gap);
            const y = 1.3 + row * (cardH + gap);

            metricsSlide.addShape("roundRect", {
                x, y, w: cardW, h: cardH,
                fill: { color: "EFF6FF" },
                line: { color: "DBEAFE", width: 1 },
                rectRadius: 0.08,
            });
            metricsSlide.addText(fmt(m.value), {
                x, y: y + 0.15, w: cardW, h: 0.55,
                align: "center", fontSize: 18, bold: true, color: COLORS.accent, fontFace: "Arial",
            });
            metricsSlide.addText(m.label, {
                x, y: y + 0.75, w: cardW, h: 0.4,
                align: "center", fontSize: 11, color: COLORS.textMuted, fontFace: "Arial",
            });
        });
    }

    // ── Slide 3: Coefficients (linear models) ──
    if (!isTreeModel && coefficients.length > 0) {
        const coefSlide = pptx.addSlide();
        addSlideHeader(coefSlide, "Model Coefficients");

        const header = [
            "Variable", "Coefficient", "Std. Error", "P-Value", "Robust SE (HC3)", "Robust P",
        ].map(h => ({
            text: h,
            options: { bold: true, color: "FFFFFF", fill: { color: COLORS.headerBg }, fontSize: 10, align: "center" },
        }));

        const rows = isTimeSeries
            ? coefficients.map((item, i) => {
                const bg = i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg;

                return [
                    {
                        text: item.variable,
                        options: {
                            fontSize: 10,
                            bold: true,
                            color: COLORS.textDark,
                            fill: { color: bg },
                        },
                    },
                    {
                        text: fmt(item.coefficient),
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    {
                        text: fmt(item.standardError),
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    pCell(item.pValue),
                    {
                        text: "-",
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    {
                        text: "-",
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                ];
            })
            : coefficients.map(([key, value], i) => {
                const bg = i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg;

                return [
                    {
                        text: key,
                        options: {
                            fontSize: 10,
                            bold: true,
                            color: COLORS.textDark,
                            fill: { color: bg },
                        },
                    },
                    {
                        text: fmt(value),
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    {
                        text: fmt(standardErrors[key]),
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    pCell(pValues[key]),
                    {
                        text: fmt(robustSE[key]),
                        options: {
                            fontSize: 10,
                            align: "center",
                            fill: { color: bg },
                        },
                    },
                    pCell(robustP[key]),
                ];
            });

        coefSlide.addTable([header, ...rows], {
            x: 0.4, y: 1.2, w: 12.5,
            border: { type: "solid", color: "E5E7EB", pt: 0.5 },
            autoPage: true,
        });

        coefSlide.addText("Highlighted p-values indicate statistical significance at the 5% level.", {
            x: 0.6, y: 6.9, w: 12, h: 0.4,
            fontSize: 9, italic: true, color: COLORS.textMuted, fontFace: "Arial",
        });
    }

    // ── Slide 3 (alt): Feature importance (tree models) ──
    if (isTreeModel && featureImportance.length > 0) {
        const fiSlide = pptx.addSlide();
        addSlideHeader(fiSlide, "Feature Importance");

        const header = ["Feature", "Importance"].map(h => ({
            text: h,
            options: { bold: true, color: "FFFFFF", fill: { color: COLORS.headerBg }, fontSize: 11, align: "center" },
        }));
        const rows = featureImportance.map(([key, value], i) => ([
            { text: key, options: { fontSize: 11, color: COLORS.textDark, fill: { color: i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg } } },
            { text: fmt(value), options: { fontSize: 11, color: COLORS.textDark, fill: { color: i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg }, align: "center" } },
        ]));

        fiSlide.addTable([header, ...rows], {
            x: 0.6, y: 1.2, w: 8,
            border: { type: "solid", color: "E5E7EB", pt: 0.5 },
            autoPage: true,
        });
    }

    // ── Slide 4: Diagnostic tests summary (p-value based tests) ──
    if (!isTreeModel && Object.keys(diag).length > 0) {
        const bp = diag.heteroskedasticity?.breusch_pagan;
        const white = diag.heteroskedasticity?.white_test;
        const jb = diag.normality_of_residuals?.jarque_bera;
        const sw = diag.normality_of_residuals?.shapiro_wilk;
        const reset = diag.model_specification;
        const linearity = diag.linearity;

        const testRows = [
            bp && !bp.error && ["Breusch-Pagan (Heteroskedasticity)", bp.lm_statistic, bp.p_value, bp.conclusion],
            white && !white.error && ["White's Test (Heteroskedasticity)", white.lm_statistic, white.p_value, white.conclusion],
            jb && !jb.error && ["Jarque-Bera (Normality)", jb.statistic, jb.p_value, jb.conclusion],
            sw && !sw.error && ["Shapiro-Wilk (Normality)", sw.statistic, sw.p_value, sw.conclusion],
            reset && ["Ramsey RESET (Specification)", reset.f_statistic, reset.p_value, reset.conclusion],
            linearity && ["Linearity (Fitted vs Residuals)", linearity.correlation_fitted_vs_residuals, linearity.p_value, linearity.conclusion],
        ].filter(Boolean);

        if (testRows.length > 0) {
            const diagSlide = pptx.addSlide();
            addSlideHeader(diagSlide, "Diagnostic Tests");

            const header = ["Test", "Statistic", "P-Value", "Conclusion"].map(h => ({
                text: h,
                options: { bold: true, color: "FFFFFF", fill: { color: COLORS.headerBg }, fontSize: 10, align: "center" },
            }));

            const rows = testRows.map(([name, stat, p, conclusion], i) => {
                const bg = i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg;
                return [
                    { text: name, options: { fontSize: 10, bold: true, color: COLORS.textDark, fill: { color: bg } } },
                    { text: fmt(stat), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
                    pCell(p),
                    { text: conclusion || "-", options: { fontSize: 9, color: COLORS.textMuted, fill: { color: bg } } },
                ];
            });

            diagSlide.addTable([header, ...rows], {
                x: 0.4, y: 1.2, w: 12.5, colW: [3.2, 1.8, 1.8, 5.7],
                border: { type: "solid", color: "E5E7EB", pt: 0.5 },
                autoPage: true,
            });
        }
    }

    // ── Slide 5: Multicollinearity (VIF) ──
    const vif = diag.multicollinearity?.vif;
    if (!isTreeModel && vif && Object.keys(vif).length > 0) {
        const vifSlide = pptx.addSlide();
        addSlideHeader(vifSlide, "Multicollinearity (VIF)");

        const header = ["Variable", "VIF", "Status"].map(h => ({
            text: h,
            options: { bold: true, color: "FFFFFF", fill: { color: COLORS.headerBg }, fontSize: 10, align: "center" },
        }));

        const statusColor = (c) =>
            c === "Acceptable" ? [COLORS.nonSigBg, COLORS.nonSigText]
                : c === "Moderate multicollinearity" ? ["FEF9C3", "A16207"]
                    : [COLORS.sigBg, COLORS.sigText];

        const rows = Object.entries(vif).map(([col, info], i) => {
            const bg = i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg;
            const [statusBg, statusText] = statusColor(info.conclusion);
            return [
                { text: col, options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg } } },
                { text: fmt(info.vif), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
                { text: info.conclusion || "-", options: { fontSize: 9, bold: true, color: statusText, fill: { color: statusBg }, align: "center" } },
            ];
        });

        vifSlide.addTable([header, ...rows], {
            x: 0.6, y: 1.2, w: 8,
            border: { type: "solid", color: "E5E7EB", pt: 0.5 },
            autoPage: true,
        });

        const highCorr = diag.multicollinearity?.high_correlation_pairs;
        if (highCorr && highCorr.length > 0) {
            vifSlide.addText("High Correlation Pairs (|r| > 0.8)", {
                x: 8.9, y: 1.2, w: 3.8, h: 0.4,
                fontSize: 11, bold: true, color: COLORS.textDark, fontFace: "Arial",
            });
            vifSlide.addText(
                highCorr.map(p => `${p.var1} ↔ ${p.var2}: ${fmt(p.correlation)}`).join("\n"),
                { x: 8.9, y: 1.65, w: 3.8, h: 4, fontSize: 10, color: COLORS.textMuted, fontFace: "Arial" }
            );
        }
    }

    // ── Slide 6: Autocorrelation & Influential observations (non p-value stats) ──
    const dw = diag.autocorrelation;
    const infl = diag.influential_observations;
    if (!isTreeModel && (dw || infl)) {
        const otherSlide = pptx.addSlide();
        addSlideHeader(otherSlide, "Autocorrelation & Influential Observations");

        let y = 1.3;
        if (dw) {
            otherSlide.addText("Autocorrelation (Durbin-Watson)", {
                x: 0.6, y, w: 6, h: 0.4, fontSize: 13, bold: true, color: COLORS.accent, fontFace: "Arial",
            });
            y += 0.5;
            otherSlide.addTable(
                [
                    [{ text: "DW Statistic", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: fmt(dw.durbin_watson_statistic), options: { fontSize: 11, color: COLORS.textDark } }],
                    [{ text: "Conclusion", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: dw.conclusion || "-", options: { fontSize: 11, color: COLORS.textMuted } }],
                ],
                { x: 0.6, y, w: 6, colW: [2.2, 3.8], border: { type: "solid", color: "E5E7EB", pt: 0.5 } }
            );
            y += 1.6;
        }
        if (infl) {
            otherSlide.addText("Influential Observations (Cook's Distance)", {
                x: 0.6, y, w: 6, h: 0.4, fontSize: 13, bold: true, color: COLORS.accent, fontFace: "Arial",
            });
            y += 0.5;
            otherSlide.addTable(
                [
                    [{ text: "Threshold (4/n)", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: fmt(infl.threshold), options: { fontSize: 11, color: COLORS.textDark } }],
                    [{ text: "Max Cook's D", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: fmt(infl.max_cooks_d), options: { fontSize: 11, color: COLORS.textDark } }],
                    [{ text: "# Influential Obs", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: fmt(infl.n_influential), options: { fontSize: 11, color: COLORS.textDark } }],
                    [{ text: "Conclusion", options: { bold: true, fontSize: 11, color: COLORS.textDark } },
                    { text: infl.conclusion || "-", options: { fontSize: 11, color: COLORS.textMuted } }],
                ],
                { x: 0.6, y, w: 6, colW: [2.2, 3.8], border: { type: "solid", color: "E5E7EB", pt: 0.5 } }
            );
        }
    }

    const filenameSafeModel = (result.model || "results").toString().toLowerCase().replace(/\s+/g, "_");
    pptx.writeFile({ fileName: `${filenamePrefix}_${filenameSafeModel}_results.pptx` });
};

/**
 * Drop-in button. Renders nothing if there's no successful result yet.
 *
 * Usage:
 *   <DownloadPptxButton
 *     result={result}
 *     title="Cross-Sectional Data Analysis"
 *     filenamePrefix="cross_sectional"
 *     variables={{ dependentVar, independentVar, categoricalVar, idColumn, outliers }}
 *   />
 */
const DownloadPptxButton = ({
    result,
    title = "Data Analysis",
    filenamePrefix = "model",
    variables = {},
    className = "",
    label = "Download as PowerPoint",
}) => {
    if (!result) return null;

    return (
        <button
            onClick={() => buildResultPptx(result, { title, variables, filenamePrefix })}
            className={
                className ||
                "flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700"
            }
        >
            <ArrowDownTrayIcon className="h-4 w-4" />
            {label}
        </button>
    );
};

export default DownloadPptxButton;
