import React, { useEffect, useMemo, useState } from "react";
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
import SafmrGrid from "../../components/table/AgGridTable"; // adjust path to match your folder layout

const BEDROOMS = [0, 1, 2, 3, 4];
const BEDROOM_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626"];

const MODEL_LABELS = {
  gradient_boosting: "Gradient Boosting (sklearn GradientBoostingRegressor)",
};

const MODEL_FACTORS = [
  "Bedroom size (0–4BR)",
  "Prior 3 years of SAFMR rent for the same ZIP/bedroom (autoregressive lags)",
];

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

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [view, setView] = useState("table");
  const [selectedZip, setSelectedZip] = useState("");

  useEffect(() => {
    handleFetch("data/dfw-safmr");
  }, []);

  const rows = data?.rows;
  const failures = data?.failures || {};
  const modelName = data?.model || null;
  const forecastError = data?.forecast_error || null;
  const skippedZips = data?.skipped_zips || [];

  const { grouped, years, zipOptions, forecastYears } = useMemo(() => {
    if (!Array.isArray(rows)) return { grouped: [], years: [], zipOptions: [], forecastYears: new Set() };

    const byZip = {};
    const yearSet = new Set();
    const forecastYearSet = new Set();

    for (const row of rows) {
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
  }, [rows]);

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

    [...rows]
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
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {years.length} fiscal year{years.length !== 1 ? "s" : ""} · {grouped.length} ZIP codes
        {forecastYears.size > 0 && (
          <> · includes {[...forecastYears].sort().map((y) => `FY${y}`).join(", ")} forecast</>
        )}
      </p>

      {forecastYears.size > 0 && (
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

      {forecastError && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Forecast unavailable: {forecastError}. Showing actual data only.
        </div>
      )}

      {skippedZips.length > 0 && (
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
        <SafmrGrid
          rows={grouped}
          years={years}
          bedrooms={BEDROOMS}
          forecastYears={forecastYears}
          height={500}
        />
      )}
    </div>
  );
}