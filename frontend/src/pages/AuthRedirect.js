// src/pages/AuthRedirect.js
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentUser } from '../services/authServices';

const AuthRedirect = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const handleAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      console.log('Received token:', token ? 'Token exists' : 'No token');

      if (token) {
        try {
          localStorage.setItem('token', token);
          console.log('Token stored in localStorage');
          
          const userData = await getCurrentUser();
          console.log('User data fetched:', userData ? 'Success' : 'Failed');
          
          if (userData) {
            console.log('Logging in user and redirecting to home');
            await login(userData);
            navigate('/home');
          } else {
            console.error('Failed to get user data');
            navigate('/auth');
          }
        } catch (error) {
          console.error('Auth error:', error);
          navigate('/auth');
        }
      } else {
        console.log('No token found, redirecting to auth');
        navigate('/auth');
      }
    };

    handleAuth();
  }, [navigate, login]);

  return <div>Authenticating...</div>;
};

export default AuthRedirect;
