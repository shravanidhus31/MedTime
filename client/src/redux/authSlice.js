import { createSlice } from '@reduxjs/toolkit';

// Retrieve persisted auth data if available
let storedUser = null;
try {
  const item = localStorage.getItem('user');
  if (item) storedUser = JSON.parse(item);
} catch (e) {
  storedUser = null;
}

const storedRefreshToken = localStorage.getItem('refreshToken') || null;

const initialState = {
  user: storedUser, // { id, name, role }
  accessToken: null,
  refreshToken: storedRefreshToken,
  isAuthenticated: !!storedRefreshToken,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      if (action.payload.refreshToken) {
        state.refreshToken = action.payload.refreshToken;
        localStorage.setItem('refreshToken', action.payload.refreshToken);
      }
      if (action.payload.user) {
        localStorage.setItem('user', JSON.stringify(action.payload.user));
      }
      state.isAuthenticated = true;
    },
    setAccessToken: (state, action) => {
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
    },
    logoutUser: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    },
  },
});

export const { setCredentials, setAccessToken, logoutUser } = authSlice.actions;
export default authSlice.reducer;
