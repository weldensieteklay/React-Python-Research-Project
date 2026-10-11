import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useFetchData } from "../../hooks/useFetchData";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import DataGrid from "../../components/table/AgGridTable";
import PanelData from "../../components/PanelData";
import {
  selectBestMethod,
  clearBestMethod,
} from "../../features/rentalProperty/rentalPropertySlice";

const currencyFormatter = (params) =>
  params.value != null ? `$${Number(params.value).toLocaleString()}` : "—";

const SAFMR_GRID_STYLES = `
  .safmr-header-forecast { background-color: #dbeafe !important; }
  .safmr-header-actual { background-color: #e5e7eb !important; }
  .safmr-cell-forecast { background-color: rgba(219, 234, 254, 0.5) !important; font-style: italic; color: #1d4ed8; }
`;

/**
 * Builds { columnDefs, rowData, extraStyles, getRowId } for DataGrid
 * from the grouped SAFMR panel shape (ZIP -> { years: { year: { bedroom: rent } } }).
 */
export function buildSafmrGridProps({ rows, years, bedrooms = [0, 1, 2, 3, 4], forecastYears = new Set() }) {
  const forecastSet = forecastYears instanceof Set ? forecastYears : new Set(forecastYears);
  const sortedYears = [...years].sort((a, b) => b - a);

  const pinnedCols = [
    { headerName: "ZIP", field: "zip_code", pinned: "left", width: 110, cellClass: "font-mono" },
    { headerName: "Area", field: "area_name", pinned: "left", width: 220 },
  ];

  const yearGroups = sortedYears.map((year) => {
    const isForecast = forecastSet.has(year);
    return {
      headerName: isForecast ? `FY${year} (forecast)` : `FY${year}`,
      headerClass: isForecast ? "safmr-header-forecast" : "safmr-header-actual",
      children: bedrooms.map((bd) => ({
        headerName: `${bd}BR`,
        colId: `${year}_${bd}`,
        width: 100,
        type: "rightAligned",
        valueGetter: (params) => params.data?.years?.[year]?.[bd] ?? null,
        valueFormatter: currencyFormatter,
        cellClass: isForecast ? "safmr-cell-forecast" : undefined,
      })),
    };
  });

  return {
    columnDefs: [...pinnedCols, ...yearGroups],
    rowData: rows,
    extraStyles: SAFMR_GRID_STYLES,
    getRowId: (params) => params.data.zip_code,
  };
}

const BEDROOMS = [0, 1, 2, 3, 4];
const BEDROOM_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626"];

const MODEL_LABELS = {
  gradient_boosting: "Gradient Boosting (sklearn GradientBoostingRegressor)",
};

const MODEL_FACTORS = [
  "Bedroom size (0–4BR)",
  "Prior 3 years of SAFMR rent for the same ZIP/bedroom (autoregressive lags)",
];

// Labels for the method keys used by the panel screen
const METHOD_LABELS = {
  fixed: "Fixed Effects",
  random: "Random Effects",
  lasso: "LASSO",
  ridge: "RIDGE",
  forest: "FOREST",
  boosting: "BOOSTING",
  bagging: "BAGGING",
};

const FORECAST_MODE_LABELS = {
  carry_forward: "regressors held at their latest values",
  future_data: "scenario regressors supplied",
};

