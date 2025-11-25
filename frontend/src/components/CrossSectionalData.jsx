import React, { useState, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { parseCsvFile, computeSummaryStatistics } from '../utils/utils';
import SummaryStatisticsTable from './SummaryStatisticsTable';
import { usePrediction } from '../hooks/usePrediction'

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
    const fileInputRef = useRef(null);
    const { data, loading, error, handlePredict: runPrediction } = usePrediction();


    const columnOptions = columns.map(col => ({ value: col, label: col }));

    const methodOptions = [
        { value: 'ols', label: 'OLS' },
        { value: 'lasso', label: 'LASSO' },
    ];

    const outlierOptions = [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
    ];

    const onDataParsed = (data) => {
        setParsedData(data);
        if (data.length > 0) {
            const keys = Object.keys(data[0]);
            setColumns(keys);
        }
        console.log("Parsed Data:", data);
    };

    const handleSummaryStatistics = () => {
        const stats = computeSummaryStatistics(parsedData, columns);
        setSummaryStats(stats);
    };

    const isReadyToPredict =
        fileUploaded &&
        method &&
        idColumn &&
        dependentVar &&
        independentVar &&
        categoricalVar &&
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

        await runPrediction(payload, method);
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

        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        };
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
                            <label className="text-sm text-gray-700 mb-1">Id of the Data</label>
                            <Select
                                options={columnOptions}
                                onChange={(selected) => setIdColumn(selected.value)}
                                value={idColumn ? columnOptions.find(opt => opt.value === idColumn) : null}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Dependent Variables</label>
                            <Select
                                options={columnOptions}
                                value={dependentVar ? columnOptions.find(opt => opt.value === dependentVar) : null}
                                onChange={(selected) => setDependentVar(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Independent Variables</label>
                            <Select
                                isMulti
                                options={columnOptions}
                                value={columnOptions.filter(opt => independentVar.includes(opt.value))}
                                onChange={(selected) => setIndependentVar(selected.map(opt => opt.value))}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Categorical Variables</label>
                            <Select
                                isMulti
                                options={columnOptions}
                                value={columnOptions.filter(opt => categoricalVar.includes(opt.value))}
                                onChange={(selected) => setCategoricalVar(selected.map(opt => opt.value))}
                                className="text-sm"
                                classNamePrefix="react-select"
                            />
                        </div>


                        <div className="flex flex-col w-48">
                            <label className="text-sm text-gray-700 mb-1">Outliers</label>
                            <Select
                                options={outlierOptions}
                                value={outliers ? outlierOptions.find(opt => opt.value === outliers) : null}
                                onChange={(selected) => setOutliers(selected.value)}
                                classNamePrefix="react-select"
                                className="text-sm"
                            />
                        </div>

                        <div className="w-full flex flex-wrap justify-center gap-4 mt-6">
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleSummaryStatistics}>
                                Summary Statistics
                            </button>
                            <button className={`w-40 px-4 py-2 rounded ${isReadyToPredict
                                ? "bg-blue-500 text-white hover:bg-blue-600"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                                }`}
                                disabled={!isReadyToPredict}
                                onClick={handlePredict}>
                                Predict
                            </button>
                            <button className="w-40 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={handleClear}>
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
    )
}

export default CrossSectionalData;