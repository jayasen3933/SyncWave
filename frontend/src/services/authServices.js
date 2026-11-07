import axios from 'axios';
import { API_URL } from '../config';

const AUTH_URL = `${API_URL}/api/auth`;

// Endpoints where a 401 is an expected answer (e.g. wrong password), not an expired session
const PUBLIC_AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/logout'];

export const getToken = () => localStorage.getItem('token');

const saveAuth = (data) => {
  if (data && data.token) {
    localStorage.setItem('token', data.token);
    const { token, message, ...user } = data;
    localStorage.setItem('user', JSON.stringify(user));
  }
};

export const clearAuth = () => {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
};

// Attach the auth token to every API request
axios.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired/invalid token on a protected endpoint sends the user back to login
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isPublicAuthCall = PUBLIC_AUTH_PATHS.some((path) => url.includes(`/api/auth${path}`));
    if (error.response?.status === 401 && !isPublicAuthCall) {
      clearAuth();
      if (!window.location.pathname.startsWith('/auth')) {
        localStorage.setItem('redirectAfterLogin', window.location.pathname + window.location.search);
        window.location.href = '/auth/login?error=session_expired';
      }
    }
    return Promise.reject(error);
  }
);

const toError = (error) => {
  if (error.response?.data?.message) return new Error(error.response.data.message);
  if (error.response) return new Error(`Request failed (${error.response.status}). Please try again.`);
  return new Error(`Cannot reach the server at ${API_URL}. Make sure the backend is running, then try again.`);
};

export const login = async (email, password, rememberMe = true) => {
  try {
    const { data } = await axios.post(`${AUTH_URL}/login`, { email, password, rememberMe });
    saveAuth(data);
    return data;
  } catch (error) {
    throw toError(error);
  }
};

export const signup = async (name, email, password) => {
  try {
    const { data } = await axios.post(`${AUTH_URL}/register`, { name, email, password });
    saveAuth(data);
    return data;
  } catch (error) {
    throw toError(error);
  }
};

export const forgotPassword = async (email) => {
  try {
    const { data } = await axios.post(`${AUTH_URL}/forgot-password`, { email });
    return data;
  } catch (error) {
    throw toError(error);
  }
};

export const resetPassword = async (token, password) => {
  try {
    const { data } = await axios.post(`${AUTH_URL}/reset-password/${encodeURIComponent(token)}`, { password });
    saveAuth(data);
    return data;
  } catch (error) {
    throw toError(error);
  }
};

export const logout = async () => {
  try {
    await axios.post(`${AUTH_URL}/logout`);
  } catch {
    // Logging out is client-side; ignore network errors
  } finally {
    clearAuth();
  }
};

export const getGoogleLoginUrl = () => `${AUTH_URL}/google`;

const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

export const getCurrentUser = async () => {
  const token = getToken();
  if (!token) return null;

  if (isTokenExpired(token)) {
    clearAuth();
    return null;
  }

  try {
    const { data } = await axios.get(`${AUTH_URL}/profile`);
    localStorage.setItem('user', JSON.stringify(data));
    return data;
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 404) {
      clearAuth();
      return null;
    }
    // Server unreachable: fall back to the cached user so the app still loads
    const cached = localStorage.getItem('user');
    return cached ? JSON.parse(cached) : null;
  }
};
