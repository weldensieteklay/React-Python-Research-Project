import Papa from "papaparse";


export const dashboardRoute = [{
    crossSectional: {
        title: "Cross-Sectional Data",
        route: "/dashboard/cross-sectional"
    }},
    {timeSeries: {
        title: "Time Series Data",
        route: "/dashboard/time-series"
    }}
]


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