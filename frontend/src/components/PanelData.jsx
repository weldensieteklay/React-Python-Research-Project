import React, { useState, useRef, useEffect, useMemo } from "react";
import Select from "react-select";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import { parseCsvFile, computeSummaryStatistics } from "../utils/utils";
import SummaryStatisticsTable from "./SummaryStatisticsTable";
import { usePrediction } from "../hooks/usePrediction";
import CrossSectionalTable from "./CrossSectionalTable";
import LoadingOverlay from './LoadingOverlay';
import DownloadPptxButton from './dowload/DownloadPptxButton';
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import MultiCheckboxDropdown from "./MultiCheckboxDropdown";
import DownloadSummaryStatsPptxButton from './dowload/SummaryStatisticsPptxDowload';
import DataFilters, { EMPTY_FILTERS, applyFilters, filtersSignature, filterableColumns, activeFilterCount } from "./DataFilters";
import { checkPanel, buildPanelRows } from "./panelPayload";
import UserGuideButton from "../guideMe/UserGuideButton";
import { useDispatch, useSelector } from "react-redux";
import {
    submitMethodResult,
    clearBestMethod,
    selectBestMethod,
    getMse,
} from "../features/rentalProperty/rentalPropertySlice";

const methodOptions = [
    { value: "fixed", label: "Fixed Effects" },
    { value: "random", label: "Random Effects" },
    { value: "lasso", label: "LASSO" },
    { value: "ridge", label: "RIDGE" },
    { value: "forest", label: "FOREST" },
    { value: "boosting", label: "BOOSTING" },
    { value: "bagging", label: "BAGGING" },
];

const outlierOptions = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
];

// How far ahead to forecast, in steps of the date column (months for YYYY-MM data).
const HORIZON_CHOICES = [1, 2, 3, 6, 12, 18, 24];
const DEFAULT_HORIZON = { monthly: 6, other: 2 };

// Smallest panel worth fitting: enough entities and periods for the methods to estimate anything.
const MIN_IDS = 2;
const MIN_PERIODS = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Trend stage of the panel models (sent as `trend`). Without a trend, a forecast with the
// predictors held at their latest values is the same number in every future period.
const TREND_OPTIONS = [
    { value: "auto", label: "Auto (recommended)" },
    { value: "log", label: "Log (steady % growth)" },
    { value: "linear", label: "Linear (steady $ growth)" },
    { value: "none", label: "None (flat forecast)" },
];

// Smallest number of complete rows the backends accept
const MIN_ROWS = 5;

// "2026-09" or "2026-09-01" -> monthly; anything else (years, quarters) -> other
const detectFrequency = (values) => {
    const iso = values.filter((v) => /^\d{4}-\d{2}(-\d{2})?$/.test(v));
    if (iso.length !== values.length || iso.length < 2) return "other";
    const months = [...new Set(iso.map((v) => v.slice(0, 7)))];
    return months.length === iso.length ? "monthly" : "other";   // one value per month
};

// A usable dataset is a non-empty array whose items are plain objects.
const isUsableData = (data) =>
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((r) => r !== null && typeof r === "object" && !Array.isArray(r));

// Union of keys across the first rows, in first-seen order. Using more than
// just row 0 means a column that is missing from the first object still shows up.
const getColumns = (data, sampleSize = 200) => {
    const cols = new Set();
    data.slice(0, sampleSize).forEach((row) => Object.keys(row).forEach((k) => cols.add(k)));
    return [...cols];
};

