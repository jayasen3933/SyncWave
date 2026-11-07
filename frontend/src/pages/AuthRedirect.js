// src/pages/AuthRedirect.js
// Landing page for the Google OAuth callback: /auth/redirect?token=...
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentUser, clearAuth } from '../services/authServices';

const AuthRedirect = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      navigate('/auth/login?error=google_failed', { replace: true });
      return;
    }

    (async () => {
      localStorage.setItem('token', token);
      const userData = await getCurrentUser();
      if (userData) {
        login({ ...userData, token });
        const redirectPath = localStorage.getItem('redirectAfterLogin');
        localStorage.removeItem('redirectAfterLogin');
        navigate(redirectPath || '/home', { replace: true });
      } else {
        clearAuth();
        navigate('/auth/login?error=google_failed', { replace: true });
      }
    })();
  }, [navigate, login]);

  return (
    <div className="app-loading">
      <div className="app-spinner" />
      <p>Signing you in...</p>
    </div>
  );
};

export default AuthRedirect;
