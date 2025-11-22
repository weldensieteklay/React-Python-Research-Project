import React, { useState, useRef } from 'react';
import { parseCsvFile, computeSummaryStatistics } from '../utils/utils';
import SummaryStatisticsTable from './SummaryStatisticsTable';
import Select from 'react-select';
import { usePrediction } from "../hooks/usePrediction";
import PredictionTable from './PredictionTable';




const TimeSeriesData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [selectedDateColumn, setSelectedDateColumn] = useState('');
    const [fileUploaded, setFileUploaded] = useState(false);
    const [method, setMethod] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedEndogenousVar, setSelectedEndogenousVar] = useState('');
    const [selectedExogenousVar, setSelectedExogenousVar] = useState('');
    const [summaryStats, setSummaryStats] = useState([]);
    const [isValidDateColumn, setIsValidDateColumn] = useState(null);
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
    };

    const handleSummaryStatistics = () => {
        const stats = computeSummaryStatistics(parsedData, columns);
        setSummaryStats(stats);
    };

    const methodOptions = [
        { value: 'arima', label: 'ARIMA' },
        { value: 'lasso', label: 'LASSO' },
        { value: 'ridge', label: 'RIDGE' },
        { value: 'forest', label: 'RANDOM FOREST' },
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
            <div className="w-full px-4 my-6">
                <div className="text-center bg-blue-100 py-3 rounded shadow-sm">
                    <h2 className="text-2xl font-semibold text-gray-800">Data Analysis and Prediction</h2>
                </div>
            </div>
            <div className="w-full px-4 my-6">
                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-6 p-6 border-2 border-solid border-gray-300 rounded-lg w-full bg-white shadow-sm">

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Upload File</label>
                            <input type="file" className="px-2 py-[5px] border border-gray-300 rounded bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 hover:border-gray-400"
                                accept=".csv"
                                ref={fileInputRef}
                                onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                        setFileUploaded(true);
                                        parseCsvFile(file, onDataParsed);
                                    }
                                }} />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Methods</label>
                            <Select
                                options={methodOptions}
                                value={method ? methodOptions.find(opt => opt.value === method) : null}
                                onChange={(selected) => setMethod(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Date Variable</label>
                            <Select
                                options={columnOptions}
                                value={selectedDateColumn ? columnOptions.find(opt => opt.value === selectedDateColumn) : null}
                                onChange={handleDateColumnChange}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                            {isValidDateColumn !== null && (
                                <p className={`text-xs mt-1 ${isValidDateColumn ? "text-green-600" : "text-red-500"}`}>
                                    {!isValidDateColumn && "Selected column does not contain valid date values."}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Start Date</label>
                            <Select
                                options={dateOptions}
                                value={startDate ? dateOptions.find(opt => opt.value === startDate) : null}
                                onChange={(selected) => setStartDate(selected?.value || "")}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">End Date</label>
                            <Select
                                options={dateOptions}
                                value={endDate ? dateOptions.find(opt => opt.value === endDate) : null}
                                onChange={(selected) => setEndDate(selected?.value || "")}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>


                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Endogenous Variables</label>
                            <Select
                                options={columnOptions}
                                value={selectedEndogenousVar ? columnOptions.find(opt => opt.value === selectedEndogenousVar) : null}
                                onChange={(selected) => setSelectedEndogenousVar(selected?.value || "")}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Exogenouse Variables</label>
                            <Select
                                options={columnOptions}
                                value={selectedExogenousVar ? columnOptions.find(opt => opt.value === selectedExogenousVar) : null}
                                onChange={(selected) => setSelectedExogenousVar(selected?.value || "")}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">

                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleSummaryStatistics}>
                                Summary Statistics
                            </button>
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                                Line Graph
                            </button>
                            <button
                                onClick={onClickPredict}
                                className={`w-40 px-4 py-2 rounded ${isPredictDisabled
                                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    : "bg-blue-500 text-white hover:bg-blue-600"
                                    }`}
                                disabled={isPredictDisabled}
                            >
                                Predict
                            </button>
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleClear}>
                                Clear
                            </button>
                        </div>
                        {summaryStats.length > 0 && (
                            <SummaryStatisticsTable stats={summaryStats} />
                        )}


                        {result && <PredictionTable result={result} title="ARIMA Model Diagnostics" />}
                    </div>
                </div>
            </div>
        </>
    );
}

export default TimeSeriesData;