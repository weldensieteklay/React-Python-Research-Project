import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useFetchData } from "../../hooks/useFetchData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import DataGrid from "../../components/table/AgGridTable";
import PanelData from "../../components/PanelData";
import { selectBestMethod, clearBestMethod } from "../../features/rentalProperty/rentalPropertySlice";

//hooks
import { useUser } from '../../hooks/useUser';

// Import custom sub-modules
import { csvEscape, downloadCsv } from "./utils";
import { buildZoriGridProps, toDashboardRows } from "./transformer";
import { ModelReport } from "./reports";
import RentDivergenceReport from "./RentDivergenceReport";
import { RENTAL_DATA_ALLOWED_EMAILS } from '../../constants/constants';

// Exported panel columns. Rates are in percent; real_gdp is joined on HUD fiscal year (Oct-Sep).
const EXPORT_COLUMNS = [
  "zip_code", "month_year", "fiscal_year", "City", "county", "zori_rent", "is_forecast",
  "real_gdp", "real_gdp_growth",
  "unemployment_rate", "unemployment_rate_change", "unemployment_rate_lag_6m",
  "interest_rate", "interest_rate_change", "mortgage_rate_30y", "inflation_rate",
];

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [view, setView] = useState("table");
  const [selectedZip, setSelectedZip] = useState("");

  const dispatch = useDispatch();
  const best = useSelector(selectBestMethod);
  const { user } = useUser();
  const isAllowed = RENTAL_DATA_ALLOWED_EMAILS.includes(user?.email);

  useEffect(() => {
    handleFetch("data/dfw-zori");
  }, []);

  const rows = data?.rows;

  const actualRows = useMemo(() => (Array.isArray(rows) ? rows.filter((r) => !r.is_forecast) : []), [rows]);
  const panelForecast = useMemo(() => (best ? toDashboardRows(best, actualRows) : { rows: [], reason: null }), [best, actualRows]);
  const usingPanelForecast = panelForecast.rows.length > 0;

  const allRows = useMemo(() => {
    if (!Array.isArray(rows)) return rows;
    return usingPanelForecast ? [...actualRows, ...panelForecast.rows] : rows;
  }, [rows, actualRows, panelForecast, usingPanelForecast]);

  const { gridRows, zipOptions, forecastMonths } = useMemo(() => {
    if (!Array.isArray(allRows)) return { gridRows: [], zipOptions: [], forecastMonths: new Set() };
    const zipSet = new Set();
    const fMonthSet = new Set();

    for (const r of allRows) {
      if (r.zip_code) zipSet.add(r.zip_code);
      if (r.is_forecast) fMonthSet.add(r.month_year);
    }
    return { gridRows: allRows, zipOptions: Array.from(zipSet).sort(), forecastMonths: fMonthSet };
  }, [allRows]);

  const zoriGridProps = useMemo(() => buildZoriGridProps({ rows: gridRows, forecastMonths }), [gridRows, forecastMonths]);

  useEffect(() => {
    if (!selectedZip && zipOptions.length > 0) setSelectedZip(zipOptions[0]);
  }, [zipOptions, selectedZip]);

  const chartData = useMemo(() => {
    if (!selectedZip) return [];
    const zipEntries = gridRows.filter((r) => r.zip_code === selectedZip);
    return [...zipEntries].sort((a, b) => a.month_year.localeCompare(b.month_year)).map((r) => ({
      display_month: r.month_year,
      actual_rent: r.is_forecast ? null : Math.round(r.zori_rent),
      forecast_rent: r.is_forecast ? Math.round(r.zori_rent) : null,
    }));
  }, [selectedZip, gridRows]);

  const handleDownloadCsv = () => {
    const lines = [EXPORT_COLUMNS.map((c) => (c === "City" ? "city" : c)).join(",")];
    [...gridRows].sort((a, b) => a.zip_code.localeCompare(b.zip_code) || a.month_year.localeCompare(b.month_year)).forEach((r) =>
      lines.push(
        EXPORT_COLUMNS.map((c) => (c === "is_forecast" ? (r.is_forecast ? "yes" : "no") : r[c]))
          .map(csvEscape)  // csvEscape turns null/undefined into "" but keeps real zeros
          .join(",")
      )
    );
    downloadCsv("dfw_zori_private_equity_panel.csv", lines);
  };

  if (loading) return <div className="p-8 text-center text-gray-500 font-medium animate-pulse">Streaming Zillow ZORI infrastructure layers...</div>;
  if (error) return <div className="p-6 m-4 bg-red-50 border border-red-200 rounded-lg text-red-700">Error: {error}<button onClick={() => handleFetch("data/dfw-zori")} className="ml-4 font-semibold underline text-red-900">Retry</button></div>;
  if (!gridRows.length) return <div className="p-8 text-center text-gray-400">No core rental vectors established.</div>;
  if (view === "forecast") return <PanelData initialData={actualRows} onViewForecast={() => setView("table")} />;
  if (view === "research") return <RentDivergenceReport onBack={() => setView("table")} />;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-gray-200 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Dallas-Fort Worth Institutional Property Analytics Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Powered by Zillow Observed Rent Index (ZORI) & Macroeconomic Transmissions</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          {view === "graph" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Asset Filter:</span>
              <select value={selectedZip} onChange={(e) => setSelectedZip(e.target.value)} className="border border-gray-300 bg-white rounded-md px-3 py-1.5 text-sm font-mono font-medium focus:outline-none">
                {zipOptions.map((zip) => <option key={zip} value={zip}>ZIP {zip}</option>)}
              </select>
            </div>
          )}
          <button onClick={() => setView(view === "table" ? "graph" : "table")} className="px-4 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">
            {view === "table" ? "📊 Trend Charts" : "📋 Relational Grid"}
          </button>
          {isAllowed && <button onClick={handleDownloadCsv} className="px-4 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">📥 Export CSV</button>}
          <button onClick={() => setView("research")} className="px-4 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">🔬 Boom Divergence</button>
          <button onClick={() => setView("forecast")} className="px-4 py-1.5 text-sm font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">⚡ Train Forecast Engine</button>
        </div>
      </div>

      {best && <ModelReport best={best} forecastRowCount={panelForecast.rows.length} reason={panelForecast.reason} onReset={() => dispatch(clearBestMethod())} />}

      {view === "graph" ? (
        <div className="border border-gray-200 bg-white rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-md font-bold text-gray-800">Rent Term Structures: Market-Rate Growth Index for ZIP {selectedZip}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Isolates pure geographic lease variance omitting size anomalies.</p>
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="display_month" stroke="#6b7280" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} stroke="#6b7280" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => (value != null ? `$${value.toLocaleString()}` : "—")} />
              <Legend />
              <Line type="monotone" dataKey="actual_rent" name="Observed Market Rent (ZORI)" stroke="#059669" strokeWidth={3} dot={{ r: 2, fill: "#059669" }} connectNulls />
              <Line type="monotone" dataKey="forecast_rent" name="Machine Learning Forecast Vector" stroke="#d97706" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, fill: "#d97706" }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden"><DataGrid {...zoriGridProps} height={600} /></div>
      )}
    </div>
  );
}
