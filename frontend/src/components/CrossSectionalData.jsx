import React, { useState, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { parseCsvFile, computeSummaryStatistics } from '../utils/utils';
import SummaryStatisticsTable from './SummaryStatisticsTable';
import { usePrediction } from '../hooks/usePrediction';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import CrossSectionalTable from './CrossSectionalTable';
import LoadingOverlay from './LoadingOverlay';
import DownloadPptxButton from './dowload/DownloadPptxButton';
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import MultiCheckboxDropdown from './MultiCheckboxDropdown';
import DownloadSummaryStatsPptxButton from './dowload/SummaryStatisticsPptxDowload';

const CrossSectionalData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [summaryStats, setSummaryStats] = useState([]);
    const [fileUploaded, setFileUploaded] = useState(false);
    const [method, setMethod] = useState('');
    const [idColumn, setIdColumn] = useState('');
    const [dependentVar, setDependentVar] = useState('');
    const [independentVar, setIndependentVar] = useState([]);
    const [categoricalVar, setCategoricalVar] = useState([]);
    const [outliers, setOutliers] = useState('');
    const [showGuide, setShowGuide] = useState(false);
    const fileInputRef = useRef(null);

    const { data: result, loading, error, handlePredict: runPrediction } = usePrediction();

    const [activeView, setActiveView] = useState(null);

    const columnOptions = columns.map(col => ({ value: col, label: col }));

    const methodOptions = [
        { value: 'ols', label: 'OLS' },
        { value: 'gls', label: 'General Least Square' },
        { value: 'logit', label: 'Logit' },
        { value: 'lasso', label: 'LASSO' },
        { value: 'ridge', label: 'RIDGE' },
        { value: 'forest', label: 'FOREST' },
        { value: 'boosting', label: 'BOOSTING' },
        { value: 'bagging', label: 'BAGGING' },
    ];

    const outlierOptions = [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
    ];

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            setColumns(Object.keys(data[0]));
        }
    };

    const handleSummaryStatistics = () => {
        const selectedColumns = [
            dependentVar,
            ...independentVar,
        ].filter(Boolean);

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

    // "Select All" toggles between every column and none. If everything is
    // already selected, it deselects all (also clearing any categorical
    // picks that depended on them); otherwise it selects every column.
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
        method &&
        idColumn &&
        dependentVar &&
        independentVar.length > 0 &&
        categoricalVar.length >= 0 &&
        outliers;

    const handlePredict = async () => {
        const payload = {
            data: parsedData,
            method,
            id_column: idColumn,
            dependent_variable: dependentVar,
            independent_variable: independentVar,
            categorical_variable: categoricalVar,
            outliers,
        };

        setActiveView('prediction');
        await runPrediction(payload, `cross-sectional/${method}`);
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
        setActiveView(null);

        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        }
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
                        Data Analysis and Prediction
                    </h2>

                    <button
                        onClick={() => setShowGuide((o) => !o)}
                        className="absolute right-4 flex items-center gap-2 px-3 py-1.5 bg-white text-black text-sm rounded-lg shadow-sm hover:bg-gray-100 transition-colors"
                    >
                        <span className="font-medium">Guide Me</span>
                    </button>
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

            {/* Form */}
            <div className="w-full px-4 my-6">
                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-6 p-6 border-2 border-gray-300 rounded-lg w-full bg-white shadow-sm">

                        {/* Upload */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Upload File</label>
                            <input
                                type="file"
                                accept=".csv"
                                ref={fileInputRef}
                                onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                        setFileUploaded(true);
                                        parseCsvFile(file, onDataParsed);
                                    }
                                }}
                                className="px-2 py-[5px] border border-gray-300 rounded text-sm"
                            />
                        </div>

                        {/* Method */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Methods</label>
                            <Select
                                options={methodOptions}
                                value={methodOptions.find(opt => opt.value === method) || null}
                                onChange={(selected) => setMethod(selected.value)}
                            />
                        </div>

                        {/* ID */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">ID Column</label>
                            <Select
                                options={columnOptions}
                                value={columnOptions.find(opt => opt.value === idColumn) || null}
                                onChange={(selected) => setIdColumn(selected.value)}
                            />
                        </div>

                        {/* Dependent */}
                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Dependent Variable</label>
                            <Select
                                options={columnOptions}
                                value={columnOptions.find(opt => opt.value === dependentVar) || null}
                                onChange={(selected) => setDependentVar(selected.value)}
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

                        {/* Categorical — click-to-open dropdown, options limited to chosen Independent Variables */}
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
                                value={outlierOptions.find(opt => opt.value === outliers) || null}
                                onChange={(selected) => setOutliers(selected.value)}
                            />
                        </div>

                        {/* Buttons */}
                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">
                            <button
                                className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={() => {
                                    handleSummaryStatistics();
                                    setActiveView('summary');
                                }}
                            >
                                Summary Statistics
                            </button>

                            <button
                                className={`w-40 px-4 py-2 rounded ${isReadyToPredict && !loading
                                    ? "bg-blue-500 text-white hover:bg-blue-600"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    }`}
                                disabled={!isReadyToPredict || loading}
                                onClick={handlePredict}
                            >
                                {loading ? "Predicting..." : "Predict"}
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
                        {/* Error */}
                        {error && activeView != "summary" && (
                            <div className="w-full text-center text-red-600 bg-red-50 p-2 rounded mt-4">
                                Something went wrong. Try agin!!
                            </div>
                        )}

                        {/* Results: Summary Statistics view, now with PPT download */}
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


                        {activeView === 'prediction' && result && !loading && !error && (
                            <>
                                <div className="w-full flex justify-end">
                                    <DownloadPptxButton
                                        result={result}
                                        title="Cross-Sectional Data Analysis"
                                        filenamePrefix="cross_sectional"
                                        variables={{
                                            dependentVar,
                                            independentVar,
                                            categoricalVar,
                                            idColumn,
                                            outliers,
                                        }}
                                    />
                                </div>
                                <CrossSectionalTable result={result} />
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default CrossSectionalData;
