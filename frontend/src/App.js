import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './components/Auth/Auth';
import ForgotPassword from './components/Auth/ForgotPassword';
import ResetPassword from './components/Auth/ResetPassword';
import AuthRedirect from './pages/AuthRedirect';
import Home from './pages/Home';
import Session from './pages/Session';
import PrivateRoute, { PublicRoute } from './components/PrivateRoute';
import { AuthProvider } from './context/AuthContext';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/session/:sessionId" element={<PrivateRoute><Session /></PrivateRoute>} />
            <Route path="/home" element={<PrivateRoute><Home /></PrivateRoute>} />

            <Route path="/auth/login" element={<PublicRoute><Auth isLogin={true} /></PublicRoute>} />
            <Route path="/auth/signup" element={<PublicRoute><Auth isLogin={false} /></PublicRoute>} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/reset-password/:token" element={<ResetPassword />} />
            <Route path="/auth/redirect" element={<AuthRedirect />} />

            {/* Aliases / fallbacks */}
            <Route path="/login" element={<Navigate to="/auth/login" replace />} />
            <Route path="/signup" element={<Navigate to="/auth/signup" replace />} />
            <Route path="/register" element={<Navigate to="/auth/signup" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/auth/forgot-password" replace />} />
            <Route path="/auth" element={<Navigate to="/auth/login" replace />} />
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
