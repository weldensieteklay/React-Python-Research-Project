import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useFetchData } from "../../hooks/useFetchData";
import DataGrid from "../../components/table/AgGridTable";
import PanelData from "../../components/PanelData";
import { selectBestMethod, clearBestMethod } from "../../store/reducers/rentalProperty/rentalPropertySlice";

//hooks
import { useUser } from '../../hooks/useUser';

// Import custom sub-modules
import { csvEscape, downloadCsv } from "./utils";
import { buildZoriGridProps, toDashboardRows } from "./transformer";
import { ModelReport } from "./reports";
import RentDivergenceReport from "./RentDivergenceReport";
import BoomDivergenceSummary from "./BoomDivergenceSummary";
import RentByGroupChart from "./RentByGroupChart";
import RentByZipChart from "./RentByZipChart";
import RentMap from "./RentMap";
import BackButton from "./BackButton";
import { RENTAL_DATA_ALLOWED_EMAILS } from '../../constants/constants';

// Where the ← on the rental dashboard goes: the main dashboard (same as the Home icon)
const MAIN_DASHBOARD_ROUTE = "/dashboard";

// Exported panel columns. Rates are in percent; real_gdp is joined on HUD fiscal year (Oct-Sep).
const EXPORT_COLUMNS = [
  "zip_code", "month_year", "fiscal_year", "City", "county", "zori_rent", "is_forecast",
  "real_gdp", "real_gdp_growth",
  "unemployment_rate", "unemployment_rate_change", "unemployment_rate_lag_6m",
  "interest_rate", "interest_rate_change", "mortgage_rate_30y", "inflation_rate",
];

// The three ways to look at the data, shown as cards under "Explore the rent data"
const VIEWS = [
  { id: "map", icon: "🗺️", title: "Map", text: "See rent by county, then click a county to see its ZIP codes." },
  { id: "charts", icon: "📊", title: "Charts", text: "Compare counties, or follow one ZIP code's rent over time." },
  { id: "grid", icon: "📋", title: "Data grid", text: "Every ZIP code and month in a table you can sort and filter." },
];

