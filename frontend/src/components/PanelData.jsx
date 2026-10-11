import React, { useState, useRef, useEffect } from "react";
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

const FORECAST_PERIODS = 2; // periods of the date column to forecast (2 = next two years for annual data)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        }
    };

    const handleSummaryStatistics = () => {
        const selectedColumns = [dependentVar, ...independentVar].filter(Boolean);
        const stats = computeSummaryStatistics(parsedData, selectedColumns, categoricalVar);
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

    // "Select All" toggles between every column and none.
    const handleSelectAllIndependent = (allCurrentlySelected) => {
        setIndependentVar(() => {
            const next = allCurrentlySelected ? [] : [...columns];
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
        parsedData.length > 0 &&
        method &&
        idColumn &&
        dependentVar &&
        independentVar.length > 0 &&
        selectedDateColumn &&
        outliers;

    const handlePredict = async () => {
        // MSE is only comparable between runs on the same problem
        lastRunRef.current = {
            method,
            context: [dependentVar, idColumn, selectedDateColumn, outliers].join("|"),
            // The dashboard needs these to map the forecast back onto its grid
            config: {
                idColumn,
                dependentVar,
                independentVar,
                categoricalVar,
                dateColumn: selectedDateColumn,
                outliers,
            },
        };
        const payload = {
            data: parsedData,
            method,
            id_column: idColumn,
            dependent_variable: dependentVar,
            independent_variable: independentVar,
            categorical_variable: categoricalVar,
            outliers,
            date_column: selectedDateColumn,
            forecast_periods: FORECAST_PERIODS,
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
                            options={columns}
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
                        {error && activeView !== "summary" && (
                            <div className="flex flex-col items-center text-center">
                                Something went wrong. Try again!
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
                        {activeView === "prediction" && result && (
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
