export const dashboardRoute = [
    {
      downloadRentalData: {
          title: "Dallas-Fort Worth (DFW) Rental Dashboard",
          route: "/dashboard/rental-data"
      }},
       {
      realEstateData: {
          title: "Mid-West Real Estate Dashboard",
          route: "/dashboard/real-estate-data"
      }},
    // {
    //   crossSectional: {
    //       title: "Cross-Sectional Data",
    //       route: "/dashboard/cross-sectional"
    //   }},
    // {timeSeries: {
    //     title: "Time Series Data",
    //     route: "/dashboard/time-series"
    // }},
    // {
    //   panelData: {
    //     title: "Panel Data",
    //     route: "/dashboard/panel-data"
    //   }
    // },
]

const timeSeriesResultsMapping = [
  {
    label: 'Export Ban', key: 'field_name',
    label: 'Mean', key: 'mean',
    label: 'Standard Error', key: 'standard_error',
    label: 'P Value', key: 'p_value',
  }
]
export const RENTAL_DATA_ALLOWED_EMAILS = ["weldensieteklay@gmail.com", 'zereyesus@gmail.com'];
