import React, { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const currencyFormatter = (params) =>
  params.value != null ? `$${Number(params.value).toLocaleString()}` : "—";

/**
 * Reusable grid for ZIP x fiscal-year x bedroom panel data (e.g. HUD
 * SAFMR actuals + forecast). Column groups are built dynamically: one
 * group per fiscal year, with one child column per bedroom size inside
 * it, so the shape mirrors whatever `years` and `bedrooms` are passed
 * in — this isn't hardcoded to DFW or to 0-4BR specifically.
 *
 * Props:
 *   rows          - array of { zip_code, area_name, years: { [year]: { [bedroom]: rent } } }
 *   years         - array of fiscal years to show as column groups, any order
 *   bedrooms      - array of bedroom sizes to show as child columns (default 0-4)
 *   forecastYears - Set (or array) of years that should render with forecast styling
 *   height        - grid height in px (default 500)
 */
export default function SafmrGrid({
  rows,
  years,
  bedrooms = [0, 1, 2, 3, 4],
  forecastYears = new Set(),
  height = 500,
}) {
  const forecastSet = useMemo(
    () => (forecastYears instanceof Set ? forecastYears : new Set(forecastYears)),
    [forecastYears]
  );

  const sortedYears = useMemo(() => [...years].sort((a, b) => b - a), [years]);

  const columnDefs = useMemo(() => {
    const pinnedCols = [
      {
        headerName: "ZIP",
        field: "zip_code",
        pinned: "left",
        width: 110,
        cellClass: "font-mono",
      },
      {
        headerName: "Area",
        field: "area_name",
        pinned: "left",
        width: 220,
      },
    ];

    const yearGroups = sortedYears.map((year) => {
      const isForecast = forecastSet.has(year);
      return {
        headerName: isForecast ? `FY${year} (forecast)` : `FY${year}`,
        headerClass: isForecast ? "safmr-header-forecast" : "safmr-header-actual",
        children: bedrooms.map((bd) => ({
          headerName: `${bd}BR`,
          colId: `${year}_${bd}`,
          width: 100,
          type: "rightAligned",
          valueGetter: (params) => params.data?.years?.[year]?.[bd] ?? null,
          valueFormatter: currencyFormatter,
          cellClass: isForecast ? "safmr-cell-forecast" : undefined,
        })),
      };
    });

    return [...pinnedCols, ...yearGroups];
  }, [sortedYears, bedrooms, forecastSet]);

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
    }),
    []
  );

  return (
    <div className="ag-theme-quartz" style={{ height, width: "100%" }}>
      <style>{`
        .safmr-header-forecast { background-color: #dbeafe !important; }
        .safmr-header-actual { background-color: #e5e7eb !important; }
        .safmr-cell-forecast { background-color: rgba(219, 234, 254, 0.5) !important; font-style: italic; color: #1d4ed8; }
      `}</style>
      <AgGridReact
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(params) => params.data.zip_code}
        suppressColumnVirtualisation={bedrooms.length * years.length < 100}
      />
    </div>
  );
}