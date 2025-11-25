import React from "react";

const PredictionTable = ({ result }) => {
  if (!result || !result.data || !Array.isArray(result.data)) {
    return <p className="text-red-500">No model summary available.</p>;
  }

  return (
    <div className="mt-6 w-full max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">{`${result.model} Results`}</h2>

      <div className="grid grid-cols-2 gap-4 text-sm text-gray-700 mb-6">
        <div><strong>Stationary:</strong> {result.stationary ? "Yes" : "No"}</div>
        <div><strong>ADF p-value:</strong> {result.adfuller}</div>
        <div><strong>AIC:</strong> {result.aic}</div>
        <div><strong>BIC:</strong> {result.bic}</div>
        {result.mse && <div><strong>MSE:</strong> {result.mse}</div>}
        {result.rmse && <div><strong>RMSE:</strong> {result.rmse}</div>}
        {result.mae && <div><strong>MAE:</strong> {result.mae}</div>}
        {result.mape && <div><strong>MAPE:</strong> {result.mape}</div>}
      </div>

      <h2 className="text-lg font-semibold text-gray-800 mb-2">Model Coefficients</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-300 rounded">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Field</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Mean</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Std Error</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">p-value</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((row, idx) => (
              <tr key={idx} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2 text-sm text-gray-600">{row.field_name}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{row.mean}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{row.standard_error}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{row.p_value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PredictionTable;
