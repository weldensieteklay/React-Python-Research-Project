import React, { useEffect, useMemo, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const BEDROOMS = [0, 1, 2, 3, 4];
const BEDROOM_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626"];

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [view, setView] = useState("table"); // "table" | "graph"
  const [selectedZip, setSelectedZip] = useState("");

  useEffect(() => {
    handleFetch("data/dfw-safmr");
  }, []);

  const rows = data?.rows;
  const failures = data?.failures || {};

  const { grouped, years, zipOptions } = useMemo(() => {
    if (!Array.isArray(rows)) return { grouped: [], years: [], zipOptions: [] };

    const byZip = {};
    const yearSet = new Set();

    for (const row of rows) {
      yearSet.add(row.fiscal_year);
      if (!byZip[row.zip_code]) {
        byZip[row.zip_code] = {
          zip_code: row.zip_code,
          area_name: row.area_name,
          years: {},
        };
      }
      if (!byZip[row.zip_code].years[row.fiscal_year]) {
        byZip[row.zip_code].years[row.fiscal_year] = {};
      }
      byZip[row.zip_code].years[row.fiscal_year][row.bedrooms] = row.safmr_rent;
    }

    const groupedArr = Object.values(byZip).sort((a, b) =>
      a.zip_code.localeCompare(b.zip_code)
    );

    return {
      grouped: groupedArr,
      years: Array.from(yearSet).sort((a, b) => b - a),
      zipOptions: groupedArr.map((z) => z.zip_code),
    };
  }, [rows]);

  // default the ZIP dropdown to the first one once data loads
  useEffect(() => {
    if (!selectedZip && zipOptions.length > 0) {
      setSelectedZip(zipOptions[0]);
    }
  }, [zipOptions, selectedZip]);

  // chart data: one point per fiscal year (ascending), one field per bedroom size
  const chartData = useMemo(() => {
    if (!selectedZip) return [];
    const zipRow = grouped.find((z) => z.zip_code === selectedZip);
    if (!zipRow) return [];

    return [...years]
      .sort((a, b) => a - b) // chronological for the chart
      .map((year) => {
        const point = { year: `FY${year}` };
        BEDROOMS.forEach((bd) => {
          point[`${bd}BR`] = zipRow.years[year]?.[bd] ?? null;
        });
        return point;
      });
  }, [selectedZip, grouped, years]);

  if (loading) {
    return <div className="p-4 text-gray-500">Loading DFW rental data…</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        {error}
        <button
          onClick={() => handleFetch("data/dfw-safmr-history")}
          className="ml-3 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!grouped.length) {
    return <div className="p-4 text-gray-500">No data available.</div>;
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">
          Dallas-Fort Worth Small Area Fair Market Rents
        </h2>
        <div className="flex items-center gap-2">
          {view === "graph" && (
            <select
              value={selectedZip}
              onChange={(e) => setSelectedZip(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {zipOptions.map((zip) => (
                <option key={zip} value={zip}>
                  {zip}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setView(view === "table" ? "graph" : "table")}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
          >
            {view === "table" ? "Show Graph" : "Show Table"}
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {years.length} fiscal year{years.length !== 1 ? "s" : ""} · {grouped.length} ZIP codes
      </p>

      {Object.keys(failures).length > 0 && (
        <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Some years failed to load:{" "}
          {Object.entries(failures)
            .map(([y, msg]) => `FY${y} (${msg})`)
            .join(", ")}
        </div>
      )}

      {view === "graph" ? (
        <div className="border border-gray-200 rounded p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            SAFMR trend for ZIP {selectedZip}
          </h3>
          {chartData.length === 0 ? (
            <div className="text-sm text-gray-500">No data for this ZIP.</div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip formatter={(value) => (value != null ? `$${value.toLocaleString()}` : "—")} />
                <Legend />
                {BEDROOMS.map((bd, i) => (
                  <Line
                    key={bd}
                    type="monotone"
                    dataKey={`${bd}BR`}
                    stroke={BEDROOM_COLORS[i]}
                    connectNulls
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th rowSpan={2} className="px-3 py-2 border sticky left-0 bg-gray-100 z-10">
                  ZIP
                </th>
                <th rowSpan={2} className="px-3 py-2 border">
                  Area
                </th>
                {years.map((year) => (
                  <th
                    key={year}
                    colSpan={BEDROOMS.length}
                    className="px-3 py-2 border text-center bg-gray-200"
                  >
                    FY{year}
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50 text-left">
                {years.map((year) =>
                  BEDROOMS.map((bd) => (
                    <th key={`${year}-${bd}`} className="px-3 py-2 border text-right whitespace-nowrap">
                      {bd}BR
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => (
                <tr key={row.zip_code} className="border-t">
                  <td className="px-3 py-2 border font-mono sticky left-0 bg-white z-10">
                    {row.zip_code}
                  </td>
                  <td className="px-3 py-2 border whitespace-nowrap">{row.area_name}</td>
                  {years.map((year) =>
                    BEDROOMS.map((bd) => {
                      const rent = row.years[year]?.[bd];
                      return (
                        <td key={`${year}-${bd}`} className="px-3 py-2 border text-right">
                          {rent != null ? `$${rent.toLocaleString()}` : "—"}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}