function ViewPicker({ onOpen }) {
  return (
    // Same card style as the Market research summary above it
    <section aria-labelledby="explore-title" className="mb-6 bg-white border border-gray-200 rounded-lg px-6 py-5">
      <div className="text-sm font-semibold uppercase tracking-wider text-blue-700">Data views</div>
      <h2 id="explore-title" className="text-xl font-bold text-gray-900 mt-1">Explore the rent data</h2>
      <p className="text-base text-gray-600 mt-1 mb-4">Choose how you'd like to see it.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => onOpen(v.id)}
                  className="flex flex-col text-left rounded-lg border-2 border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">{v.icon}</span>
              <span className="text-lg font-bold text-gray-900">{v.title}</span>
            </div>
            <p className="text-sm text-gray-600 mt-1">{v.text}</p>
            <p className="text-sm font-semibold mt-auto pt-2 text-blue-700">Open →</p>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Full-screen page: ← at the top left, title, optional controls on the right. */
function DataPage({ title, subtitle, onBack, actions, children }) {
  return (
    // pb-28: room at the bottom so the last section scrolls clear of the fixed footer
    <div className="p-6 pb-28 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-start gap-2">
          <BackButton onClick={onBack} />
          <div className="pt-1">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const CHART_LEVELS = [
  ["county", "By county"],
  ["zip", "By ZIP code"],
];

function Toggle({ options, value, onChange, size = "md", label }) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-md border border-gray-300 overflow-hidden bg-white">
      {options.map(([v, text]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
                className={`${pad} font-semibold transition-colors border-r last:border-r-0 border-gray-300 ${value === v ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  // Map locations (ZIP lat/lon), loaded the first time the map is shown
  const cov = useFetchData();

  // Screens visited, newest last; ← goes back one. dashboard | map | charts | grid | research | forecast
  const [history, setHistory] = useState(["dashboard"]);
  const page = history[history.length - 1];
  const go = (p) => setHistory((h) => [...h, p]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const home = () => setHistory(["dashboard"]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [page]);   // each screen starts at the top

  const [chartLevel, setChartLevel] = useState("county");
  // Open county on the map; ← closes it first, then leaves the map
  const [mapCounty, setMapCounty] = useState(null);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const best = useSelector(selectBestMethod);
  const { user } = useUser();
  const isAllowed = RENTAL_DATA_ALLOWED_EMAILS.includes(user?.email);

  useEffect(() => {
    handleFetch("data/dfw-zori");
  }, []);

  const [covRequested, setCovRequested] = useState(false);
  useEffect(() => {
    if (page === "map" && !covRequested) {
      setCovRequested(true);
      cov.handleFetch("data/dfw-zip-covariates");
    }
  }, [page, covRequested]);

  const rows = data?.rows;

  const actualRows = useMemo(() => (Array.isArray(rows) ? rows.filter((r) => !r.is_forecast) : []), [rows]);
  const panelForecast = useMemo(() => (best ? toDashboardRows(best, actualRows) : { rows: [], reason: null }), [best, actualRows]);
  const usingPanelForecast = panelForecast.rows.length > 0;

  const gridRows = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    return usingPanelForecast ? [...actualRows, ...panelForecast.rows] : rows;
  }, [rows, actualRows, panelForecast, usingPanelForecast]);

  const forecastMonths = useMemo(() => new Set(gridRows.filter((r) => r.is_forecast).map((r) => r.month_year)), [gridRows]);
  const zoriGridProps = useMemo(() => buildZoriGridProps({ rows: gridRows, forecastMonths }), [gridRows, forecastMonths]);

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

  const modelReport = best && (
    <ModelReport best={best} forecastRowCount={panelForecast.rows.length} reason={panelForecast.reason} onReset={() => dispatch(clearBestMethod())} />
  );

  // The report doesn't need the rent rows to open
  if (page === "research") {
    return <RentDivergenceReport onBack={back} onTrainForecast={() => go("forecast")} />;
  }
  if (loading) return <div className="p-8 text-center text-gray-500 font-medium animate-pulse">Loading DFW rent data…</div>;
  if (error) return <div className="p-6 m-4 bg-red-50 border border-red-200 rounded-lg text-red-700">Error: {error}<button onClick={() => handleFetch("data/dfw-zori")} className="ml-4 font-semibold underline text-red-900">Retry</button></div>;
  // ← returns to the screen they came from (the Boom Divergence report); "View forecast" starts over at the dashboard
  if (page === "forecast") return <PanelData initialData={actualRows} onBack={back} onViewForecast={home} />;
  if (!gridRows.length) return <div className="p-8 text-center text-gray-400">No rent data available yet.</div>;

  if (page === "map") {
    return (
      <DataPage title="Rent map" subtitle="Typical monthly rent by county and ZIP code"
                onBack={() => (mapCounty ? setMapCounty(null) : back())}>
        {modelReport}
        <RentMap
          rows={gridRows}
          covariates={cov.data?.rows}
          loading={cov.loading || (!cov.data && !cov.error)}
          error={cov.error}
          onRetry={() => cov.handleFetch("data/dfw-zip-covariates")}
          county={mapCounty}
          onCountyChange={setMapCounty}
          height="max(520px, calc(100vh - 300px))"
        />
      </DataPage>
    );
  }

  if (page === "charts") {
    return (
      <DataPage title="Rent charts" subtitle="Compare counties, or follow one ZIP code over time"
                onBack={back}
                actions={<Toggle options={CHART_LEVELS} value={chartLevel} onChange={setChartLevel} label="Chart level" />}>
        {modelReport}
        {chartLevel === "county"
          ? <RentByGroupChart rows={gridRows} groupField="county" groupLabel="County" height={480} />
          : <RentByZipChart rows={gridRows} height={480} />}
      </DataPage>
    );
  }

  if (page === "grid") {
    return (
      <DataPage title="Rent data grid" subtitle="Every ZIP code and month. Sort and filter with the column headers."
                onBack={back}
                actions={isAllowed && (
                  <button onClick={handleDownloadCsv} className="px-4 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">📥 Download CSV</button>
                )}>
        {modelReport}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <DataGrid {...zoriGridProps} height={Math.max(500, (typeof window !== "undefined" ? window.innerHeight : 800) - 200)} />
        </div>
      </DataPage>
    );
  }

  return (
    // pb-28: room below Data views so it scrolls clear of the fixed footer
    <div className="p-6 pb-28 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-gray-200 gap-4">
        <div className="flex items-start gap-2">
          <BackButton onClick={() => navigate(MAIN_DASHBOARD_ROUTE)} label="Back to dashboard" />
          <div className="pt-1">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Dallas-Fort Worth (DFW) Rental Property Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Powered by Zillow Observed Rent Index (ZORI) & Macroeconomic Transmissions</p>
          </div>
        </div>
      </div>

      <BoomDivergenceSummary onOpenReport={() => go("research")} />

      {modelReport}

      <ViewPicker onOpen={(id) => { if (id === "map") setMapCounty(null); go(id); }} />
    </div>
  );
}
