import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './components/Auth/Auth';
import AuthRedirect from './pages/AuthRedirect';
import Home from './pages/Home';
import Session from './pages/Session';
import PrivateRoute from './components/PrivateRoute';
import { AuthProvider } from './context/AuthContext';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/session/:sessionId" element={
              <PrivateRoute>
                <Session />
              </PrivateRoute>
            } />
            <Route path="/home" element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            } />
            <Route path="/auth/redirect" element={<AuthRedirect />} />
            <Route path="/auth/login" element={<Auth isLogin={true} />} />
            <Route path="/auth/signup" element={<Auth isLogin={false} />} />
            <Route path="/auth" element={<Navigate to="/auth/login" />} />
            <Route path="/" element={<Navigate to="/auth/login" />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;