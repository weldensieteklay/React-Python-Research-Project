import React from "react";
import pptxgen from "pptxgenjs";
import { ArrowDownTrayIcon } from "@heroicons/react/24/solid";

const COLORS = {
    accent: "1D4ED8",
    textDark: "1F2937",
    textMuted: "6B7280",
    headerBg: "1D4ED8",
    rowAltBg: "F3F4F6",
};

const fmt = (v) => {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
    return String(v);
};

const addSlideHeader = (slide, title) => {
    slide.addText(title, {
        x: 0, y: 0.4, w: 13.33, h: 0.6,
        fontSize: 22, bold: true, color: COLORS.textDark, fontFace: "Arial",
        align: "center",
    });
};

/**
 * Formats one row's "Statistic" cell, matching what SummaryStatisticsTable
 * shows on screen for that row:
 *   - Numeric:     "Mean: X" / "Std. Error: Y"
 *   - Categorical: one line per frequency value, "value: count (pct%)"
 */
const formatStatisticCell = (stat) => {
    if (stat.type === "Numeric") {
        return `Mean: ${fmt(stat.mean)}\nStd. Error: ${fmt(stat.standardError)}`;
    }
    const freqs = stat.frequencies || {};
    const lines = Object.entries(freqs).map(
        ([value, info]) => `${value}: ${info.count} (${info.percentage}%)`
    );
    return lines.length > 0 ? lines.join("\n") : "-";
};

/**
 * Builds a .pptx from Summary Statistics rows -- mirrors the columns
 * SummaryStatisticsTable renders on screen: column, type,
 * averageAll/averageNonMissing (when showExtended), missingCount, and
 * either { mean, standardError } for numeric variables or
 * { frequencies: { [value]: { count, percentage } } } for categorical ones.
 *
 * @param {Array<object>} stats - rows as produced by computeSummaryStatistics()
 * @param {object} options
 * @param {string} options.title
 * @param {object} options.variables - { dependentVar, independentVar, categoricalVar, idColumn, outliers }
 * @param {string} options.filenamePrefix
 * @param {boolean} options.showExtended - include Average (All) / Average
 *   (Non-Missing) columns, mirroring SummaryStatisticsTable's own
 *   `showExtended` prop. Defaults to false to match how it's currently
 *   rendered on screen (CrossSectionalData passes showExtended={false}).
 */
export const buildSummaryStatsPptx = (stats, options = {}) => {
    if (!stats || stats.length === 0) return;

    const {
        title = "Summary Statistics",
        variables = {},
        filenamePrefix = "summary",
        showExtended = false,
    } = options;

    const { dependentVar, independentVar = [], categoricalVar = [], idColumn, outliers } = variables;

    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_WIDE"; // 13.33in x 7.5in

    // ── Slide 1: Title / methodology ──
    const titleSlide = pptx.addSlide();
    titleSlide.addText(title, {
        x: 0, y: 0.7, w: 13.33, h: 0.8,
        fontSize: 28, bold: true, color: COLORS.textDark, fontFace: "Arial",
        align: "center",
    });
    titleSlide.addText("Summary Statistics", {
        x: 0, y: 1.5, w: 13.33, h: 0.5,
        fontSize: 16, color: COLORS.accent, fontFace: "Arial", bold: true,
        align: "center",
    });

    const metaRows = [
        ["Dependent variable", dependentVar || "—"],
        ["Independent variables", independentVar.join(", ") || "—"],
        ["Categorical variables", categoricalVar.length ? categoricalVar.join(", ") : "None"],
        ["ID column", idColumn || "—"],
        ["Outlier treatment", outliers === "yes" ? "Applied" : "Not applied"],
        ["Variables summarized", String(stats.length)],
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

    // ── Slide 2+: Summary statistics table ──
    const statsSlide = pptx.addSlide();
    addSlideHeader(statsSlide, "Summary Statistics");

    const headerLabels = ["Variable", "Type"];
    if (showExtended) headerLabels.push("Average (All)", "Average (Non-Missing)");
    headerLabels.push("Missing", "Statistic");

    const header = headerLabels.map(h => ({
        text: h,
        options: { bold: true, color: "FFFFFF", fill: { color: COLORS.headerBg }, fontSize: 10, align: "center" },
    }));

    const rows = stats.map((stat, i) => {
        const bg = i % 2 === 0 ? "FFFFFF" : COLORS.rowAltBg;
        const cells = [
            { text: fmt(stat.column), options: { fontSize: 10, bold: true, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
            { text: fmt(stat.type), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
        ];
        if (showExtended) {
            cells.push(
                { text: fmt(stat.averageAll), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
                { text: fmt(stat.averageNonMissing), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
            );
        }
        cells.push(
            { text: fmt(stat.missingCount), options: { fontSize: 10, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
            { text: formatStatisticCell(stat), options: { fontSize: 9, color: COLORS.textDark, fill: { color: bg }, align: "center" } },
        );
        return cells;
    });

    statsSlide.addTable([header, ...rows], {
        x: 0.4, y: 1.2, w: 12.5,
        border: { type: "solid", color: "E5E7EB", pt: 0.5 },
        autoPage: true,
        autoPageRepeatHeader: true,
    });

    pptx.writeFile({ fileName: `${filenamePrefix}_statistics.pptx` });
};

/**
 * Drop-in button for exporting the Summary Statistics view to PPTX.
 * Kept separate from DownloadPptxButton (which handles model results):
 * summary stats have a distinct shape -- per-variable type/mean/frequencies
 * rather than coefficients/diagnostics/feature-importances -- so they get
 * their own builder rather than being shoehorned into the model-result path.
 *
 * Usage:
 *   <DownloadSummaryStatsPptxButton
 *     stats={summaryStats}
 *     title="Summary Statistics"
 *     filenamePrefix="summary_statistics"
 *     variables={{ dependentVar, independentVar, categoricalVar, idColumn, outliers }}
 *   />
 */
const DownloadSummaryStatsPptxButton = ({
    stats,
    title = "Summary Statistics",
    filenamePrefix = "summary_statistics",
    variables = {},
    showExtended = false,
    className = "",
    label = "Download as PowerPoint",
}) => {
    if (!stats || stats.length === 0) return null;

    return (
        <button
            onClick={() => buildSummaryStatsPptx(stats, { title, variables, filenamePrefix, showExtended })}
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

export default DownloadSummaryStatsPptxButton;
