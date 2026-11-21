import axios from 'axios';
import { store } from '../redux/store';
import { setAccessToken, logoutUser } from '../redux/authSlice';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

// Create an Axios instance
const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Mutex / Queue state for token refreshing (#11)
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Request Interceptor: Automatically attach the JWT token to every request
api.interceptors.request.use(
  (config) => {
    const state = store.getState();
    const token = state.auth.accessToken;

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Catch 401s, call /auth/refresh, and retry original request (#11)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check if error is 401 and request hasn't already been retried
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const state = store.getState();
      const refreshToken = state.auth.refreshToken || localStorage.getItem('refreshToken');

      if (!refreshToken) {
        isRefreshing = false;
        store.dispatch(logoutUser());
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        const newAccessToken = data.accessToken;

        store.dispatch(setAccessToken({ accessToken: newAccessToken }));
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;

        processQueue(null, newAccessToken);
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        store.dispatch(logoutUser());
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
