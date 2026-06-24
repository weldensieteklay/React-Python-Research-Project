import { createSlice } from '@reduxjs/toolkit';

const loadUserFromStorage = () => {
    try {
        const stored = localStorage.getItem('user');
        if (!stored) return null;

        const parsed = JSON.parse(stored);

        // Check expiry of the Google ID token
        if (parsed?.exp && Date.now() >= parsed.exp * 1000) {
            localStorage.removeItem('user');
            localStorage.removeItem('credential');
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
};

const initialState = {
    user: loadUserFromStorage(),
};

const userSlice = createSlice({
    name: 'user',
    initialState,
    reducers: {
        setUser: (state, action) => {
            state.user = action.payload;
            localStorage.setItem('user', JSON.stringify(action.payload));
        },
        clearUser: (state) => {
            state.user = null;
            localStorage.removeItem('user');
            localStorage.removeItem('credential');
        },
    },
});

export const { setUser, clearUser } = userSlice.actions;
export default userSlice.reducer;