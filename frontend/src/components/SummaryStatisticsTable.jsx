
import React from "react";


const SummaryStatisticsTable = ({ stats, showExtended = true }) => {
  if (!stats || stats.length === 0) return null;

  return (
    <div className="w-full mt-6">
      <h3 className="text-lg font-semibold mb-2 text-center">Summary Statistics</h3>
      <table className="w-full border border-gray-300 rounded">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-2 border">Column</th>
            {showExtended && <th className="p-2 border">Average (All)</th>}
            {showExtended && <th className="p-2 border">Average (Non-Missing)</th>}
            {showExtended && <th className="p-2 border">Missing Count</th>}
            <th className="p-2 border">Mean</th>
            <th className="p-2 border">Standard Error</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.column}>
              <td className="p-2 border text-center">{stat.column}</td>
              {showExtended && (
                <>
                  <td className="p-2 border text-center">{stat.averageAll}</td>
                  <td className="p-2 border text-center">{stat.averageNonMissing}</td>
                  <td className="p-2 border text-center">{stat.missingCount}</td>
                </>
              )}
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