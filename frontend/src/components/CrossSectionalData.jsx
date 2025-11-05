import React, { useState } from "react";
import { parseCsvFile } from "../constants/constants";



const CrossSectionalData = () => {
    const [parsedData, setParsedData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [summaryStats, setSummaryStats] = useState([]);


    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            const keys = Object.keys(data[0]);
            setColumns(keys);
        }
        console.log("Parsed Data:", data);
    };

    const handleSummaryStatistics = () => {
        if (parsedData.length === 0) return;

        const numericColumns = columns.filter(col => {
            const sample = parsedData[0][col];
            const isNumeric = !isNaN(parseFloat(sample));
            const isExcluded = col.toLowerCase().includes("id") || col.toLowerCase().includes("date");
            return isNumeric && !isExcluded;
        });

        const stats = numericColumns.map(col => {
            const values = parsedData
                .map(row => parseFloat(row[col]))
                .filter(val => !isNaN(val));

            const mean =
                values.reduce((sum, val) => sum + val, 0) / values.length;

            const stdErr =
                Math.sqrt(
                    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
                ) / Math.sqrt(values.length);

            return {
                column: col,
                mean: mean.toFixed(2),
                standardError: stdErr.toFixed(2),
            };
        });

        setSummaryStats(stats);
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
                            <label className="text-sm text-gray-700 mb-1">Id of the Data</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Id of the Data</option>
                                <option value="id1">ID 1</option>
                                <option value="id2">ID 2</option>
                            </select>
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Dependent Variables</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Dependent Variable</option>
                                {columns.map((col) => (
                                    <option key={col} value={col}>
                                        {col}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Independent Variables</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Independent Variables</option>
                                {columns.map((col) => (
                                    <option key={col} value={col}>
                                        {col}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Categorical Variables</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Categorical Variables</option>
                                {columns.map((col) => (
                                    <option key={col} value={col}>
                                        {col}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Outliers</label>
                            <select className="p-2 border border-gray-300 rounded">
                                <option value="">Select Outliers</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                            </select>
                        </div>

                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleSummaryStatistics}>
                                Summary Statistics
                            </button>
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                                Predict
                            </button>
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                                Clear
                            </button>
                        </div>
                        {summaryStats.length > 0 && (
                            <div className="w-full mt-6">
                                <h3 className="text-lg font-semibold mb-2 text-center">Summary Statistics</h3>
                                <table className="w-full border border-gray-300 rounded">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="p-2 border">Column</th>
                                            <th className="p-2 border">Mean</th>
                                            <th className="p-2 border">Standard Error</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {summaryStats.map(stat => (
                                            <tr key={stat.column}>
                                                <td className="p-2 border text-center">{stat.column}</td>
                                                <td className="p-2 border text-center">{stat.mean}</td>
                                                <td className="p-2 border text-center">{stat.standardError}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>


        </>
    )
}

export default CrossSectionalData;