import { monthLabel, currencyFormatter, percentFormatter, FACTOR_LABELS, ZORI_GRID_STYLES, runDetails } from "./utils";

// Macro columns shown in the grid, in order. Values arrive from the API already in percent.
const RATE_COLUMNS = [
    "real_gdp_growth",
    "unemployment_rate",
    "unemployment_rate_lag_6m",
    "interest_rate",
    "mortgage_rate_30y",
    "inflation_rate",
];

// ===========================================================================
// AG-GRID DYNAMIC COLUMN DEFINITION SETS
// ===========================================================================
export function buildZoriGridProps({ rows, forecastMonths = new Set() }) {
    const pinnedCols = [
        { headerName: "ZIP Code", field: "zip_code", pinned: "left", width: 110, cellClass: "font-mono font-medium", filter: "agTextColumnFilter" },
        { headerName: "City", field: "City", pinned: "left", width: 150, filter: "agTextColumnFilter" },
        { headerName: "County", field: "county", pinned: "left", width: 150, filter: "agTextColumnFilter" },
        {
            headerName: "Month",
            field: "month_year",
            pinned: "left",
            width: 110,
            sort: "desc",
            cellClass: (params) => forecastMonths.has(params.value) ? "zori-cell-forecast font-medium" : "font-medium"
        },
    ];

    const valueCols = [
        {
            headerName: "Observed Rent Index (ZORI)",
            field: "zori_rent",
            width: 210,
            type: "leftAligned",
            valueFormatter: currencyFormatter,
            cellClass: (params) => params.data?.is_forecast ? "zori-cell-forecast font-semibold text-base text-emerald-700" : "font-semibold text-base",
        },
        {
            headerName: "Real GDP ($B)",
            field: "real_gdp",
            width: 130,
            valueFormatter: currencyFormatter,
        },
        ...RATE_COLUMNS.map((field) => ({
            headerName: FACTOR_LABELS[field] || field,
            field,
            width: 150,
            type: "numericColumn",
            filter: "agNumberColumnFilter",
            valueFormatter: percentFormatter(2),
        })),
    ];
    return {
        columnDefs: [...pinnedCols, ...valueCols],
        rowData: rows,
        extraStyles: ZORI_GRID_STYLES,
        getRowId: (params) => `${params.data.zip_code}_${params.data.month_year}`,
    };
}

// ===========================================================================
// MODEL-READY ROWS for the forecast screen and the explorer
// ===========================================================================
// The /dfw-zori rows carry Zillow bookkeeping columns (RegionID, SizeRank, raw_date,
// datetime, state, msa_name, RegionType) that are either duplicates of month_year or
// the same value on every row. Offered as predictors they only add noise or leak the
// row order, so they're left out here.
const PANEL_COLUMNS = [
    "zip_code", "City", "county", "month_year", "year", "fiscal_year", "zori_rent",
    "real_gdp", "real_gdp_growth",
    "unemployment_rate", "unemployment_rate_change", "unemployment_rate_lag_6m",
    "interest_rate", "interest_rate_change", "mortgage_rate_30y", "inflation_rate",
];
export const CENSUS_COLUMNS = [
    "dist_downtown_mi", "median_household_income", "renter_share",
    "pop_density_sqmi", "new_build_share", "renter_stock_growth",
];

/**
 * rows: actual (non-forecast) /dfw-zori rows. covariates: /dfw-zip-covariates rows or null.
 * Adds month_of_year (rents are seasonal: spring months rise, autumn months dip) and
 * months_since_start (a trend term). Not named time_index: the boosting backend adds its own
 * time_index feature and an identically named input column used to crash it.
 */
