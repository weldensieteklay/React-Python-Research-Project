import { configureStore } from '@reduxjs/toolkit';
import userReducer from './reducers/user/userSlice';
import rentalPropertyReducer from './reducers/rentalProperty/rentalPropertySlice';
import panelRunReducer from './reducers/panelRunSlice'; // adjust path, see below

export const store = configureStore({
  reducer: {
    user: userReducer,
    rentalProperty: rentalPropertyReducer,
    panelRun: panelRunReducer, // latest forecast run, saved in full
  },
  // Development-only checks. Saved runs include the whole model result (hundreds of
  // forecast rows), so give the checks more time before they warn in the console.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: { warnAfter: 128 },
      serializableCheck: { warnAfter: 128 },
    }),
});