const csvEscape = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCsv = (filename, lines) => {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Panel-model forecast (from Redux) -> dashboard rows
// ---------------------------------------------------------------------------
// The panel screen returns { id, period, horizon, predicted, inputs }. The grid needs
// { zip_code, area_name, fiscal_year, bedrooms, safmr_rent, is_forecast }, which is only
// recoverable when the model was set up as: id = zip_code, dependent = safmr_rent,
// and bedrooms as an independent variable (it comes back in `inputs`).
export const toDashboardRows = (best, areaByZip = {}) => {
  const fc = best?.forecast ?? [];
  if (fc.length === 0) {
    return { rows: [], reason: "This method did not return a forecast." };
  }

  const cfg = best.config || {};
  if (
    cfg.idColumn !== "zip_code" ||
    cfg.dependentVar !== "safmr_rent" ||
    !(cfg.independentVar || []).includes("bedrooms")
  ) {
    return {
      rows: [],
      reason:
        "The forecast can only be shown in the grid when the model uses zip_code as the ID, " +
        "safmr_rent as the dependent variable, and bedrooms as an independent variable.",
    };
  }

  const rows = [];
  for (const f of fc) {
    const bedrooms = Number(f.inputs?.bedrooms);
    const year = Number(String(f.period).slice(0, 4)); // 2026 or "2026-01-01"
    if (!Number.isFinite(bedrooms) || !Number.isFinite(year) || f.predicted == null) continue;
    rows.push({
      zip_code: String(f.id),
      area_name: areaByZip[String(f.id)] ?? "",
      fiscal_year: year,
      bedrooms,
      safmr_rent: Math.round(f.predicted),
      is_forecast: true,
    });
  }
  return {
    rows,
    reason: rows.length > 0 ? null : "None of the forecast rows could be matched to ZIP and bedroom.",
  };
};

// ---------------------------------------------------------------------------
// Small report: lowest-MSE model + its most important factors
// ---------------------------------------------------------------------------
function ModelReport({ best, forecastRowCount, reason, onReset }) {
  const methodLabel = METHOD_LABELS[best.method] || best.method;
  const factors = best.factors?.items ?? [];
  const isImportance = best.factors?.type === "importance";
  const top = factors.slice(0, 5);
  const totalImportance = isImportance
    ? factors.reduce((sum, f) => sum + Math.abs(f.importance ?? 0), 0)
    : 0;
  const info = best.forecastInfo;

  const prettyName = (v) => (v === "entity_id" ? "Entity effect (ID)" : v);

  return (
    <div className="mb-3 text-sm bg-green-50 border border-green-200 rounded px-3 py-3 text-green-900">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">Forecast model report</div>
          <div className="mt-1">
            Lowest MSE: <b>{methodLabel}</b> ({Number(best.mse).toPrecision(5)}, in-sample)
          </div>
        </div>
        <button onClick={onReset} className="text-xs underline text-green-800">
          Use default forecast
        </button>
      </div>

      {forecastRowCount > 0 ? (
        <div className="mt-2">
          Showing {forecastRowCount.toLocaleString()} forecast values
          {info?.periods?.length > 0 && <> for {info.periods.join(", ")}</>}
          {info?.mode && <> ({FORECAST_MODE_LABELS[info.mode] || info.mode})</>}.
        </div>
      ) : (
        <div className="mt-2 text-amber-800">
          {reason} The default forecast is shown instead.
        </div>
      )}

      {top.length > 0 && (
        <div className="mt-3">
          <div className="font-medium mb-1">
            {isImportance ? "Most important factors" : "Most significant variables (lowest p-value)"}
          </div>
          <ul className="space-y-1">
            {top.map((f) => (
              <li key={f.variable} className="flex items-center gap-2">
                <span className="w-44 truncate" title={f.variable}>{prettyName(f.variable)}</span>
                {isImportance ? (
                  <>
                    <div className="flex-1 h-2 bg-green-100 rounded overflow-hidden">
                      <div
                        className="h-2 bg-green-600"
                        style={{ width: `${totalImportance ? (Math.abs(f.importance) / totalImportance) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums">
                      {totalImportance ? `${((Math.abs(f.importance) / totalImportance) * 100).toFixed(0)}%` : "—"}
                    </span>
                  </>
                ) : (
                  <span className="tabular-nums">
                    coef {f.coefficient.toFixed(3)} · p {f.pValue != null ? f.pValue.toFixed(3) : "—"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {info?.warnings?.length > 0 && (
        <ul className="mt-3 text-xs text-amber-800 list-disc pl-4 space-y-0.5">
          {info.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [view, setView] = useState("table");
  const [selectedZip, setSelectedZip] = useState("");

  const dispatch = useDispatch();
  const best = useSelector(selectBestMethod);

  useEffect(() => {
    handleFetch("data/dfw-safmr");
  }, []);

  const rows = data?.rows;
  const failures = data?.failures || {};
  const modelName = data?.model || null;
  const forecastError = data?.forecast_error || null;
  const skippedZips = data?.skipped_zips || [];

  // Published actuals only. The panel screen trains on these, so it never learns from forecasts.
  const actualRows = useMemo(
    () => (Array.isArray(rows) ? rows.filter((r) => !r.is_forecast) : []),
    [rows]
  );

  const areaByZip = useMemo(() => {
    const map = {};
    actualRows.forEach((r) => { if (r.area_name) map[String(r.zip_code)] = r.area_name; });
    return map;
  }, [actualRows]);

  // Forecast from the lowest-MSE panel model, mapped onto the grid's row shape
  const panelForecast = useMemo(
    () => (best ? toDashboardRows(best, areaByZip) : { rows: [], reason: null }),
    [best, areaByZip]
  );
  const usingPanelForecast = panelForecast.rows.length > 0;

  // When a panel forecast is loaded it replaces the default forecast rows
  const allRows = useMemo(() => {
    if (!Array.isArray(rows)) return rows;
    return usingPanelForecast ? [...actualRows, ...panelForecast.rows] : rows;
  }, [rows, actualRows, panelForecast, usingPanelForecast]);

  const { grouped, years, zipOptions, forecastYears } = useMemo(() => {
    if (!Array.isArray(allRows)) return { grouped: [], years: [], zipOptions: [], forecastYears: new Set() };

    const byZip = {};
    const yearSet = new Set();
    const forecastYearSet = new Set();

    for (const row of allRows) {
      yearSet.add(row.fiscal_year);
      if (row.is_forecast) forecastYearSet.add(row.fiscal_year);

      if (!byZip[row.zip_code]) {
        byZip[row.zip_code] = {
          zip_code: row.zip_code,
          area_name: row.area_name,
          years: {},
        };
      }
      if (!byZip[row.zip_code].years[row.fiscal_year]) {
        byZip[row.zip_code].years[row.fiscal_year] = {};
      }
      byZip[row.zip_code].years[row.fiscal_year][row.bedrooms] = row.safmr_rent;
    }

    const groupedArr = Object.values(byZip).sort((a, b) =>
      a.zip_code.localeCompare(b.zip_code)
    );

    return {
      grouped: groupedArr,
      years: Array.from(yearSet).sort((a, b) => b - a),
      zipOptions: groupedArr.map((z) => z.zip_code),
      forecastYears: forecastYearSet,
    };
  }, [allRows]);

  const safmrGridProps = useMemo(
    () => buildSafmrGridProps({ rows: grouped, years, bedrooms: BEDROOMS, forecastYears }),
    [grouped, years, forecastYears]
  );

  useEffect(() => {
    if (!selectedZip && zipOptions.length > 0) {
      setSelectedZip(zipOptions[0]);
    }
  }, [zipOptions, selectedZip]);

  const chartData = useMemo(() => {
    if (!selectedZip) return [];
    const zipRow = grouped.find((z) => z.zip_code === selectedZip);
    if (!zipRow) return [];

    const sortedYears = [...years].sort((a, b) => a - b);

    return sortedYears.map((year, idx) => {
      const point = { year: `FY${year}` };
      const isForecastYear = forecastYears.has(year);
      const prevYear = sortedYears[idx - 1];

      BEDROOMS.forEach((bd) => {
        const value = zipRow.years[year]?.[bd] ?? null;
        if (isForecastYear) {
          point[`${bd}BR_forecast`] = value;
          if (prevYear != null && !forecastYears.has(prevYear)) {
            point[`${bd}BR_forecast`] = point[`${bd}BR_forecast`] ?? zipRow.years[prevYear]?.[bd] ?? null;
          }
        } else {
          point[`${bd}BR`] = value;
        }
      });
      return point;
    });
  }, [selectedZip, grouped, years, forecastYears]);

  const handleDownloadCsv = () => {
    const lines = ["zip_code,fiscal_year,area_name,bedroom,safmr_rent,is_forecast"];

    [...allRows]
      .sort(
        (a, b) =>
          a.zip_code.localeCompare(b.zip_code) ||
          a.fiscal_year - b.fiscal_year ||
          a.bedrooms - b.bedrooms
      )
      .forEach((r) =>
        lines.push(
          [r.zip_code, r.fiscal_year, r.area_name, r.bedrooms, r.safmr_rent, r.is_forecast ? "yes" : "no"]
            .map(csvEscape)
            .join(",")
        )
      );

    downloadCsv("dfw_safmr_panel.csv", lines);
  };

  if (loading) {
    return <div className="p-4 text-gray-500">Loading DFW rental data…</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        {error}
        <button onClick={() => handleFetch("data/dfw-safmr")} className="ml-3 underline">
          Retry
        </button>
      </div>
    );
  }

  if (!grouped.length) {
    return <div className="p-4 text-gray-500">No data available.</div>;
  }

  if (view === "forecast") {
    return (
      <PanelData
        initialData={actualRows}
        onViewForecast={() => setView("table")}
      />
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">
          Dallas-Fort Worth Small Area Fair Market Rents
        </h2>
        <div className="flex items-center gap-2">
          {view === "graph" && (
            <select
              value={selectedZip}
              onChange={(e) => setSelectedZip(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {zipOptions.map((zip) => (
                <option key={zip} value={zip}>
                  {zip}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setView(view === "table" ? "graph" : "table")}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
          >
            {view === "table" ? "Show Graph" : "Show Table"}
          </button>
          <button
            onClick={handleDownloadCsv}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
          >
            Download CSV
          </button>
          <button onClick={() => setView("forecast")} className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50">
            Forecast Next Year
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {years.length} fiscal year{years.length !== 1 ? "s" : ""} · {grouped.length} ZIP codes
        {forecastYears.size > 0 && (
          <> · includes {[...forecastYears].sort().map((y) => `FY${y}`).join(", ")} forecast</>
        )}
      </p>

      {best && (
        <ModelReport
          best={best}
          forecastRowCount={panelForecast.rows.length}
          reason={panelForecast.reason}
          onReset={() => dispatch(clearBestMethod())}
        />
      )}

      {!usingPanelForecast && forecastYears.size > 0 && (
        <div className="mb-3 text-sm bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <span className="font-medium text-blue-900">
            {[...forecastYears].sort().map((y) => `FY${y}`).join(" and ")} are model forecasts, not published HUD data.
          </span>
          <div className="text-blue-800 mt-1">
            Model: {MODEL_LABELS[modelName] || modelName || "unknown"}
          </div>
          <div className="text-blue-800 mt-1">
            Based on: {MODEL_FACTORS.join("; ")}.
          </div>
          <div className="text-blue-700 mt-1 text-xs">
            Note: this model does not currently incorporate macroeconomic factors (mortgage rates, CPI, employment, etc.) — forecasts are based solely on each ZIP's own historical rent trend and bedroom size.
          </div>
        </div>
      )}

      {!usingPanelForecast && forecastError && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Forecast unavailable: {forecastError}. Showing actual data only.
        </div>
      )}

      {!usingPanelForecast && skippedZips.length > 0 && (
        <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {skippedZips.length} ZIP code{skippedZips.length !== 1 ? "s" : ""} had too little history to forecast and {skippedZips.length !== 1 ? "were" : "was"} skipped: {skippedZips.join(", ")}
        </div>
      )}

      {Object.keys(failures).length > 0 && (
        <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Some years failed to load:{" "}
          {Object.entries(failures).map(([y, msg]) => `FY${y} (${msg})`).join(", ")}
        </div>
      )}

      {view === "graph" ? (
        <div className="border border-gray-200 rounded p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            SAFMR trend for ZIP {selectedZip}
          </h3>
          {chartData.length === 0 ? (
            <div className="text-sm text-gray-500">No data for this ZIP.</div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip formatter={(value) => (value != null ? `$${value.toLocaleString()}` : "—")} />
                <Legend />
                {BEDROOMS.map((bd, i) => (
                  <React.Fragment key={bd}>
                    <Line
                      type="monotone"
                      dataKey={`${bd}BR`}
                      name={`${bd}BR (actual)`}
                      stroke={BEDROOM_COLORS[i]}
                      connectNulls
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey={`${bd}BR_forecast`}
                      name={`${bd}BR (forecast)`}
                      stroke={BEDROOM_COLORS[i]}
                      strokeDasharray="6 4"
                      connectNulls
                      strokeWidth={2}
                      dot={{ r: 3, strokeDasharray: "" }}
                      legendType="none"
                    />
                  </React.Fragment>
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : (
          <DataGrid {...safmrGridProps} height={500} />
      )}
    </div>
  );
}
