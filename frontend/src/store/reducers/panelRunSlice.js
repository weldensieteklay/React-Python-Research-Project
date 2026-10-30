import { createSlice } from "@reduxjs/toolkit";

// ===========================================================================
// The latest panel model run, saved in full so the forecast screen can reopen it:
// method, settings, the complete backend result (prediction table, coefficients,
// diagnostics, forecast) and the summary statistics shown at the time.
//
// Register it in your store (one line):
//   import panelRunReducer from "../features/rentalProperty/panelRunSlice";
//   configureStore({ reducer: { ...yourReducers, panelRun: panelRunReducer } })
//
// The best run (lowest error) is still kept by rentalPropertySlice; this keeps the latest one.
// ===========================================================================

const panelRunSlice = createSlice({
  name: "panelRun",
  initialState: { lastRun: null },
  reducers: {
    // payload: { method, context, config, mse, result, summaryStats, savedAt }
    saveLastRun: (state, action) => { state.lastRun = action.payload; },
    clearLastRun: (state) => { state.lastRun = null; },
  },
});

export const { saveLastRun, clearLastRun } = panelRunSlice.actions;
// Returns null when the reducer isn't registered, so the screen still works without it
export const selectLastRun = (state) => state.panelRun?.lastRun ?? null;
export default panelRunSlice.reducer;
