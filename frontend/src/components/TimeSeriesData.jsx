import React, { useState } from 'react';
import { parseCsvFile } from "../constants/constants";

const TimeSeriesData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [selectedDateColumn, setSelectedDateColumn] = useState("");
    const [isValidDateColumn, setIsValidDateColumn] = useState(null);

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            const keys = Object.keys(data[0]);
            setColumns(keys);
        }
        console.log("Parsed Data:", data);
    };

    const handleDateColumnChange = (e) => {
        const selected = e.target.value;
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
                            <input type="file" className="p-2 border border-gray-300 rounded"
                                accept=".csv"
                                onChange={(e) => parseCsvFile(e.target.files[0], onDataParsed)} />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Methods</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Method</option>
                                <option value="method1">Method 1</option>
                                <option value="method2">Method 2</option>
                            </select>
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Date Variable</label>
                            <select className="p-2 border border-gray-300 rounded" value={selectedDateColumn}
                                onChange={handleDateColumnChange}>
                                <option value="">Select Date Variable</option>
                                {columns.map((col) => (
                                    <option key={col} value={col}>
                                        {col}
                                    </option>
                                ))}
                            </select>
                            {isValidDateColumn !== null && (
                                <p className={`text-xs mt-1 ${isValidDateColumn ? "text-green-600" : "text-red-500"}`}>
                                    {isValidDateColumn
                                        ? "Valid date column detected."
                                        : "Selected column does not contain valid date values."}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Start Date</label>
                            <input type="date" className="p-2 border border-gray-300 rounded" />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">End Date</label>
                            <input type="date" className="p-2 border border-gray-300 rounded" />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Endogenous Variables</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Variable</option>
                                {columns.map((col) => (
                                    <option key={col} value={col}>
                                        {col}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">

                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
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
                    </div>
                </div>
            </div>
        </>
    );
}

export default TimeSeriesData;