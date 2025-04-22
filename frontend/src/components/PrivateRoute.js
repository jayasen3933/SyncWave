import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div>Loading...</div>;
  }
  
  if (!user) {
    // Save the attempted URL
    const currentPath = window.location.pathname;
    localStorage.setItem('redirectAfterLogin', currentPath);
    // Redirect to login
    return <Navigate to="/auth/login" replace />;
  }

  return children;
};

export default PrivateRoute;