import React, { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

/**
 * Fully generic ag-Grid wrapper. Pass standard ag-Grid columnDefs and
 * rowData directly — this component has no knowledge of SAFMR, ZIPs,
 * years, or bedrooms. Any shaped data/columns work here.
 *
 * Props:
 *   columnDefs    - ag-Grid column definitions (required)
 *   rowData       - array of row objects (required)
 *   getRowId      - optional row-id function; defaults to ag-Grid's internal index
 *   height        - grid height in px (default 500)
 *   defaultColDef - optional override for ag-Grid's defaultColDef
 *   extraStyles   - optional <style> block contents for custom cell/header classes
 *   ...gridProps  - any other AgGridReact prop is passed straight through
 */
export default function DataGrid({
  columnDefs,
  rowData,
  getRowId,
  height = 500,
  defaultColDef,
  extraStyles,
  ...gridProps
}) {
  const resolvedDefaultColDef = useMemo(
    () => ({ sortable: true, resizable: true, ...defaultColDef }),
    [defaultColDef]
  );

  return (
    <div className="ag-theme-quartz" style={{ height, width: "100%" }}>
      {extraStyles && <style>{extraStyles}</style>}
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={resolvedDefaultColDef}
        getRowId={getRowId}
        {...gridProps}
      />
    </div>
  );
}