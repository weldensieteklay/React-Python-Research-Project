import { configureStore } from '@reduxjs/toolkit';
import userReducer from '../features/user/userSlice';
import rentalPropertyReducer from '../features/rentalProperty/rentalPropertySlice';

export const store = configureStore({
  reducer: {
    user: userReducer,
    rentalProperty: rentalPropertyReducer,
  },
});