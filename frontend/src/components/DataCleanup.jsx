import React, { useState, useRef } from "react";
import Select from "react-select";
import { parseCsvFile, computeSummaryStatistics } from "../utils/utils";
import SummaryStatisticsTable from "./SummaryStatisticsTable";
import { ActionButton, ButtonRow, ControlsCard, Field, FileInput, PageHeader, PreviewTable, Section } from "./ui";

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

    const isDisabled =
    !fileUploaded ||
    !selectedAction
    !selectedColumn;
  

    return (
        <>
            <Section>
                <PageHeader title="Data Cleanup" />
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
                            }}
                        />
                    </Field>


                    <Field label="Variables">
                        <Select
                            options={columnOptions}
                            value={selectedColumn ? columnOptions.find((opt) => opt.value === selectedColumn) : null}
                            onChange={(selected) => setSelectedColumn(selected.value)}
                            classNamePrefix="react-select"
                            styles={selectStyles}
                        />
                    </Field>


                    <Field label="Type of Data Cleanup" width={256}>
                        <Select
                            options={actionOptions}
                            value={selectedAction ? actionOptions.find((opt) => opt.value === selectedAction) : null}
                            onChange={(selected) => setSelectedAction(selected.value)}
                            classNamePrefix="react-select"
                            styles={selectStyles}
                        />
                    </Field>


                    <ButtonRow>
                        <ActionButton onClick={handleSummaryStatistics}>
                            Summary Statistics
                        </ActionButton>
                        <ActionButton onClick={handleApplyCleanup} disabled={isDisabled}>
                            Apply Cleanup
                        </ActionButton>
                        <ActionButton tone="secondary" onClick={handleClear}>
                            Clear
                        </ActionButton>
                    </ButtonRow>
                </ControlsCard>
            </Section>

            {showPreview && parsedData.length > 0 && <PreviewTable rows={parsedData} />}
            {summaryStats.length > 0 && (
                <SummaryStatisticsTable stats={summaryStats} showExtended={true} />
            )}
        </>
    );
};

const selectStyles = { container: (base) => ({ ...base, fontSize: "0.875rem" }) };

export default DataCleanup;