export function toModelRows(rows, covariates = null) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const covByZip = {};
    for (const c of covariates ?? []) covByZip[String(c.zip_code)] = c;
    // Only Census columns that have data: a source that failed to load leaves its column
    // empty, and an all-empty predictor makes every row incomplete.
    const censusCols = CENSUS_COLUMNS.filter((c) => (covariates ?? []).some((r) => r[c] != null));

    const firstMonth = rows.reduce((min, r) => (r.month_year < min ? r.month_year : min), rows[0].month_year);
    const [y0, m0] = firstMonth.split("-").map(Number);

    return rows.map((r) => {
        const out = {};
        for (const c of PANEL_COLUMNS) out[c] = r[c] ?? null;
        const [y, m] = String(r.month_year).split("-").map(Number);
        out.month_of_year = m;
        out.months_since_start = (y - y0) * 12 + (m - m0);
        if (censusCols.length) {
            const cov = covByZip[String(r.zip_code)] || {};
            for (const c of censusCols) out[c] = cov[c] ?? null;
        }
        return out;
    });
}

// ===========================================================================
// METADATA JOIN MATRIX TRANSFORMER
// ===========================================================================
export function toDashboardRows(best, currentRows = []) {
    const run = runDetails(best);
    const fc = run.forecast;
    if (fc.length === 0) {
        return {
            rows: [],
            reason: run.forecastError
                ? `The forecast failed: ${run.forecastError}.`
                : "This model run has no forecast (forecast horizon was 0).",
        };
    }

    // The grid is monthly. A model trained on a yearly date column returns periods like 2027,
    // which can't be placed on it.
    const isMonthly = (p) => /^\d{4}-\d{2}/.test(String(p));
    if (!fc.every((f) => isMonthly(f.period))) {
        return {
            rows: [],
            reason: `This forecast is for periods like ${fc[0].period}, not months. Train with month_year as the date column to show it on this grid.`,
        };
    }

    const cfg = best.config || {};
    if (cfg.idColumn !== "zip_code" || cfg.dependentVar !== "zori_rent") {
        return {
            rows: [],
            reason: "To project ZORI analytics onto this grid, train your model with zip_code as ID and zori_rent as Dependent Variable.",
        };
    }

    const metaMap = {};
    const observed = new Set();   // zip_month pairs that already have an actual rent
    currentRows.forEach((r) => {
        observed.add(`${r.zip_code}_${r.month_year}`);
        if (r.zip_code && !metaMap[r.zip_code]) {
            metaMap[r.zip_code] = { City: r.City, county: r.county, msa_name: r.msa_name, state: r.state };
        }
    });

    const rows = [];
    for (const f of fc) {
        const mYear = monthLabel(f.period);
        if (f.predicted == null) continue;

        const zipStr = String(f.id);
        // A forecast for a month that already has an actual would duplicate the grid's
        // row id (zip_month) and double-count that month in the export; the actual wins.
        if (observed.has(`${zipStr}_${mYear}`)) continue;
        const meta = metaMap[zipStr] || {};
        const year = Number(mYear.slice(0, 4));
        const month = Number(mYear.slice(5, 7));

        rows.push({
            zip_code: zipStr,
            RegionID: meta.RegionID || null,
            SizeRank: meta.SizeRank || null,
            RegionType: "zip",
            state: meta.state || "TX",
            City: meta.City || "Forecast Target",
            county: meta.county || "DFW Area",
            msa_name: meta.msa_name || "Dallas-Fort Worth-Arlington, TX",
            month_year: mYear,
            year,
            fiscal_year: year + (month >= 10 ? 1 : 0),   // HUD fiscal year, Oct-Sep
            zori_rent: Math.round(f.predicted),
            is_forecast: true,
            real_gdp: f.inputs?.real_gdp ?? null,
            real_gdp_growth: f.inputs?.real_gdp_growth ?? null,
            unemployment_rate: f.inputs?.unemployment_rate ?? null,
            unemployment_rate_lag_6m: f.inputs?.unemployment_rate_lag_6m ?? null,
            interest_rate: f.inputs?.interest_rate ?? null,
            mortgage_rate_30y: f.inputs?.mortgage_rate_30y ?? null,
            inflation_rate: f.inputs?.inflation_rate ?? null
        });
    }
    return { rows, reason: rows.length > 0 ? null : "Could not safely decouple forecast items into valid spatial rows." };
}
