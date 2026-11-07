import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { getCurrentUser, logout as logoutRequest } from '../services/authServices';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((userData) => {
        if (!cancelled) setUser(userData);
      })
      .catch((error) => console.error('Auth initialization error:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Accepts the API response ({ ...user, token }) or a plain user object
  const login = useCallback((userData) => {
    if (!userData) return;
    const { token, message, ...profile } = userData;
    if (token) localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(profile));
    setUser(profile);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await logoutRequest();
  }, []);

  const value = useMemo(() => ({ user, login, logout, loading }), [user, login, logout, loading]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-spinner" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
