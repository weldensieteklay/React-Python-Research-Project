export const dashboardRoute = [{
    dataCleaning: {
        title: "Data Cleaning",
        route: "/dashboard/data-cleaning"
    }},
    {
      crossSectional: {
          title: "Cross-Sectional Data",
          route: "/dashboard/cross-sectional"
      }},
    {timeSeries: {
        title: "Time Series Data",
        route: "/dashboard/time-series"
    }}
]

const timeSeriesResultsMapping = [
  {
    label: 'Export Ban', key: 'field_name',
    label: 'Mean', key: 'mean',
    label: 'Standard Error', key: 'standard_error',
    label: 'P Value', key: 'p_value',
  }
]
