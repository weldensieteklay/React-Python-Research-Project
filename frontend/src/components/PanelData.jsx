import React, { useState, useRef } from "react";
import Select from "react-select";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import { parseCsvFile, computeSummaryStatistics } from "../utils/utils";
import SummaryStatisticsTable from "./SummaryStatisticsTable";
import { usePrediction } from "../hooks/usePrediction";
import CrossSectionalTable from "./CrossSectionalTable";
import LoadingOverlay from './Error';

const PanelData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [summaryStats, setSummaryStats] = useState([]);
    const [fileUploaded, setFileUploaded] = useState(false);
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

    const fileInputRef = useRef(null);
    const { data: result, loading, error, handlePredict: runPrediction } = usePrediction();

    const columnOptions = columns.map((col) => ({ value: col, label: col }));

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

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            setColumns(Object.keys(data[0]));
        }
    };

    const handleDateColumnChange = (selected) => {
        setSelectedDateColumn(selected?.value || "");
        setIsValidDateColumn(null);
        setDateOptions([]);
        setStartDate("");
        setEndDate("");

        if (!selected || !fileInputRef.current?.files[0]) return;

        const file = fileInputRef.current.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const rows = text.split("\n").filter((r) => r.trim());
            const headers = rows[0].split(",").map((h) => h.trim());
            const colIndex = headers.indexOf(selected.value);

            if (colIndex === -1) {
                setIsValidDateColumn(false);
                return;
            }

            const values = rows
                .slice(1)
                .map((r) => r.split(",")[colIndex]?.trim())
                .filter(Boolean);

            const isValid = values.some((v) => !isNaN(Date.parse(v)));
            setIsValidDateColumn(isValid);

            if (isValid) {
                const unique = [...new Set(values)].sort();
                setDateOptions(unique.map((d) => ({ value: d, label: d })));
            }
        };
        reader.readAsText(file);
    };

    const handleSummaryStatistics = () => {
        const selectedColumns = [
            dependentVar,
            ...independentVar,
        ].filter(Boolean);

        const stats = computeSummaryStatistics(parsedData, selectedColumns, categoricalVar);
        setSummaryStats(stats);
    };

    const isReadyToPredict =
        fileUploaded &&
        method &&
        idColumn &&
        dependentVar &&
        independentVar.length > 0 &&
        selectedDateColumn && outliers;

    const handlePredict = async () => {
        const payload = {
            data: parsedData,
            method,
            id_column: idColumn,
            dependent_variable: dependentVar,
            independent_variable: independentVar,
            categorical_variable: categoricalVar,
            outliers,
            date_column: selectedDateColumn,
        };
        await runPrediction(payload, `panel/${method}`);
    };

    const handleClear = () => {
        setMethod("");
        setIdColumn("");
        setDependentVar("");
        setIndependentVar([]);
        setCategoricalVar([]);
        setOutliers("");
        setFileUploaded(false);
        setParsedData([]);
        setColumns([]);
        setSummaryStats([]);
        setSelectedDateColumn("");
        setIsValidDateColumn(null);
        setDateOptions([]);
        setStartDate("");
        setEndDate("");
        setActiveView(null);
        if (fileInputRef.current) fileInputRef.current.value = null;
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
                </div>
            </div>

            {/* Main Content */}
            <div className="w-full px-4 my-6">
                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-6 p-6 border-2 border-solid border-gray-300 rounded-lg w-full bg-white shadow-sm">

                        {/* File Upload */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Upload File</label>
                            <input
                                type="file"
                                accept=".csv"
                                ref={fileInputRef}
                                className="px-2 py-[5px] border border-gray-300 rounded bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 hover:border-gray-400"
                                onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                        setFileUploaded(true);
                                        parseCsvFile(file, onDataParsed);
                                    }
                                }}
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

                        {/* Independent Variables */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Independent Variables</label>
                            <Select
                                isMulti
                                options={columnOptions}
                                value={columnOptions.filter((o) => independentVar.includes(o.value))}
                                onChange={(selected) => setIndependentVar(selected.map((o) => o.value))}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        {/* Categorical Variables */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Categorical Variables</label>
                            <Select
                                isMulti
                                options={columnOptions}
                                value={columnOptions.filter((o) => categoricalVar.includes(o.value))}
                                onChange={(selected) => setCategoricalVar(selected.map((o) => o.value))}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

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
                                {loading ? "Running..." : "Predict"}
                            </button>
                            <button
                                className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={handleClear}
                            >
                                Clear
                            </button>
                        </div>
                        {/* Loading */}
                        {loading && <LoadingOverlay />}
                        {error && activeView !== "summary" && (
                            <div className="flex flex-col items-center text-center">
                                Something went wrong. Try agin!!
                            </div>
                        )}

                        {/* Results */}
                        {activeView === "summary" && summaryStats.length > 0 && (
                            <SummaryStatisticsTable stats={summaryStats} showExtended={false} />
                        )}
                        {activeView === "prediction" && result && (
                            <CrossSectionalTable result={result} />
                        )}

                    </div>
                </div>
            </div>
        </>
    );
};

export default PanelData;