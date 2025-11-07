import React, { useState } from 'react';
import { parseCsvFile } from "../constants/constants";
import { computeSummaryStatistics } from '../constants/constants';
import Select from "react-select";

const TimeSeriesData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [selectedDateColumn, setSelectedDateColumn] = useState("");
    const [method, setMethod] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [selectedEndogenousVar, setSelectedEndogenousVar] = useState("");
    const [summaryStats, setSummaryStats] = useState([]);
    const [isValidDateColumn, setIsValidDateColumn] = useState(null);

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
        { value: "ols", label: "OLS" },
        { value: "lasso", label: "LASSO" },
    ];

    const columnOptions = columns.map(col => ({ value: col, label: col }));

    const dateOptions = [];
    if (selectedDateColumn) {
        const dateSet = new Set(
            parsedData
                .map(row => row[selectedDateColumn])
                .filter(value => {
                    const date = new Date(value);
                    return !isNaN(date.getTime());
                })
        );
        const sortedDates = Array.from(dateSet).sort((a, b) => new Date(a) - new Date(b));
        sortedDates.forEach(dateStr => {
            dateOptions.push({ value: dateStr, label: dateStr });
        });
    }

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
                            onChange={(e) => parseCsvFile(e.target.files[0], onDataParsed)} />
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
                            value={columnOptions.find(opt => opt.value === selectedDateColumn)}
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
                            value={dateOptions.find(opt => opt.value === startDate)}
                            onChange={(selected) => setStartDate(selected?.value || "")}
                            classNamePrefix="react-select"
                            className="text-sm"
                        />
                    </div>

                    <div className="flex flex-col w-48">
                        <label className="text-sm text-gray-700 mb-1">End Date</label>
                        <Select
                            options={dateOptions}
                            value={dateOptions.find(opt => opt.value === endDate)}
                            onChange={(selected) => setEndDate(selected?.value || "")}
                            classNamePrefix="react-select"
                            className="text-sm"
                        />
                    </div>


                    <div className="flex flex-col w-48">
                        <label className="text-sm text-gray-700 mb-1">Endogenous Variables</label>
                        <Select
                            options={columnOptions}
                            value={columnOptions.find(opt => opt.value === selectedEndogenousVar)}
                            onChange={(selected) => setSelectedEndogenousVar(selected?.value || "")}
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
                        <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                            Predict
                        </button>
                        <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                            Clear
                        </button>
                    </div>
                    {summaryStats.length > 0 && (
                        <SummaryStatisticsTable stats={summaryStats} />
                    )}
                </div>
            </div>
        </div>
    </>
);
}

export default TimeSeriesData;