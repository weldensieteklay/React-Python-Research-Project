import { createSlice } from "@reduxjs/toolkit";

const EMPTY = []; // stable reference so selectors don't trigger needless re-renders

const toNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// Reads the MSE from a panel-model response. The boosting endpoint returns it as
// `mse`; adjust here if other endpoints use a different key or a nested object.
// To rank by out-of-sample error instead, return e.g. result?.cross_validation?.rmse?.mean ** 2
export const getMse = (result) => toNum(result?.mse ?? result?.metrics?.mse);

// What the reported MSE was measured on: "holdout" | "walk_forward_cv" | "entity_cv" are out-of-sample;
// "in_sample" (or a response that doesn't say) is the model's error on the data it was fitted to.
export const getMseBasis = (result) => result?.mse_basis ?? "in_sample";
const isOutOfSample = (basis) => basis !== "in_sample";

// Ranked "important factors" from whatever the method returned:
//  - tree/boosting models: feature importances       -> { type: "importance", items: [{ variable, importance }] }
//  - linear models (FE/RE/...): coefficients, ranked
//    by p-value (smallest first)                     -> { type: "coefficient", items: [{ variable, coefficient, pValue }] }
// Only the boosting response has been checked; other endpoints fall through to the
// generic branches below, so verify their key names.
export const getImportantFactors = (result) => {
    if (!result) return { type: null, items: [] };

    if (Array.isArray(result.feature_importances_ranked) && result.feature_importances_ranked.length > 0) {
        const items = result.feature_importances_ranked
            .map((r) => ({ variable: r.variable, importance: toNum(r.importance) }))
            .filter((r) => r.importance !== null);
        if (items.length > 0) return { type: "importance", items };
    }

    if (result.feature_importance && typeof result.feature_importance === "object") {
        const items = Object.entries(result.feature_importance)
            .map(([variable, v]) => ({ variable, importance: toNum(v) }))
            .filter((r) => r.importance !== null)
            .sort((a, b) => b.importance - a.importance);
        if (items.length > 0) return { type: "importance", items };
    }

    if (result.coefficients && typeof result.coefficients === "object") {
        const p = result.p_values || {};
        const items = Object.entries(result.coefficients)
            .map(([variable, v]) => ({ variable, coefficient: toNum(v), pValue: toNum(p[variable]) }))
            .filter((r) => r.coefficient !== null)
            .sort((a, b) => (a.pValue ?? Infinity) - (b.pValue ?? Infinity));
        if (items.length > 0) return { type: "coefficient", items };
    }

    return { type: null, items: [] };
};

const initialState = {
    // { method, mse, basis, context, config, result, forecast, forecastInfo, factors } | null
    best: null,
};

const rentalPropertySlice = createSlice({
    name: "rentalProperty",
    initialState,
    reducers: {
        // Keeps the new result only if it is the first one, belongs to a different
        // problem (different dependent variable / id / date / outlier setting), or beats the stored one.
        // "Beats" means: an out-of-sample MSE always beats an in-sample one (an in-sample number says how
        // well a model memorised its training data, so it must never displace a tested one); between two
        // results of the same kind the strictly smaller MSE wins, and ties keep the existing result.
        // The forecast and the important factors travel with the winning result.
        submitMethodResult: (state, { payload }) => {
            const { method, mse, result, context, config } = payload;
            if (!Number.isFinite(mse)) return;

            const basis = getMseBasis(result);
            const best = state.best;
            const beatsBest =
                !best ||
                best.context !== context ||
                (isOutOfSample(basis) && !isOutOfSample(best.basis)) ||
                (isOutOfSample(basis) === isOutOfSample(best.basis) && mse < best.mse);

            if (beatsBest) {
                state.best = {
                    method,
                    mse,
                    basis,
                    context,
                    config: config || null,
                    result,
                    forecast: Array.isArray(result?.forecast) ? result.forecast : [],
                    forecastInfo: result?.forecast_info ?? null,
                    factors: getImportantFactors(result),
                };
            }
        },
        clearBestMethod: (state) => {
            state.best = null;
        },
    },
});

export const { submitMethodResult, clearBestMethod } = rentalPropertySlice.actions;
export const selectBestMethod = (state) => state.rentalProperty.best;
export const selectBestForecast = (state) => state.rentalProperty.best?.forecast ?? EMPTY;
export default rentalPropertySlice.reducer;
