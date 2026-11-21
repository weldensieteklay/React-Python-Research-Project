import React, { useState, useRef } from 'react';
import { parseCsvFile, computeSummaryStatistics } from '../utils/utils';
import SummaryStatisticsTable from './SummaryStatisticsTable';
import Select from 'react-select';
import { usePrediction } from '../hooks/usePrediction';
import PredictionTable from './PredictionTable';
import LineGraph from './LineGraph';
import LoadingOverlay from './LoadingOverlay';
import DownloadPptxButton from './dowload/DownloadPptxButton';
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import DownloadSummaryStatsPptxButton from './dowload/SummaryStatisticsPptxDowload';
import UserGuideButton from "../guideMe/UserGuideButton";
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ActionButton, ButtonRow, ControlsCard, EndRow, ErrorNote, Field, FileInput, HeaderButton, PageHeader, Section } from './ui';

const TimeSeriesData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [selectedDateColumn, setSelectedDateColumn] = useState('');
    const [fileUploaded, setFileUploaded] = useState(false);
    const [method, setMethod] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedEndogenousVar, setSelectedEndogenousVar] = useState('');
    const [selectedExogenousVar, setSelectedExogenousVar] = useState([]);
    const [summaryStats, setSummaryStats] = useState([]);
    const [isValidDateColumn, setIsValidDateColumn] = useState(null);
    const [showLineGraph, setShowLineGraph] = useState(false);
    const [activeView, setActiveView] = useState(null);
    const [showGuide, setShowGuide] = useState(false);

    const fileInputRef = useRef(null);

    const { data: result, setData, loading, error, handlePredict } = usePrediction();

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            const keys = Object.keys(data[0]);
            setColumns(keys);
        }
        console.log("Parsed Data:", data);
    };

    const handleDateColumnChange = (selectedOption) => {
        const selected = selectedOption?.value || "";
        setSelectedDateColumn(selected);

        if (!selected || parsedData.length === 0) {
            setIsValidDateColumn(null);
            return;
        }

        const columnValues = parsedData.map(row => row[selected]).filter(Boolean);

        const isValid = columnValues.every(value => {
            const date = new Date(value);
            return !isNaN(date.getTime());
        });

        setIsValidDateColumn(isValid);

        if (isValid) {
            const sortedDates = columnValues
                .filter(value => !isNaN(new Date(value).getTime()))
                .sort((a, b) => new Date(a) - new Date(b));

            setStartDate(sortedDates[0]);
            setEndDate(sortedDates[sortedDates.length - 1]);
        }
    };

    const handleSummaryStatistics = () => {
        const selectedColumns = [
            selectedEndogenousVar,
            ...selectedExogenousVar,
        ].filter(Boolean);

        const stats = computeSummaryStatistics(parsedData, selectedColumns);
        setSummaryStats(stats);
    };

    const methodOptions = [
        { value: 'arima', label: 'ARIMA' },
        { value: 'lasso', label: 'LASSO' },
        { value: 'ridge', label: 'RIDGE' },
        { value: 'forest', label: 'FOREST' },
        { value: 'boosting', label: 'BOOSTING' },
        { value: 'bagging', label: 'BAGGING' },
    ];

    const columnOptions = columns.map(col => ({ value: col, label: col }));

    const dateOptions = selectedDateColumn
        ? Array.from(
            new Set(
                parsedData
                    .map(row => row[selectedDateColumn])
                    .filter(value => {
                        const date = new Date(value);
                        return !isNaN(date.getTime());
                    })
            )
        )
            .sort((a, b) => new Date(a) - new Date(b))
            .map(dateStr => ({ value: dateStr, label: dateStr }))
        : [];


    const handleClear = () => {
        setParsedData([]);
        setColumns([]);
        setSelectedDateColumn('');
        setMethod('');
        setStartDate('');
        setEndDate('');
        setSelectedEndogenousVar('');
        setSummaryStats([]);
        setIsValidDateColumn(null);
        setFileUploaded(false);
        setData(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        }
        setActiveView(null);
    };




    const isPredictDisabled =
        !fileUploaded ||
        !method ||
        !selectedDateColumn ||
        !isValidDateColumn ||
        !startDate ||
        !endDate ||
        !selectedEndogenousVar;

    const onClickPredict = async () => {
        setData(null);
        const selectedData = parsedData
            .filter(row => {
                const dateValue = new Date(row[selectedDateColumn]);
                return dateValue >= new Date(startDate) && dateValue <= new Date(endDate);
            })

            .map(row => {

                const filteredRow = {
                    [selectedDateColumn]: row[selectedDateColumn],
                    [selectedEndogenousVar]: row[selectedEndogenousVar],
                };


                (Array.isArray(selectedExogenousVar) ? selectedExogenousVar : [selectedExogenousVar])
                    .forEach(exog => {
                        if (row.hasOwnProperty(exog)) {
                            filteredRow[exog] = row[exog];
                        }
                    });

                return filteredRow;
            });


        const payload = {
            data: selectedData,
            date_variable: selectedDateColumn,
            target_variable: selectedEndogenousVar,
            exogenous_variable: Array.isArray(selectedExogenousVar)
                ? selectedExogenousVar
                : [selectedExogenousVar],

        };

        try {
            const result = await handlePredict(payload, method);
            console.log("Prediction Result:", result);
        } catch (err) {
            console.error("Prediction Failed:", err);
        }
    };

    return (

        <>
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
                <Box sx={{ display: "flex", justifyContent: "center", mt: 1.5 }}>
                    <GuidePanel
                        open={showGuide}
                        onClose={() => setShowGuide(false)}
                        content={guideContent.timeSeries}
                    />
                </Box>
            </Section>
            <Section>
                <ControlsCard>

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
                                }} />
                        </Field>

                        <Field label="Methods">
                            <Select
                                options={methodOptions}
                                value={method ? methodOptions.find(opt => opt.value === method) : null}
                                onChange={(selected) => setMethod(selected.value)}
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                        </Field>

                        <Field label="Date Variable">
                            <Select
                                options={columnOptions}
                                value={selectedDateColumn ? columnOptions.find(opt => opt.value === selectedDateColumn) : null}
                                onChange={handleDateColumnChange}
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                            {isValidDateColumn !== null && (
                                <Typography variant="caption" component="p" sx={{ mt: 0.5, color: isValidDateColumn ? "green.600" : "red.500" }}>
                                    {!isValidDateColumn && "Selected column does not contain valid date values."}
                                </Typography>
                            )}
                        </Field>

                        <Field label="Start Date">
                            <Select
                                options={dateOptions}
                                value={startDate ? dateOptions.find(opt => opt.value === startDate) : null}
                                onChange={(selected) => setStartDate(selected?.value || "")}
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                        </Field>

                        <Field label="End Date">
                            <Select
                                options={dateOptions}
                                value={endDate ? dateOptions.find(opt => opt.value === endDate) : null}
                                onChange={(selected) => setEndDate(selected?.value || "")}
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                        </Field>


                        <Field label="Endogenous Variable">
                            <Select
                                options={columnOptions}
                                value={selectedEndogenousVar ? columnOptions.find(opt => opt.value === selectedEndogenousVar) : null}
                                onChange={(selected) => setSelectedEndogenousVar(selected?.value || "")}
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                        </Field>

                        <Field label="Exogenouse Variables">
                            <Select
                                options={columnOptions}
                                isMulti
                                value={columnOptions.filter(opt =>
                                    selectedExogenousVar.includes(opt.value)
                                )}
                                onChange={(selectedOptions) =>
                                    setSelectedExogenousVar(
                                        selectedOptions ? selectedOptions.map(opt => opt.value) : []
                                    )
                                }
                                classNamePrefix="react-select"
                                styles={selectStyles}
                            />
                        </Field>

                        <ButtonRow>
                            <ActionButton onClick={() => { handleSummaryStatistics(); setActiveView('summary'); }}>
                                Summary Statistics
                            </ActionButton>
                            <ActionButton onClick={() => setActiveView('graph')}>
                                Line Graph
                            </ActionButton>
                            <ActionButton
                                onClick={() => { onClickPredict(); setActiveView('prediction'); }}
                                disabled={isPredictDisabled}
                            >
                                Predict
                            </ActionButton>
                            <ActionButton onClick={handleClear}>
                                Clear
                            </ActionButton>
                        </ButtonRow>

                        {loading && <LoadingOverlay />}

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
                                    />
                                </EndRow>
                                <SummaryStatisticsTable stats={summaryStats} showExtended={false} />
                            </>
                        )}

                        {activeView === "prediction" && result && (
                            <>
                                <EndRow sx={{ mb: 2 }}>
                                    <DownloadPptxButton result={result} />
                                </EndRow>

                                <PredictionTable result={result} />
                            </>
                        )}

                        {activeView === 'graph' && selectedDateColumn && selectedEndogenousVar && (
                            <LineGraph
                                data={parsedData}
                                dateColumn={selectedDateColumn}
                                endogenousColumn={selectedEndogenousVar}
                            />
                        )}
                </ControlsCard>
            </Section>
        </>
    );
}


export default TimeSeriesData;
const selectStyles = { container: (base) => ({ ...base, fontSize: "0.875rem" }) };
