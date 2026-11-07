// Single source of truth for the backend URL.
const configured = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

// If the app is opened from another host (e.g. 127.0.0.1 or a LAN IP from a phone)
// but the API is configured as localhost, talk to the backend on that same host.
const resolveApiUrl = () => {
  try {
    const api = new URL(configured);
    const pageHost = window.location.hostname;
    const isLocal = (h) => h === 'localhost' || h === '127.0.0.1';
    if (isLocal(api.hostname) && pageHost && !isLocal(pageHost)) {
      api.hostname = pageHost;
      return api.origin;
    }
  } catch (e) { /* fall through */ }
  return configured;
};

export const API_URL = resolveApiUrl();
