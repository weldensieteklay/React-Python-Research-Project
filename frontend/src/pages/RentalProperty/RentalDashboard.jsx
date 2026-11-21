import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import Select from "react-select";
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
import RentDriversSection from "./RentDriversSection";
import RentByGroupChart from "./RentByGroupChart";
import RentByZipChart from "./RentByZipChart";
import RentMap from "./RentMap";
import BackButton from "./BackButton";
import { useRentMetro, DFW_METRO } from "./useRentMetro";
import { RENTAL_DATA_ALLOWED_EMAILS } from '../../constants/constants';
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { pulse } from "../../theme";

const eyebrowSx = { fontSize: "0.875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "blue.700" };
const cardSx = { mb: 3, borderColor: "gray.200", borderRadius: 2 };
const focusRing = { outline: "none", "&.Mui-focusVisible": { boxShadow: (t) => `0 0 0 2px ${t.palette.blue[500]}` } };

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
    <Paper component="section" variant="outlined" aria-labelledby="explore-title" sx={{ ...cardSx, px: 3, py: 2.5 }}>
      <Typography variant="h2" id="explore-title" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", mt: 0.5, mb: 2 }}>Explore the rent data</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}>
        {VIEWS.map((v) => (
          <ButtonBase key={v.id} onClick={() => onOpen(v.id)}
                      sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left", borderRadius: 2, border: 2, borderColor: "gray.200", bgcolor: "gray.50", px: 2, py: 1.5, transition: "border-color 150ms, background-color 150ms", "&:hover": { borderColor: "blue.300", bgcolor: "blue.50" }, ...focusRing }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box component="span" sx={{ fontSize: "1.5rem" }} aria-hidden="true">{v.icon}</Box>
              <Box component="span" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900" }}>{v.title}</Box>
            </Box>
            <Typography variant="body2" sx={{ color: "gray.600", mt: 0.5 }}>{v.text}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: "auto", pt: 1, color: "blue.700" }}>Open →</Typography>
          </ButtonBase>
        ))}
      </Box>
    </Paper>
  );
}

/** Dashboard card that opens the "What drives rents?" page */
function DriversCard({ areaName, onOpen }) {
  return (
    <Paper component="section" variant="outlined" aria-labelledby="drivers-card-title" sx={cardSx}>
      <ButtonBase onClick={onOpen}
                  sx={{ width: "100%", display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { xs: "stretch", md: "center" }, justifyContent: "space-between", gap: 1.5, textAlign: "left", px: 3, py: 2, borderRadius: 2, transition: "background-color 150ms", "&:hover": { bgcolor: "blue.50" }, ...focusRing }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" id="drivers-card-title" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", mt: 0.5 }}>What drives rents in {areaName}?</Typography>
          <Typography variant="body2" sx={{ color: "gray.600", mt: 0.5 }}>
            Compare any county with the metro on income, new housing, rental growth, distance to downtown, density and
            mortgage rates, with the research behind each, plus a sample local market report.
          </Typography>
        </Box>
        <Box component="span" sx={{ flexShrink: 0, fontSize: "0.875rem", fontWeight: 600, color: "blue.700" }}>Open →</Box>
      </ButtonBase>
    </Paper>
  );
}

/** Full-screen page: ← at the top left, title, optional controls on the right. */
function DataPage({ title, subtitle, onBack, actions, children }) {
  return (
    // pb: room at the bottom so the last section scrolls clear of the fixed footer
    <PageShell>
      <PageHead>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <BackButton onClick={onBack} />
          <Box sx={{ pt: 0.5 }}>
            <PageTitle>{title}</PageTitle>
            {subtitle && <Typography variant="body2" sx={{ color: "gray.500", mt: 0.25 }}>{subtitle}</Typography>}
          </Box>
        </Box>
        {actions && <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, justifyContent: { md: "flex-end" } }}>{actions}</Box>}
      </PageHead>
      {children}
    </PageShell>
  );
}

/** Grey full-height page with room at the bottom to scroll clear of the fixed footer. */
const PageShell = ({ children }) => (
  <Box sx={{ p: 3, pb: 14, bgcolor: "gray.50", minHeight: "100vh" }}>{children}</Box>
);

