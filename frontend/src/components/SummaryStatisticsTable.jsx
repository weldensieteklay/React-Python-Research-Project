import React from "react";

const SummaryStatisticsTable = ({ stats, showExtended = true }) => {
  if (!stats || stats.length === 0) return null;

  return (
    <div className="w-full mt-6">
      <h3 className="text-lg font-semibold mb-4 text-center">
        Summary Statistics
      </h3>

      <table className="w-full border border-gray-300 rounded">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-2 border">Variable</th>
            <th className="p-2 border">Type</th>

            {showExtended && <th className="p-2 border">Average (All)</th>}
            {showExtended && <th className="p-2 border">Average (Non-Missing)</th>}

            <th className="p-2 border">Missing</th>

            <th className="p-2 border">
              Statistic
            </th>
          </tr>
        </thead>

        <tbody>
          {stats.map((stat) => (
            <tr key={stat.column}>
              <td className="border p-2 text-center">
                {stat.column}
              </td>

              <td className="border p-2 text-center">
                {stat.type}
              </td>

              {showExtended && (
                <>
                  <td className="border p-2 text-center">
                    {stat.averageAll ?? "-"}
                  </td>

                  <td className="border p-2 text-center">
                    {stat.averageNonMissing ?? "-"}
                  </td>
                </>
              )}

              <td className="border p-2 text-center">
                {stat.missingCount}
              </td>

              <td className="border p-2">
                {stat.type === "Numeric" ? (
                      <div className="flex flex-col items-center text-center">
                    <div>
                      <strong>Mean:</strong> {stat.mean}
                    </div>

                    <div>
                      <strong>Std. Error:</strong> {stat.standardError}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {Object.entries(stat.frequencies).map(([value, info]) => (
                      <div
                        key={value}
                        className="flex justify-between border-b last:border-b-0 py-1"
                      >
                        <span>{value}</span>

                        <span>
                          {info.count} ({info.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SummaryStatisticsTable;