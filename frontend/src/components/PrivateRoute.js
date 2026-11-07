import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user) {
      // Remember where the user was going (including ?name= etc.) for after login
      localStorage.setItem('redirectAfterLogin', location.pathname + location.search);
    }
  }, [user, location]);

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  return children;
};

// Login/Signup pages: already-signed-in users go straight to the app
export const PublicRoute = ({ children }) => {
  const { user } = useAuth();
  if (user) {
    return <Navigate to="/home" replace />;
  }
  return children;
};

export default PrivateRoute;