/** Header row of a page, ruled off from the content below. */
const PageHead = ({ children }) => (
  <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "center" }, justifyContent: "space-between", gap: 1.5, pb: 2, mb: 2, borderBottom: 1, borderColor: "gray.200" }}>
    {children}
  </Box>
);

const PageTitle = ({ children }) => (
  <Typography variant="h1" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", letterSpacing: "-0.025em" }}>{children}</Typography>
);

const CHART_LEVELS = [
  ["county", "By county"],
  ["zip", "By ZIP code"],
];

/** Short name for headings: "Dallas-Fort Worth (DFW)" or "Austin-Round Rock-Georgetown, TX" */
const metroTitle = (metro) => (metro === DFW_METRO ? "Dallas-Fort Worth (DFW)" : metro);
/** Name inside a sentence: "DFW" or "Austin-Round Rock-Georgetown" (no state) */
const metroShort = (metro) => (metro === DFW_METRO ? "DFW" : metro.replace(/, [A-Z]{2}(-[A-Z]{2})*$/, ""));
const metroSlug = (metro) => metro.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** The metro picker for the page header: every metro Zillow covers, A–Z and searchable. The
 *  viewer's location is asked for automatically on their first visit (useRentMetro); the list
 *  changes it after that. The shown metro stays selectable even if the list hasn't loaded. */
function MetroSelect({ metro, metros, onChoose }) {
  const options = useMemo(() => {
    const list = metros?.length ? [...metros] : [];
    if (!list.some((m) => m.metro === metro)) list.push({ metro, zip_count: null });
    return list
      .sort((a, b) => a.metro.localeCompare(b.metro))
      .map((m) => ({ value: m.metro, label: m.metro, zips: m.zip_count }));
  }, [metros, metro]);
  const selected = options.find((o) => o.value === metro) ?? null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", md: "auto" } }}>
      <Typography component="label" htmlFor="metro-select" variant="body2" sx={{ flexShrink: 0, fontWeight: 600, color: "gray.600" }}>
        <span aria-hidden="true">📍 </span>Metro
      </Typography>
      <Box sx={{ width: { xs: "100%", md: 320 }, fontSize: "0.875rem" }}>
      <Select
        inputId="metro-select"
        classNamePrefix="react-select"
        options={options}
        value={selected}
        onChange={(o) => o && o.value !== metro && onChoose(o.value)}
        placeholder="Search for a metro…"
        noOptionsMessage={({ inputValue }) => `No metro matches "${inputValue}"`}
        // Search the metro name only; the ZIP count is shown but not searched
        filterOption={(o, input) => o.label.toLowerCase().includes(input.trim().toLowerCase())}
        formatOptionLabel={(o, { context }) => (
          <span>
            {o.label}
            {context === "menu" && o.zips ? <Box component="span" sx={{ color: "gray.400" }}> · {o.zips} ZIPs</Box> : null}
          </span>
        )}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
        styles={{ menuPortal: (base) => ({ ...base, zIndex: 1500 }) }}
      />
      </Box>
    </Box>
  );
}

/** One short line under the page title: finding the viewer's area, where it matched, or why not. */
function LocationNote({ match, note, locating }) {
  const near = match?.city ? `${match.city} (${match.zip_code})` : match?.zip_code;
  return (
    <Box aria-live="polite" sx={{ fontSize: "0.875rem" }}>
      {locating && <Box component="p" sx={{ color: "gray.500" }}>Finding your area… allow location access when your browser asks.</Box>}
      {!locating && match && (
        <Box component="p" sx={{ color: "gray.500" }}>
          Matched to your location{near ? ` near ${near}` : ""}
          {match.metro_zip_count ? ` · ${match.metro_zip_count} ZIP codes` : ""}
        </Box>
      )}
      {!locating && note && <Box component="p" sx={{ color: "amber.700" }}>{note}</Box>}
    </Box>
  );
}

