import Papa from "papaparse";

export const parseCsvFile = (file, callback) => {
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const cleaned = results.data.filter(row =>
        Object.values(row).every(value => value !== null && value !== "")
      );
      callback(cleaned);
    },
    error: (err) => {
      console.error("CSV parsing error:", err);
    }
  });
};

export const computeSummaryStatistics = (data, columns) =>{
    if (!data || data.length === 0 || !columns || columns.length === 0) return [];
  
    const numericColumns = columns.filter(col => {
      const sample = data[0][col];
      const isNumeric = !isNaN(parseFloat(sample));
      const isExcluded = col.toLowerCase().includes("id") || col.toLowerCase().includes("date");
      return isNumeric && !isExcluded;
    });
  
    return numericColumns.map(col => {
      const values = data
        .map(row => parseFloat(row[col]))
        .filter(val => !isNaN(val));
  
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  
      const stdErr =
        Math.sqrt(
          values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
        ) / Math.sqrt(values.length);
  
      return {
        column: col,
        mean: mean.toFixed(2),
        standardError: stdErr.toFixed(2),
      };
    });
  }
  