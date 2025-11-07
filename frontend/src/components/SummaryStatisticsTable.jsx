
import React from "react";

const SummaryStatisticsTable = ({ stats }) => {
  if (!stats || stats.length === 0) return null;

  return (
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
          {stats.map((stat) => (
            <tr key={stat.column}>
              <td className="p-2 border text-center">{stat.column}</td>
              <td className="p-2 border text-center">{stat.mean}</td>
              <td className="p-2 border text-center">{stat.standardError}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SummaryStatisticsTable;