function Toggle({ options, value, onChange, size = "md", label }) {
  const pad = size === "sm" ? { px: 1.5, py: 0.5, fontSize: "0.75rem" } : { px: 2, py: 0.75, fontSize: "0.875rem" };
  return (
    <Tabs value={value} onChange={(_, v) => onChange(v)} aria-label={label}
          slotProps={{ indicator: { sx: { display: "none" } } }}
          sx={{ minHeight: 0, display: "inline-flex", border: 1, borderColor: "gray.300", borderRadius: 1.5, bgcolor: "common.white" }}>
      {options.map(([v, text]) => (
        <Tab key={v} value={v} label={text} disableRipple
             sx={{ ...pad, minHeight: 0, minWidth: 0, lineHeight: 1.43, fontWeight: 600, textTransform: "none", color: "gray.700", transition: "background-color 150ms",
                   "&:not(:last-of-type)": { borderRight: 1, borderColor: "gray.300" },
                   "&:hover": { bgcolor: "gray.50" },
                   "&.Mui-selected": { bgcolor: "gray.800", color: "common.white" } }} />
      ))}
    </Tabs>
  );
}

export default function RentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  // Map locations (ZIP lat/lon), loaded the first time the map is shown
  const cov = useFetchData();
  const metroList = useFetchData();
  const { metro, match, note, locating, chooseMetro } = useRentMetro();
  const isDfw = metro === DFW_METRO;

  // Screens visited, newest last; ← goes back one. dashboard | map | charts | grid | drivers | research | forecast
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
    metroList.handleFetch("data/rent-metros");
  }, []);

  // Rent rows for the chosen metro; a forecast trained on another metro no longer applies
  const shownMetro = useRef(null);
  useEffect(() => {
    if (shownMetro.current && shownMetro.current !== metro) {
      dispatch(clearBestMethod());
      home();
    }
    shownMetro.current = metro;
    handleFetch("data/dfw-zori", { metro });
  }, [metro]);

  // Responses say which metro they are for. One for a metro the viewer has since left
  // (e.g. DFW arriving after their location switched the dashboard to Austin) is never shown.
  const dataIsCurrent = Boolean(data) && (data.metro ?? DFW_METRO) === metro;
  const refetchedFor = useRef(null);
  useEffect(() => {
    if (data && !dataIsCurrent && !loading && !error && refetchedFor.current !== metro) {
      refetchedFor.current = metro;   // once per metro, so a mismatch can never loop
      handleFetch("data/dfw-zori", { metro });
    }
  }, [data, dataIsCurrent, loading, error, metro]);

  // Map locations for this metro, loaded the first time the map is opened
  const covIsCurrent = Boolean(cov.data) && (cov.data.metro ?? DFW_METRO) === metro;
  const covAskedFor = useRef(null);
  const loadCovariates = () => {
    covAskedFor.current = metro;
    cov.handleFetch("data/dfw-zip-covariates", { metro });
  };
  useEffect(() => {
    if (page === "map" && !covIsCurrent && !cov.loading && covAskedFor.current !== metro) loadCovariates();
  }, [page, metro, covIsCurrent, cov.loading]);

  const rows = dataIsCurrent ? data?.rows : undefined;

  const actualRows = useMemo(() => (Array.isArray(rows) ? rows.filter((r) => !r.is_forecast) : []), [rows]);
  const panelForecast = useMemo(() => (best ? toDashboardRows(best, actualRows, metro) : { rows: [], reason: null }), [best, actualRows, metro]);
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
    downloadCsv(`${metroSlug(metro)}_zori_private_equity_panel.csv`, lines);
  };

  const modelReport = best && (
    <ModelReport best={best} forecastRowCount={panelForecast.rows.length} reason={panelForecast.reason} onReset={() => dispatch(clearBestMethod())} />
  );

  // The report doesn't need the rent rows to open
  if (page === "research") {
    return <RentDivergenceReport metro={metro} areaName={metroShort(metro)} onBack={back} onTrainForecast={() => go("forecast")} />;
  }
  const errorLinkSx = { ml: 2, fontSize: "inherit", fontWeight: 600, color: "red.900", verticalAlign: "baseline" };
  if (loading || (!dataIsCurrent && !error)) return <Box sx={{ p: 4, textAlign: "center", color: "gray.500", fontWeight: 500, ...pulse }}>Loading {metroTitle(metro)} rent data…</Box>;
  if (error) return <Box sx={{ p: 3, m: 2, bgcolor: "red.50", border: 1, borderColor: "red.200", borderRadius: 2, color: "red.700" }}>Error: {error}<Link component="button" underline="always" onClick={() => handleFetch("data/dfw-zori", { metro })} sx={errorLinkSx}>Retry</Link>{!isDfw && <Link component="button" underline="always" onClick={() => chooseMetro(DFW_METRO)} sx={errorLinkSx}>Show Dallas-Fort Worth instead</Link>}</Box>;
  // ← returns to the screen they came from (the Boom Divergence report); "View forecast" starts over at the dashboard
  if (page === "forecast") return <PanelData initialData={actualRows} onBack={back} onViewForecast={home} />;
  if (!gridRows.length) return <Box sx={{ p: 4, textAlign: "center", color: "gray.400" }}>No rent data available yet.</Box>;

  if (page === "map") {
    return (
      <DataPage title="Rent map" subtitle={`Typical monthly rent by county and ZIP code in ${metroTitle(metro)}`}
                onBack={() => (mapCounty ? setMapCounty(null) : back())}>
        {modelReport}
        <RentMap
          rows={gridRows}
          areaName={metroTitle(metro)}
          covariates={covIsCurrent ? cov.data.rows : undefined}
          loading={cov.loading || (!covIsCurrent && !cov.error)}
          error={covIsCurrent ? null : cov.error}
          onRetry={loadCovariates}
          county={mapCounty}
          onCountyChange={setMapCounty}
          height="max(520px, calc(100vh - 300px))"
        />
      </DataPage>
    );
  }

  if (page === "drivers") {
    return (
      <DataPage title={`What drives rents in ${metroShort(metro)}?`}
                subtitle="Neighborhood factors from the U.S. Census, compared by county, with the research behind each"
                onBack={back}>
        <RentDriversSection metro={metro} areaName={metroShort(metro)} rows={actualRows} asPage />
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
                  <Button variant="outlined" onClick={handleDownloadCsv} sx={{ px: 2, py: 0.75, fontSize: "0.875rem", fontWeight: 600, borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { borderColor: "gray.300", bgcolor: "gray.50" } }}>📥 Download CSV</Button>
                )}>
        {modelReport}
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: "gray.200", overflow: "hidden" }}>
          <DataGrid {...zoriGridProps} height={Math.max(500, (typeof window !== "undefined" ? window.innerHeight : 800) - 200)} />
        </Paper>
      </DataPage>
    );
  }

  return (
    <PageShell>
      {/* Header: ← and the metro on the left, the metro picker on the right */}
      <PageHead>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, minWidth: 0 }}>
          <BackButton onClick={() => navigate(MAIN_DASHBOARD_ROUTE)} label="Back to dashboard" />
          <Box sx={{ pt: 0.5, minWidth: 0 }}>
            <PageTitle>{metroTitle(metro)} Rental Property Portal</PageTitle>
            <Typography variant="body2" sx={{ color: "gray.500", mt: 0.25 }}>Zillow Observed Rent Index (ZORI) and macroeconomic indicators</Typography>
            <LocationNote match={match} note={note} locating={locating} />
          </Box>
        </Box>
        <MetroSelect metro={metro} metros={metroList.data?.metros} onChoose={chooseMetro} />
      </PageHead>

      {/* Boom-divergence research for the metro shown (its own counties and main city) */}
      <BoomDivergenceSummary metro={metro} areaName={metroShort(metro)} onOpenReport={() => go("research")} />

      {/* Drivers of rent: a short card here; the details are on their own page */}
      <DriversCard areaName={metroShort(metro)} onOpen={() => go("drivers")} />

      {modelReport}

      <ViewPicker onOpen={(id) => { if (id === "map") setMapCounty(null); go(id); }} />
    </PageShell>
  );
}
