export const dashboardRoute = [
    {
      crossSectional: {
          title: "Cross-Sectional Data",
          route: "/dashboard/cross-sectional"
      }},
    {timeSeries: {
        title: "Time Series Data",
        route: "/dashboard/time-series"
    }},
    {
      panelData: {
        title: "Panel Data",
        route: "/dashboard/panel-data"
      }
    },
]

const timeSeriesResultsMapping = [
  {
    label: 'Export Ban', key: 'field_name',
    label: 'Mean', key: 'mean',
    label: 'Standard Error', key: 'standard_error',
    label: 'P Value', key: 'p_value',
  }
]
