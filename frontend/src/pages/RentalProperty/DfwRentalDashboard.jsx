import React, { useEffect, useMemo } from "react";
import { useFetchData } from "../../hooks/useFetchData";

export default function DfwRentalDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();

  useEffect(() => {
    handleFetch("data/dfw-safmr");
  }, []);

  // reshape long-format rows into { zip_code: { area_name, [bedrooms]: rent } }
  const grouped = useMemo(() => {
    if (!Array.isArray(data)) return [];

    const byZip = {};
    for (const row of data) {
      const key = row.zip_code;
      if (!byZip[key]) {
        byZip[key] = { zip_code: key, area_name: row.area_name };
      }
      byZip[key][`bd_${row.bedrooms}`] = row.safmr_rent;
    }
    return Object.values(byZip).sort((a, b) =>
      a.zip_code.localeCompare(b.zip_code)
    );
  }, [data]);

  if (loading) {
    return <div className="p-4 text-gray-500">Loading DFW rental data…</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        {error}
        <button
          onClick={() => handlePredict({}, "dfw-safmr")}
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
    <div className="p-4 overflow-x-auto">
      <h2 className="text-lg font-semibold mb-3">
        Dallas-Fort Worth Small Area Fair Market Rents
      </h2>
      <table className="min-w-full border border-gray-200 text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="px-3 py-2 border">ZIP</th>
            <th className="px-3 py-2 border">Area</th>
            <th className="px-3 py-2 border">0BR</th>
            <th className="px-3 py-2 border">1BR</th>
            <th className="px-3 py-2 border">2BR</th>
            <th className="px-3 py-2 border">3BR</th>
            <th className="px-3 py-2 border">4BR</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((row) => (
            <tr key={row.zip_code} className="border-t">
              <td className="px-3 py-2 border font-mono">{row.zip_code}</td>
              <td className="px-3 py-2 border">{row.area_name}</td>
              {[0, 1, 2, 3, 4].map((bd) => (
                <td key={bd} className="px-3 py-2 border text-right">
                  {row[`bd_${bd}`] != null
                    ? `$${row[`bd_${bd}`].toLocaleString()}`
                    : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}