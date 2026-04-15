import axios from 'axios';
import { store } from '../redux/store'; // Pull in Redux store to get the token

// Create an Axios instance
const api = axios.create({
  baseURL: 'http://localhost:5000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Automatically attach the JWT token to every request
api.interceptors.request.use(
  (config) => {
    // Get the current state from Redux
    const state = store.getState();
    const token = state.auth.accessToken;
    
    // If a token exists, attach it to the Authorization header
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;