const PanelData = ({
    initialData = null, // array of objects, e.g. [{ id: "A", year: 2020, y: 1.2, x1: 3 }, ...]
    // Called by the "View forecast in dashboard" button. Use it when this screen is shown
    // inside the dashboard (e.g. () => setView("table")); otherwise the button navigates.
    onViewForecast = null,
    rentalDashboardPath = "/dashboard/rental-property", // adjust to your route
}) => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [summaryStats, setSummaryStats] = useState([]);
    const [fileUploaded, setFileUploaded] = useState(false);
    const [dataSource, setDataSource] = useState(null); // "csv" | "initial" | null
    const [method, setMethod] = useState("");
    const [idColumn, setIdColumn] = useState("");
    const [dependentVar, setDependentVar] = useState("");
    const [independentVar, setIndependentVar] = useState([]);
    const [categoricalVar, setCategoricalVar] = useState([]);
    const [outliers, setOutliers] = useState("");
    const [activeView, setActiveView] = useState(null);

    const [selectedDateColumn, setSelectedDateColumn] = useState("");
    const [isValidDateColumn, setIsValidDateColumn] = useState(null);
    const [dateOptions, setDateOptions] = useState([]);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [showGuide, setShowGuide] = useState(false);
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [horizon, setHorizon] = useState(DEFAULT_HORIZON.other);
    const [trend, setTrend] = useState("auto");
    // Rows missing any predictor are dropped by the model. Forward-filling predictors within
    // each ID keeps the latest period when a series (e.g. inflation) is published late.
    const [fillGaps, setFillGaps] = useState(true);

    const fileInputRef = useRef(null);
    const { data: result, loading, error, handlePredict: runPrediction } = usePrediction();

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const bestMethod = useSelector(selectBestMethod);
    // Remembers which method/problem the in-flight request belongs to, so a result
    // is never credited to a method the user selected after clicking Predict.
    const lastRunRef = useRef(null);

    const columnOptions = columns.map((col) => ({ value: col, label: col }));
    const hasInitialData = isUsableData(initialData);

    // Everything downstream (summary statistics, prediction) uses the filtered rows
    const filteredData = useMemo(
        () => applyFilters(parsedData, filters, selectedDateColumn),
        [parsedData, filters, selectedDateColumn]
    );
    const filterColumns = useMemo(() => filterableColumns(parsedData, columns), [parsedData, columns]);

    // The target, the ID and the date can't also be predictors. Picking the target as a
    // predictor (easy with "Select All") gives a near-zero MSE and wins "best method".
    const reserved = useMemo(
        () => new Set([dependentVar, idColumn, selectedDateColumn].filter(Boolean)),
        [dependentVar, idColumn, selectedDateColumn]
    );
    const predictorOptions = useMemo(() => columns.filter((c) => !reserved.has(c)), [columns, reserved]);

    useEffect(() => {
        setIndependentVar((prev) => {
            const next = prev.filter((c) => !reserved.has(c));
            if (next.length !== prev.length) setCategoricalVar((cat) => cat.filter((c) => next.includes(c)));
            return next.length === prev.length ? prev : next;
        });
    }, [reserved]);

    // Panel shape after filtering, checked before allowing a run
    const panelShape = useMemo(() => {
        if (!idColumn || !selectedDateColumn) return null;
        const ids = new Set();
        const periods = new Set();
        for (const r of filteredData) {
            ids.add(r[idColumn]);
            periods.add(r[selectedDateColumn]);
        }
        return { ids: ids.size, periods: periods.size };
    }, [filteredData, idColumn, selectedDateColumn]);
    const panelTooSmall = panelShape && (panelShape.ids < MIN_IDS || panelShape.periods < MIN_PERIODS);

    // Fixed effects give every ID its own intercept, which absorbs any predictor that never
    // changes within an ID (county, distance to downtown, 2019 income...). Those get no
    // coefficient, so say so before the user wonders where they went.
    const absorbedByFixedEffects = useMemo(() => {
        if (method !== "fixed" || !idColumn || independentVar.length === 0) return [];
        return independentVar.filter((col) => {
            const firstById = new Map();
            for (const r of filteredData) {
                const id = r[idColumn];
                const v = r[col];
                if (v === null || v === undefined || v === "") continue;
                if (!firstById.has(id)) firstById.set(id, v);
                else if (firstById.get(id) !== v) return false;
            }
            return firstById.size > 0;
        });
    }, [method, idColumn, independentVar, filteredData]);
    const allAbsorbed = absorbedByFixedEffects.length > 0 && absorbedByFixedEffects.length === independentVar.length;

    // Everything the backend would reject or silently drop, found before the request
    const check = useMemo(
        () => checkPanel(filteredData, {
            idColumn, dateColumn: selectedDateColumn, dependentVar,
            predictors: independentVar, categorical: categoricalVar, fill: fillGaps,
        }),
        [filteredData, idColumn, selectedDateColumn, dependentVar, independentVar, categoricalVar, fillGaps]
    );
    const markTextAsCategorical = () =>
        setCategoricalVar((prev) => [...new Set([...prev, ...check.textPredictors])]);
    const dataBlocked =
        check.duplicates > 0 || check.textPredictors.length > 0 || allAbsorbed ||
        (dependentVar && independentVar.length > 0 && check.rowsUsable < MIN_ROWS);

    // -----------------------------------------------------------------------
    // Loading data (shared by initialData and CSV)
    // -----------------------------------------------------------------------
    const resetSelections = ({ keepBest = false } = {}) => {
        if (!keepBest) dispatch(clearBestMethod());
        setMethod("");
        setIdColumn("");
        setDependentVar("");
        setIndependentVar([]);
        setCategoricalVar([]);
        setOutliers("");
        setSelectedDateColumn("");
        setIsValidDateColumn(null);
        setDateOptions([]);
        setStartDate("");
        setEndDate("");
        setSummaryStats([]);
        setActiveView(null);
        setFilters(EMPTY_FILTERS);
        setHorizon(DEFAULT_HORIZON.other);
        setTrend("auto");
        setFillGaps(true);
    };

    const loadFromInitialData = (data, { keepBest = false } = {}) => {
        if (!isUsableData(data)) return;
        const cols = getColumns(data);

        resetSelections({ keepBest });
        setParsedData(data);
        setColumns(cols);
        setFileUploaded(true);
        setDataSource("initial");

        // Drop any previously chosen CSV file so the two sources don't conflict
        if (fileInputRef.current) fileInputRef.current.value = null;
    };

    // Seed from initialData when it arrives or changes. The parent should pass
    // a stable reference (state, or useMemo), not a new array on every render.
    useEffect(() => {
        if (isUsableData(initialData)) {
            // keepBest: re-opening this screen with the same data shouldn't discard earlier runs
            loadFromInitialData(initialData, { keepBest: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData]);

    // Submit each finished run to the store; the reducer keeps only the smallest MSE.
    useEffect(() => {
        if (!result || result.success === false || !lastRunRef.current) return;
        const mse = getMse(result);
        if (mse === null) return;
        dispatch(submitMethodResult({ ...lastRunRef.current, mse, result }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result]);

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            setColumns(getColumns(data));
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        resetSelections(); // old selections may not exist in the new file
        setDataSource("csv");
        setFileUploaded(true);
        parseCsvFile(file, onDataParsed);
    };

    // Reads from parsedData, so it works for both CSV and initialData
    // (the old version re-read the file input, which doesn't exist for initialData).
    const handleDateColumnChange = (selected) => {
        setSelectedDateColumn(selected?.value || "");
        setIsValidDateColumn(null);
        setDateOptions([]);
        setStartDate("");
        setEndDate("");
        // a date range set for the previous date column doesn't apply to the new one
        setFilters((f) => ({ ...f, start: "", end: "" }));

        if (!selected || parsedData.length === 0) return;

        const values = parsedData
            .map((r) => r[selected.value])
            .filter((v) => v !== null && v !== undefined && v !== "")
            .map((v) => String(v).trim());

        const isValid = values.some((v) => !isNaN(Date.parse(v)));
        setIsValidDateColumn(isValid);

        if (isValid) {
            const unique = [...new Set(values)].sort();
            setDateOptions(unique.map((d) => ({ value: d, label: d })));
            setHorizon(DEFAULT_HORIZON[detectFrequency(unique)]);
        }
    };

    const frequency = detectFrequency(dateOptions.map((o) => o.value));
    const horizonUnit = frequency === "monthly" ? "months" : "periods";

    const handleSummaryStatistics = () => {
        const selectedColumns = [dependentVar, ...independentVar].filter(Boolean);
        const stats = computeSummaryStatistics(filteredData, selectedColumns, categoricalVar);
        setSummaryStats(stats);
    };

    // Toggle a column in/out of the Independent Variables list.
    // If a column is removed from Independent Variables, it can no longer be
    // categorical either, so we drop it from categoricalVar at the same time.
    const handleIndependentToggle = (col) => {
        setIndependentVar((prev) => {
            const next = prev.includes(col)
                ? prev.filter((c) => c !== col)
                : [...prev, col];

            setCategoricalVar((prevCat) => prevCat.filter((c) => next.includes(c)));

            return next;
        });
    };

    // Categorical Variables can only be chosen from the already-selected
    // Independent Variables.
    const handleCategoricalToggle = (col) => {
        setCategoricalVar((prev) =>
            prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
        );
    };

    // "Select All" toggles between every allowed predictor and none.
    const handleSelectAllIndependent = (allCurrentlySelected) => {
        setIndependentVar(() => {
            const next = allCurrentlySelected ? [] : [...predictorOptions];
            setCategoricalVar((prevCat) => prevCat.filter((c) => next.includes(c)));
            return next;
        });
    };

    // Same idea, scoped to whatever is currently in Independent Variables.
    const handleSelectAllCategorical = (allCurrentlySelected) => {
        setCategoricalVar(allCurrentlySelected ? [] : [...independentVar]);
    };

    const isReadyToPredict =
        fileUploaded &&
        filteredData.length > 0 &&
        method &&
        idColumn &&
        dependentVar &&
        independentVar.length > 0 &&
        selectedDateColumn &&
        outliers &&
        !panelTooSmall &&
        !dataBlocked;

    const handlePredict = async () => {
        // MSE is only comparable between runs on the same problem: same target, same
        // predictors, same rows (filters) and same horizon. Anything else is a different
        // problem, and the "best method" comparison restarts.
        lastRunRef.current = {
            method,
            context: [
                dependentVar, idColumn, selectedDateColumn, outliers,
                [...independentVar].sort().join("+"),
                [...categoricalVar].sort().join("+"),
                filtersSignature(filters),
                `h=${horizon}`,
                `trend=${trend}`,
                `fill=${fillGaps}`,
            ].join("|"),
            // The dashboard needs these to map the forecast back onto its grid
            config: {
                idColumn,
                dependentVar,
                independentVar,
                categoricalVar,
                dateColumn: selectedDateColumn,
                outliers,
                filters,
                horizon,
                trend,
                fillGaps,
                rowsUsed: check.rowsUsable,
            },
        };
        const payload = {
            data: buildPanelRows(filteredData, {
                idColumn, dateColumn: selectedDateColumn, dependentVar,
                predictors: independentVar, fill: fillGaps,
            }),
            method,
            id_column: idColumn,
            dependent_variable: dependentVar,
            independent_variable: independentVar,
            categorical_variable: categoricalVar,
            outliers,
            date_column: selectedDateColumn,
            forecast_periods: horizon,
            trend,
        };
        await runPrediction(payload, `panel/${method}`);
    };

    const handleClear = () => {
        resetSelections();
        setFileUploaded(false);
        setParsedData([]);
        setColumns([]);
        setDataSource(null);
        if (fileInputRef.current) fileInputRef.current.value = null;
    };

    const handleViewForecast = () => {
        if (onViewForecast) onViewForecast();
        else navigate(rentalDashboardPath);
    };

    return (
        <>
            {/* Header */}
            <div className="w-full px-4 my-6">
                <div className="relative bg-blue-100 py-3 rounded shadow-sm flex items-center justify-center">
                    <Link
                        to="/dashboard"
                        className="absolute left-4 text-gray-700 hover:text-gray-900"
                    >
                        <ArrowLeftIcon className="h-6 w-6" />
                    </Link>
                    <h2 className="text-2xl font-semibold text-gray-800 text-center">
                        Panel Data Analysis and Prediction
                    </h2>
                    <div className="absolute right-4 flex items-center gap-2">
                        <UserGuideButton className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black text-sm rounded-lg shadow-sm hover:bg-gray-100 transition-colors" />
                        <button
                            onClick={() => setShowGuide((o) => !o)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white text-black text-sm rounded-lg shadow-sm hover:bg-gray-100 transition-colors"
                        >
                            <span className="font-medium">Guide Me</span>
                        </button>
                    </div>
                </div>
                {/* Guide panel — inline, no overlay */}
                <div className="flex justify-center mt-3">
                    <GuidePanel
                        open={showGuide}
                        onClose={() => setShowGuide(false)}
                        content={guideContent.crossSectional}
                    />
                </div>
            </div>

            {/* Main Content */}
            <div className="w-full px-4 my-6">
                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-6 p-6 border-2 border-solid border-gray-300 rounded-lg w-full bg-white shadow-sm">

                        {/* Data source banner */}
                        {dataSource === "initial" && (
                            <div className="w-full text-sm bg-blue-50 border border-blue-200 rounded px-3 py-2 text-blue-900">
                                Using provided data: {parsedData.length.toLocaleString()} rows,{" "}
                                {columns.length} columns. You can upload a CSV instead.
                                {activeFilterCount(filters) > 0 && (
                                    <> Filters active: the model will use {filteredData.length.toLocaleString()} rows.</>
                                )}
                            </div>
                        )}

                        {/* File Upload */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Upload File</label>
                            <input
                                type="file"
                                accept=".csv"
                                ref={fileInputRef}
                                className="px-2 py-[5px] border border-gray-300 rounded bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 hover:border-gray-400"
                                onChange={handleFileChange}
                            />
                        </div>

                        {/* Method */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Method</label>
                            <Select
                                options={methodOptions}
                                value={method ? methodOptions.find((o) => o.value === method) : null}
                                onChange={(selected) => setMethod(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* ID Column */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Id of the Data</label>
                            <Select
                                options={columnOptions}
                                value={idColumn ? columnOptions.find((o) => o.value === idColumn) : null}
                                onChange={(selected) => setIdColumn(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* Dependent Variable */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Dependent Variable</label>
                            <Select
                                options={columnOptions}
                                value={dependentVar ? columnOptions.find((o) => o.value === dependentVar) : null}
                                onChange={(selected) => setDependentVar(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* Independent — click-to-open dropdown with checkboxes */}
                        <MultiCheckboxDropdown
                            label="Independent Variables"
                            options={predictorOptions}
                            selected={independentVar}
                            onToggle={handleIndependentToggle}
                            onSelectAll={handleSelectAllIndependent}
                            placeholder="Select variables"
                            emptyMessage="Upload a file to see columns"
                        />

                        {/* Categorical — options limited to chosen Independent Variables */}
                        <MultiCheckboxDropdown
                            label="Categorical Variables"
                            options={independentVar}
                            selected={categoricalVar}
                            onToggle={handleCategoricalToggle}
                            onSelectAll={handleSelectAllCategorical}
                            placeholder="Select variables"
                            emptyMessage="Select independent variables first"
                        />

                        {/* Outliers */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Outliers</label>
                            <Select
                                options={outlierOptions}
                                value={outliers ? outlierOptions.find((o) => o.value === outliers) : null}
                                onChange={(selected) => setOutliers(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* Date Variable */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Date Variable</label>
                            <Select
                                options={columnOptions}
                                value={selectedDateColumn ? columnOptions.find((o) => o.value === selectedDateColumn) : null}
                                onChange={handleDateColumnChange}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                            {isValidDateColumn !== null && !isValidDateColumn && (
                                <p className="text-xs mt-1 text-red-500">
                                    Selected column does not contain valid date values.
                                </p>
                            )}
                        </div>

                        {/* Forecast horizon */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Forecast Ahead</label>
                            <Select
                                options={HORIZON_CHOICES.map((h) => ({ value: h, label: `${h} ${horizonUnit}` }))}
                                value={{ value: horizon, label: `${horizon} ${horizonUnit}` }}
                                onChange={(selected) => setHorizon(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* Trend stage */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Trend</label>
                            <Select
                                options={TREND_OPTIONS}
                                value={TREND_OPTIONS.find((o) => o.value === trend)}
                                onChange={(selected) => setTrend(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <label className="w-full flex items-start gap-2 text-sm text-gray-700"
                               title="Within each ID, a missing predictor value takes the ID's previous value. The dependent variable is never filled.">
                            <input type="checkbox" className="mt-0.5" checked={fillGaps} onChange={(e) => setFillGaps(e.target.checked)} />
                            <span>
                                Fill missing predictor values from the previous period (per {idColumn || "ID"}).
                                <span className="text-gray-500"> Rows with any missing value are otherwise left out of the model.</span>
                            </span>
                        </label>

                        {/* Filters: summary statistics and the model only see the matching rows */}
                        {fileUploaded && parsedData.length > 0 && (
                            <DataFilters
                                rows={parsedData}
                                filters={filters}
                                onChange={setFilters}
                                columns={filterColumns}
                                dateColumn={isValidDateColumn ? selectedDateColumn : ""}
                                matchCount={filteredData.length}
                            />
                        )}
                        {panelTooSmall && (
                            <div className="w-full text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900">
                                After filtering there are {panelShape.ids} {idColumn} value(s) and {panelShape.periods} period(s).
                                A panel model needs at least {MIN_IDS} and {MIN_PERIODS}; widen the filters.
                            </div>
                        )}
                        {check.duplicates > 0 && (
                            <div className="w-full text-sm bg-red-50 border border-red-200 rounded px-3 py-2 text-red-800">
                                {check.duplicates.toLocaleString()} {idColumn}/{selectedDateColumn} pair(s) appear more than once
                                (e.g. {check.duplicateExample}). A panel needs one row per {idColumn} per period: choose a
                                finer date column (e.g. month instead of year), or filter to one row per period.
                            </div>
                        )}
                        {check.textPredictors.length > 0 && (
                            <div className="w-full text-sm bg-red-50 border border-red-200 rounded px-3 py-2 text-red-800 flex flex-wrap items-center gap-3">
                                <span>
                                    {check.textPredictors.join(", ")} {check.textPredictors.length === 1 ? "contains" : "contain"} text.
                                    Text predictors must be categorical variables.
                                </span>
                                <button className="px-2 py-1 text-xs font-semibold rounded border border-red-300 bg-white hover:bg-red-100"
                                        onClick={markTextAsCategorical}>
                                    Mark as categorical
                                </button>
                            </div>
                        )}
                        {dependentVar && independentVar.length > 0 && check.rowsUsable < MIN_ROWS && check.duplicates === 0 && (
                            <div className="w-full text-sm bg-red-50 border border-red-200 rounded px-3 py-2 text-red-800">
                                Only {check.rowsUsable} row(s) have values for {dependentVar} and every predictor.{" "}
                                {check.emptyColumns.length > 0
                                    ? <>{check.emptyColumns.join(", ")} {check.emptyColumns.length === 1 ? "has" : "have"} no values at all; remove {check.emptyColumns.length === 1 ? "it" : "them"}.</>
                                    : "Remove predictors with many gaps or widen the filters."}
                            </div>
                        )}
                        {Object.keys(check.missingByColumn).length > 0 && check.rowsUsable >= MIN_ROWS && (
                            <div className="w-full text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900">
                                Missing values: {Object.entries(check.missingByColumn).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(" · ")}.{" "}
                                The model will use {check.rowsUsable.toLocaleString()} of {filteredData.length.toLocaleString()} rows
                                {fillGaps ? " after filling predictor gaps" : ""}.
                                {check.latestLost && (
                                    <b> The latest period ({String(check.latestPeriod)}) has no complete rows, so the model would end at{" "}
                                    {String(check.latestUsable)} and the forecast would start inside periods that already have data.
                                    {fillGaps ? " Remove the predictor that is missing there." : " Turn on gap filling above."}</b>
                                )}
                            </div>
                        )}
                        {absorbedByFixedEffects.length > 0 && (
                            <div className="w-full text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900">
                                With Fixed Effects, {absorbedByFixedEffects.join(", ")}{" "}
                                {absorbedByFixedEffects.length === 1 ? "doesn't" : "don't"} change within each {idColumn}, so
                                the {idColumn} effect absorbs {absorbedByFixedEffects.length === 1 ? "it" : "them"} and no
                                coefficient can be estimated. Use Random Effects or a tree method (Forest, Boosting) to measure{" "}
                                {absorbedByFixedEffects.length === 1 ? "its" : "their"} effect.
                                {allAbsorbed && <b> Add at least one predictor that changes over time to run Fixed Effects.</b>}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">
                            <button
                                className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={() => { handleSummaryStatistics(); setActiveView("summary"); }}
                            >
                                Summary Statistics
                            </button>
                            <button
                                className={`w-40 px-4 py-2 rounded ${isReadyToPredict
                                    ? "bg-blue-500 text-white hover:bg-blue-600"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    }`}
                                disabled={!isReadyToPredict}
                                onClick={() => { handlePredict(); setActiveView("prediction"); }}
                            >
                                Predict
                            </button>
                            <button
                                className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={handleClear}
                            >
                                Clear
                            </button>
                            {bestMethod && (
                                <button
                                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                    onClick={handleViewForecast}
                                >
                                    View forecast in dashboard
                                </button>
                            )}
                            {hasInitialData && dataSource !== "initial" && (
                                <button
                                    className="px-4 py-2 border border-blue-500 text-blue-600 rounded hover:bg-blue-50"
                                    onClick={() => loadFromInitialData(initialData)}
                                >
                                    Use provided data
                                </button>
                            )}
                        </div>

                        {/* Loading */}
                        {loading && <LoadingOverlay />}
                        {activeView !== "summary" && (error || result?.success === false) && (
                            <div className="w-full text-sm bg-red-50 border border-red-200 rounded px-3 py-2 text-red-800 text-center">
                                The model couldn't run.{" "}
                                {result?.details || error?.response?.data?.details || (typeof error === "string" ? error : error?.message) || "Try again."}
                            </div>
                        )}

                        {/* Summary Statistics view, with PPT download */}
                        {activeView === 'summary' && summaryStats.length > 0 && !loading && !error && (
                            <>
                                <div className="w-full flex justify-end">
                                    <DownloadSummaryStatsPptxButton
                                        stats={summaryStats}
                                        title="Summary Statistics"
                                        filenamePrefix="summary_statistics"
                                        showExtended={false}
                                        variables={{
                                            dependentVar,
                                            independentVar,
                                            categoricalVar,
                                            idColumn,
                                            outliers,
                                        }}
                                    />
                                </div>
                                <SummaryStatisticsTable stats={summaryStats} showExtended={false} />
                            </>
                        )}
                        {activeView === "prediction" && result && result.success !== false && (
                            <>
                                <div className="w-full flex justify-end mb-4">
                                    <DownloadPptxButton result={result} />
                                </div>
                                {bestMethod && (
                                    <div className="w-full text-sm bg-green-50 border border-green-200 rounded px-3 py-2 text-green-800 mb-3">
                                        Lowest MSE so far:{" "}
                                        <b>{methodOptions.find((o) => o.value === bestMethod.method)?.label || bestMethod.method}</b>
                                        {" "}({Number(bestMethod.mse).toPrecision(5)})
                                    </div>
                                )}
                                <CrossSectionalTable result={result} />
                            </>
                        )}

                    </div>
                </div>
            </div>
        </>
    );
};

export default PanelData;
