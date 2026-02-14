import Papa from "papaparse";

export const parseCsvFile = (file, callback) => {
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const cleaned = results.data
        // .filter(row =>
        //   Object.values(row).every(value => value !== null && value !== "")
        // )
        .map(row => {
          const transformed = {};
          console.log(row, 'rowrow')
          for (const [key, value] of Object.entries(row)) {
            const newKey = key.replace(/_/g, " ");
            const newValue = typeof value === "string"
              ? value.replace(/_/g, " ")
              : value;
            transformed[key] = newValue;
          }
          return transformed;
        });

      callback(cleaned);
    },
    error: (err) => {
      console.error("CSV parsing error:", err);
    }
  });
};
;

export const computeSummaryStatistics = (data, columns) => {
  if (!data || data.length === 0 || !columns || columns.length === 0) return [];

  const numericColumns = columns.filter((col) => {
    const sample = data[0][col];
    const isNumeric = !isNaN(parseFloat(sample));
    const isExcluded =
      col.toLowerCase().includes("id") || col.toLowerCase().includes("date");
    return isNumeric && !isExcluded;
  });

  return numericColumns.map((col) => {
    const values = data.map((row) => {
      const val = parseFloat(row[col]);
      return isNaN(val) ? null : val;
    });

    const nonMissing = values.filter((v) => v !== null);
    const missingCount = values.length - nonMissing.length;

    // Average over all (missing treated as 0)
    const avgAll =
      values.reduce((sum, v) => sum + (v !== null ? v : 0), 0) / values.length;

    // Average for non-missing only
    const avgNonMissing =
      nonMissing.length > 0
        ? nonMissing.reduce((sum, v) => sum + v, 0) / nonMissing.length
        : 0;

    // Mean (same as avgNonMissing)
    const mean = avgNonMissing;

    // Standard Error
    const stdErr =
      nonMissing.length > 0
        ? Math.sqrt(
          nonMissing.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          nonMissing.length
        ) / Math.sqrt(nonMissing.length)
        : 0;

    return {
      column: col,
      averageAll: avgAll.toFixed(2),
      averageNonMissing: avgNonMissing.toFixed(2),
      missingCount: missingCount,
      mean: mean.toFixed(2),
      standardError: stdErr.toFixed(2),
    };
  });
};
