import React, { useState, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { parseCsvFile, computeSummaryStatistics } from '../utils/utils';
import SummaryStatisticsTable from './SummaryStatisticsTable';
import { usePrediction } from '../hooks/usePrediction';
import CrossSectionalTable from './CrossSectionalTable';
import LoadingOverlay from './LoadingOverlay';
import DownloadPptxButton from './dowload/DownloadPptxButton';
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import MultiCheckboxDropdown from './MultiCheckboxDropdown';
import DownloadSummaryStatsPptxButton from './dowload/SummaryStatisticsPptxDowload';
import UserGuideButton from "../guideMe/UserGuideButton";
import Box from '@mui/material/Box';
import { ActionButton, ButtonRow, ControlsCard, EndRow, ErrorNote, Field, FileInput, HeaderButton, PageHeader, Section } from './ui';

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
            <Section>
                <PageHeader
                    title="Data Analysis and Prediction"
                    backTo="/dashboard"
                    actions={
                        <>
                            <UserGuideButton />
                            <HeaderButton onClick={() => setShowGuide((o) => !o)}>Guide Me</HeaderButton>
                        </>
                    }
                />
                {/* Guide panel */}
                <Box sx={{ display: "flex", justifyContent: "center", mt: 1.5 }}>
                    <GuidePanel
                        open={showGuide}
                        onClose={() => setShowGuide(false)}
                        content={guideContent.crossSectional}
                    />
                </Box>
            </Section>

            {/* Form */}
            <Section>
                <ControlsCard>

                    {/* Upload */}
                    <Field label="Upload File">
                        <FileInput
                            accept=".csv"
                            ref={fileInputRef}
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                    setFileUploaded(true);
                                    parseCsvFile(file, onDataParsed);
                                }
                            }}
                            sx={{ boxShadow: 0 }}
                        />
                    </Field>

                    {/* Method */}
                    <Field label="Methods">
                        <Select
                            options={methodOptions}
                            value={methodOptions.find(opt => opt.value === method) || null}
                            onChange={(selected) => setMethod(selected.value)}
                        />
                    </Field>

                    {/* ID */}
                    <Field label="ID Column">
                        <Select
                            options={columnOptions}
                            value={columnOptions.find(opt => opt.value === idColumn) || null}
                            onChange={(selected) => setIdColumn(selected.value)}
                        />
                    </Field>

                    {/* Dependent */}
                    <Field label="Dependent Variable">
                        <Select
                            options={columnOptions}
                            value={columnOptions.find(opt => opt.value === dependentVar) || null}
                            onChange={(selected) => setDependentVar(selected.value)}
                        />
                    </Field>

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
                    <Field label="Outliers">
                        <Select
                            options={outlierOptions}
                            value={outlierOptions.find(opt => opt.value === outliers) || null}
                            onChange={(selected) => setOutliers(selected.value)}
                        />
                    </Field>

                    {/* Buttons */}
                    <ButtonRow>
                        <ActionButton
                            onClick={() => {
                                handleSummaryStatistics();
                                setActiveView('summary');
                            }}
                        >
                            Summary Statistics
                        </ActionButton>

                        <ActionButton disabled={!isReadyToPredict || loading} onClick={handlePredict}>
                            {loading ? "Predicting..." : "Predict"}
                        </ActionButton>

                        <ActionButton onClick={handleClear}>
                            Clear
                        </ActionButton>
                    </ButtonRow>

                    {/* Loading */}
                    {loading && <LoadingOverlay />}
                    {/* Error */}
                    {error && activeView != "summary" && (
                        <ErrorNote>Something went wrong. Try agin!!</ErrorNote>
                    )}

                    {/* Results: Summary Statistics view, now with PPT download */}
                    {activeView === 'summary' && summaryStats.length > 0 && !loading && !error && (
                        <>
                            <EndRow>
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
                            </EndRow>
                            <SummaryStatisticsTable stats={summaryStats} showExtended={false} />
                        </>
                    )}


                    {activeView === 'prediction' && result && !loading && !error && (
                        <>
                            <EndRow>
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
                            </EndRow>
                            <CrossSectionalTable result={result} />
                        </>
                    )}
                </ControlsCard>
            </Section>
        </>
    );
};

export default CrossSectionalData;
