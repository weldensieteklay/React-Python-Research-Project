import React, { useEffect, useMemo } from "react";
import { useFetchData } from "../../hooks/useFetchData";

const BEDROOMS = [0, 1, 2, 3, 4];

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();

  useEffect(() => {
    handleFetch("data/dfw-safmr");
  }, []);

  const rows = data?.rows;
  const failures = data?.failures || {};

  // reshape into { zip_code: { area_name, years: { [year]: { [bedrooms]: rent } } } }
  const { grouped, years } = useMemo(() => {
    if (!Array.isArray(rows)) return { grouped: [], years: [] };

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

    return {
      grouped: Object.values(byZip).sort((a, b) =>
        a.zip_code.localeCompare(b.zip_code)
      ),
      years: Array.from(yearSet).sort((a, b) => b - a), // newest first
    };
  }, [rows]);

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
      <h2 className="text-lg font-semibold mb-1">
        Dallas-Fort Worth Small Area Fair Market Rents
      </h2>
      <p className="text-sm text-gray-500 mb-3">
        {years.length} fiscal year{years.length !== 1 ? "s" : ""} · {grouped.length} ZIP codes
      </p>

      {Object.keys(failures).length > 0 && (
        <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Some years failed to load: {Object.entries(failures).map(([y, msg]) => `FY${y} (${msg})`).join(", ")}
        </div>
      )}

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
    </div>
  );
}