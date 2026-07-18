// Central place to define "Guide Me" content per page.
// Add a new key here whenever you wire up a Guide Me button on another screen.
export const guideContent = {
    dashboard: {
        title: "Welcome to the Dashboard",
        steps: [
            {
                heading: "Choose a data category",
                description:
                    "Start by picking the type of dataset you're working with. Each category below runs a different set of statistical models suited to that data's structure.",
            },
            {
                heading: "Cross-Sectional Data",
                description:
                    "Use this when you have many subjects (people, firms, countries, etc.) observed once, at a single point in time.\n\nUpload a CSV of your dataset, then choose your ID column, dependent variable, and independent/categorical variables to run models like OLS, Logit, LASSO, Ridge, or tree-based methods.",
            },
            {
                heading: "Time Series Data",
                description:
                    "Use this when you have repeated observations of the same variable(s) ordered over time (e.g. monthly sales, daily prices).\n\nUpload a CSV with a date/time column plus your target variable to run forecasting and trend models.",
            },
            {
                heading: "Panel Data",
                description:
                    "Use this when you have multiple subjects observed across multiple time periods (e.g. companies tracked over several years).\n\nUpload a CSV with an ID column, a time column, and your variables of interest to run fixed-effects, random-effects, or other panel models.",
            },
            {
                heading: "Ready to start",
                description:
                    "Click any card above to open its upload screen, then follow the on-screen steps to upload your file and configure your model.",
            },
        ],
    },

    crossSectional: {
        title: "Cross-Sectional Analysis Guide",
        steps: [
            {
                heading: "1. Upload your file",
                description:
                    "Upload a CSV file where each row is a single observation (e.g. a person, firm, or country) captured at one point in time.\n\nOnce uploaded, its column names automatically populate the dropdowns below.",
            },
            {
                heading: "2. Choose a method",
                description:
                    "Pick the estimation method for your model:\n\n• OLS, GLS — standard and generalized least squares for continuous outcomes\n• Logit — for binary/classification outcomes\n• LASSO, Ridge — regularized regression, useful with many predictors\n• Forest, Boosting, Bagging — tree-based ensemble models",
            },
            {
                heading: "3. Select your variables",
                description:
                    "• ID Column — a unique identifier for each row (not used in the model itself)\n• Dependent Variable — the outcome you want to predict or explain\n• Independent Variables — the predictors used to explain the dependent variable\n• Categorical Variables — any predictors that are categories rather than numbers (e.g. region, industry); these get encoded automatically",
            },
            {
                heading: "4. Handle outliers",
                description:
                    "Choose whether outlier rows should be detected and treated before the model is estimated. Turning this on can improve model fit if your data has extreme values, but it will also remove or adjust some observations.",
            },
            {
                heading: "5. Run Summary Statistics",
                description:
                    "Click 'Summary Statistics' to see descriptive stats (mean, std. dev., min/max, etc.) for just your dependent and independent variables — a good sanity check before running a full model.",
            },
            {
                heading: "6. Run Predict",
                description:
                    "Once ID column, dependent variable, at least one independent variable, and outlier treatment are all set, the 'Predict' button becomes active. Click it to fit the model and view coefficients (or feature importance for tree-based models), fit statistics, and diagnostic tests.",
            },
            {
                heading: "7. Export your results",
                description:
                    "After a successful prediction, use 'Download as PowerPoint' to export a formatted deck with your model summary, coefficients/feature importance, and diagnostic tests — ready to drop into a paper or presentation.",
            },
        ],
    },
    timeSeries: {
        title: "Time Series Analysis Guide",
        steps: [
            {
                heading: "1. Upload your file",
                description:
                    "Upload a CSV file where each row is an observation of the same variable(s) recorded over time (e.g. daily prices, monthly sales).\n\nOnce uploaded, its column names automatically populate the dropdowns below.",
            },
            {
                heading: "2. Choose a method",
                description:
                    "Pick the forecasting method for your model:\n\n• ARIMA — classic autoregressive model for trend and seasonality\n• LASSO, Ridge — regularized regression, useful with many predictors\n• Forest, Boosting, Bagging — tree-based ensemble models adapted for time-ordered data",
            },
            {
                heading: "3. Select your date variable",
                description:
                    "Choose the column that contains your date or timestamp values. The app checks that every value in this column can be read as a valid date — if it can't, you'll see a warning and won't be able to proceed until you pick a different column.",
            },
            {
                heading: "4. Set your date range",
                description:
                    "Once a valid date column is selected, the Start Date and End Date dropdowns populate automatically with the sorted dates from your file, defaulting to the full range. Narrow this range if you only want to model a specific period.",
            },
            {
                heading: "5. Select your variables",
                description:
                    "• Endogenous Variable — the target variable you want to forecast\n• Exogenous Variables — any additional predictors you want the model to use alongside time (optional, and you can select more than one)",
            },
            {
                heading: "6. Explore your data first",
                description:
                    "Before predicting, use 'Summary Statistics' to see descriptive stats (mean, std. dev., min/max, etc.) for your selected variables, or 'Line Graph' to visualize your endogenous variable over time — both are good sanity checks for spotting trends, gaps, or outliers.",
            },
            {
                heading: "7. Run Predict",
                description:
                    "Once a file is uploaded, a method, valid date column, start/end dates, and endogenous variable are all set, the 'Predict' button becomes active. Click it to fit the model and view forecasted values and diagnostics.",
            },
            {
                heading: "8. Export your results",
                description:
                    "After a successful prediction, use the download button above the results table to export a formatted PowerPoint deck with your forecast — ready to drop into a paper or presentation.",
            },
            {
                heading: "9. Start over",
                description:
                    "Click 'Clear' at any time to reset the uploaded file, selections, and results and start fresh with a new dataset.",
            },
        ],
    },
    panelData: {
        title: "Panel Data Analysis Guide",
        steps: [
            {
                heading: "1. Upload your file",
                description:
                    "Upload a CSV file where each row is an observation of a subject (e.g. a company, person, or region) at a specific point in time, with multiple subjects tracked across multiple time periods.\n\nOnce uploaded, its column names automatically populate the dropdowns below.",
            },
            {
                heading: "2. Choose a method",
                description:
                    "Pick the estimation method for your model:\n\n• Fixed Effects — controls for unobserved characteristics that don't change over time within each subject\n• Random Effects — assumes subject-level differences are uncorrelated with your predictors\n• LASSO, Ridge — regularized regression, useful with many predictors\n• Forest, Boosting, Bagging — tree-based ensemble models",
            },
            {
                heading: "3. Select your variables",
                description:
                    "• Id of the Data — the column identifying each subject (e.g. company ID, person ID); not used directly in the model, but required to distinguish subjects\n• Dependent Variable — the outcome you want to predict or explain\n• Independent Variables — the predictors used to explain the dependent variable\n• Categorical Variables — any predictors that are categories rather than numbers (e.g. region, industry); these get encoded automatically",
            },
            {
                heading: "4. Handle outliers",
                description:
                    "Choose whether outlier rows should be detected and treated before the model is estimated. Turning this on can improve model fit if your data has extreme values, but it will also remove or adjust some observations.",
            },
            {
                heading: "5. Select your date variable",
                description:
                    "Choose the column that identifies the time period for each observation (e.g. year, quarter, month). This is what distinguishes panel data from cross-sectional data — the same subject appears across multiple dates.\n\nIf the selected column doesn't contain valid date values, you'll see a warning and won't be able to proceed until you pick a different column.",
            },
            {
                heading: "6. Run Summary Statistics",
                description:
                    "Click 'Summary Statistics' to see descriptive stats (mean, std. dev., min/max, etc.) for your dependent and independent variables — a good sanity check before running a full model.",
            },
            {
                heading: "7. Run Predict",
                description:
                    "Once a file is uploaded and method, ID column, dependent variable, at least one independent variable, date column, and outlier treatment are all set, the 'Predict' button becomes active. Click it to fit the model and view coefficients (or feature importance for tree-based models), fit statistics, and diagnostic tests.",
            },
            {
                heading: "8. Export your results",
                description:
                    "After a successful prediction, use the download button above the results table to export a formatted PowerPoint deck with your model summary, coefficients/feature importance, and diagnostic tests — ready to drop into a paper or presentation.",
            },
            {
                heading: "9. Start over",
                description:
                    "Click 'Clear' at any time to reset the uploaded file, selections, and results and start fresh with a new dataset.",
            },
        ],
    },
};