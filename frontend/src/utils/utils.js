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

export const computeCategoricalStatistics = (data, column) => {
  const values = data.map(row => row[column]);

  const nonMissing = values.filter(
    value => value !== null &&
             value !== undefined &&
             value !== ""
  );

  const missingCount = values.length - nonMissing.length;

  const frequency = {};

  nonMissing.forEach(value => {
    frequency[value] = (frequency[value] || 0) + 1;
  });

  const frequencies = Object.fromEntries(
    Object.entries(frequency).map(([value, count]) => [
      value,
      {
        count,
        percentage: ((count / nonMissing.length) * 100).toFixed(2)
      }
    ])
  );

  return {
    column,
    type: "Categorical",
    totalObservations: values.length,
    nonMissing: nonMissing.length,
    missingCount,
    categories: Object.keys(frequencies).length,
    frequencies
  };
};

export const computeNumericStatistics = (data, column) => {
  const values = data.map(row => {
    const value = parseFloat(row[column]);
    return isNaN(value) ? null : value;
  });

  const nonMissing = values.filter(value => value !== null);
  const missingCount = values.length - nonMissing.length;

  const averageAll =
    values.reduce((sum, value) => sum + (value ?? 0), 0) / values.length;

  const averageNonMissing =
    nonMissing.length > 0
      ? nonMissing.reduce((sum, value) => sum + value, 0) /
        nonMissing.length
      : 0;

  const mean = averageNonMissing;

  const standardError =
    nonMissing.length > 0
      ? Math.sqrt(
          nonMissing.reduce(
            (sum, value) => sum + Math.pow(value - mean, 2),
            0
          ) / nonMissing.length
        ) / Math.sqrt(nonMissing.length)
      : 0;

  return {
    column,
    type: "Numeric",
    averageAll: averageAll.toFixed(2),
    averageNonMissing: averageNonMissing.toFixed(2),
    missingCount,
    mean: mean.toFixed(2),
    standardError: standardError.toFixed(2),
  };
};

export const computeSummaryStatistics = (
  data,
  columns,
  categoricalColumns = []
) => {
  if (!data?.length || !columns?.length) return [];

  return columns
    .filter(column => {
      const lower = column.toLowerCase();
      return !lower.includes("id") && !lower.includes("date");
    })
    .map(column => {
      const isCategorical = categoricalColumns.includes(column);

      return isCategorical
        ? computeCategoricalStatistics(data, column)
        : computeNumericStatistics(data, column);
    });
};