import React, { useState, useRef } from "react";
import Select from "react-select";
import { parseCsvFile, computeSummaryStatistics } from "../utils/utils";
import SummaryStatisticsTable from "./SummaryStatisticsTable";

const DataCleanup = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [fileUploaded, setFileUploaded] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [summaryStats, setSummaryStats] = useState([]);

    const [originalData, setOriginalData] = useState([]);

    const [selectedColumn, setSelectedColumn] = useState(null);
    const [selectedAction, setSelectedAction] = useState(null);

    const fileInputRef = useRef(null);

    const onDataParsed = (data) => {
        setParsedData(data);
        setOriginalData(data);
        if (data.length > 0) {
            const keys = Object.keys(data[0]);
            setColumns(keys);
        }
        console.log("Parsed Data:", data);
    };
    const handleSummaryStatistics = () => {
        const stats = computeSummaryStatistics(
            parsedData,
            Object.keys(parsedData[0])
        );
        setSummaryStats(stats);
    };

    const handleClear = () => {
        setParsedData([]);
        setColumns([]);
        setSummaryStats([]);
        setFileUploaded(false);
        setShowPreview(false);
        setSelectedColumn(null);
        setSelectedAction(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        }
    };
    const handleApplyCleanup = () => {
        if (!selectedColumn || !selectedAction) return;

        let cleanedData = [...parsedData];

        switch (selectedAction) {
            case "drop":

                cleanedData = cleanedData.map((row) => {
                    const newRow = { ...row };
                    delete newRow[selectedColumn];
                    return newRow;
                });
                break;

            case "convert":

                cleanedData = cleanedData.map((row) => {
                    const newRow = { ...row };
                    if (newRow[selectedColumn] !== undefined && !isNaN(newRow[selectedColumn])) {
                        newRow[selectedColumn] = Number(newRow[selectedColumn]);
                    }
                    return newRow;
                });
                break;

            case "normalize":

                {
                    const values = parsedData
                        .map((r) => Number(r[selectedColumn]))
                        .filter((v) => !isNaN(v));
                    const min = Math.min(...values);
                    const max = Math.max(...values);
                    cleanedData = parsedData.map((r) => {
                        const copy = { ...r };
                        if (!isNaN(copy[selectedColumn])) {
                            copy[selectedColumn] = (copy[selectedColumn] - min) / (max - min);
                        }
                        return copy;
                    });
                }
                break;

            case "fill-average":

                {
                    const values = parsedData
                        .map((r) => Number(r[selectedColumn]))
                        .filter((v) => !isNaN(v));
                    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
                    cleanedData = parsedData.map((row) => {
                        const newRow = { ...row };
                        if (newRow[selectedColumn] === "" || newRow[selectedColumn] == null) {
                            newRow[selectedColumn] = avg;
                        }
                        return newRow;
                    });
                }
                break;

            case "fill-between":

                {
                    const values = parsedData.map((r) =>
                        r[selectedColumn] === "" || r[selectedColumn] == null
                            ? null
                            : Number(r[selectedColumn])
                    );

                    cleanedData = parsedData.map((row, idx) => {
                        const newRow = { ...row };
                        if (values[idx] == null) {

                            let prev = null,
                                next = null;
                            for (let i = idx - 1; i >= 0; i--) {
                                if (values[i] != null) {
                                    prev = values[i];
                                    break;
                                }
                            }
                            for (let j = idx + 1; j < values.length; j++) {
                                if (values[j] != null) {
                                    next = values[j];
                                    break;
                                }
                            }
                            if (prev != null && next != null) {
                                newRow[selectedColumn] = (prev + next) / 2;
                            } else if (prev != null) {
                                newRow[selectedColumn] = prev;
                            } else if (next != null) {
                                newRow[selectedColumn] = next;
                            } else {
                                newRow[selectedColumn] = 0;
                            }
                        }
                        return newRow;
                    });
                }
                break;

            default:
                break;
        }


        setParsedData(cleanedData);
        setShowPreview(true);


        const stats = computeSummaryStatistics(
            cleanedData,
            Object.keys(cleanedData[0])
        );
        setSummaryStats(stats);

    };


    const columnOptions = columns.map((col) => ({ value: col, label: col }));
    const actionOptions = [
        { value: "drop", label: "Drop Missing Values" },
        { value: "convert", label: "Convert Text to Numeric" },
        { value: "normalize", label: "Encode Text as Categorical Dummies" },
        { value: "fill-average", label: "Fill Missing with Global Average" },
        { value: "fill-between", label: "Fill Missing with Interpolated Average" },
    ];

    return (
        <>
            <div className="w-full px-4 my-6">
                <div className="text-center bg-blue-100 py-3 rounded shadow-sm">
                    <h2 className="text-2xl font-semibold text-gray-800">Data Cleanup</h2>
                </div>
            </div>

            <div className="w-full px-4 my-6">
                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-6 p-6 border-2 border-solid border-gray-300 rounded-lg w-full bg-white shadow-sm">

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Upload File</label>
                            <input
                                type="file"
                                className="px-2 py-[5px] border border-gray-300 rounded bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 hover:border-gray-400"
                                accept=".csv"
                                ref={fileInputRef}
                                onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                        setFileUploaded(true);
                                        parseCsvFile(file, onDataParsed);
                                    }
                                }}
                            />
                        </div>


                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Variables</label>
                            <Select
                                options={columnOptions}
                                value={selectedColumn ? columnOptions.find((opt) => opt.value === selectedColumn) : null}
                                onChange={(selected) => setSelectedColumn(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>


                        <div className="flex flex-col w-64">
                            <label className="text-sm text-gray-700 mb-1">Type of Data Cleanup</label>
                            <Select
                                options={actionOptions}
                                value={selectedAction ? actionOptions.find((opt) => opt.value === selectedAction) : null}
                                onChange={(selected) => setSelectedAction(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>


                        <div className="w-full flex justify-center gap-4 mt-6">
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleSummaryStatistics}>
                                Summary Statistics
                            </button>
                            <button
                                className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                onClick={handleApplyCleanup}
                            >
                                Apply Cleanup
                            </button>
                            <button
                                className="w-40 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                onClick={handleClear}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {showPreview && parsedData.length > 0 && (
                <div className="overflow-x-auto max-h-[500px] mt-6 px-4">
                    <table className="min-w-full border border-gray-300 text-sm">
                        <thead className="bg-gray-100">
                            <tr>
                                {Object.keys(parsedData[0]).map((col) => (
                                    <th key={col} className="px-3 py-2 border border-gray-300 text-left">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {parsedData.slice(0, 20).map((row, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    {Object.keys(row).map((col) => (
                                        <td key={col} className="px-3 py-2 border border-gray-300">
                                            {row[col]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {summaryStats.length > 0 && (
                <SummaryStatisticsTable stats={summaryStats} showExtended={true} />
            )}
        </>
    );
};

export default DataCleanup;

