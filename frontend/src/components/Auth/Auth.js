import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { login as loginRequest, signup as signupRequest, getGoogleLoginUrl } from '../../services/authServices';
import AuthLayout from './AuthLayout';

const URL_ERRORS = {
  google_failed: 'Google sign-in failed or was cancelled. Please try again.',
  google_unavailable: 'Google sign-in is not configured on the server yet. Please use email instead.',
  session_expired: 'Your session has expired. Please sign in again.',
};

const EMPTY_FORM = { name: '', email: '', password: '', confirmPassword: '' };

const getPasswordStrength = (password) => {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (password.length < 6) return { label: 'Too short', level: 0 };
  return [
    { label: 'Weak', level: 1 },
    { label: 'Fair', level: 2 },
    { label: 'Good', level: 3 },
    { label: 'Strong', level: 4 },
    { label: 'Strong', level: 4 },
  ][score];
};

const Auth = ({ isLogin }) => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Show errors passed back from the Google OAuth redirect, etc.
  useEffect(() => {
    const code = searchParams.get('error');
    if (code) setError(URL_ERRORS[code] || 'Something went wrong. Please try again.');
  }, [searchParams]);

  // Reset the form when switching between Sign In and Create Account
  useEffect(() => {
    setFormData((prev) => ({ ...EMPTY_FORM, email: prev.email }));
    setShowPassword(false);
    if (!searchParams.get('error')) setError('');
  }, [isLogin, searchParams]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const validate = () => {
    if (!isLogin) {
      if (!formData.name.trim()) return 'Please enter your name';
      if (formData.password.length < 6) return 'Password must be at least 6 characters';
      if (formData.password !== formData.confirmPassword) return 'Passwords do not match';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      const data = isLogin
        ? await loginRequest(formData.email.trim(), formData.password, rememberMe)
        : await signupRequest(formData.name.trim(), formData.email.trim(), formData.password);

      login(data);
      const redirectPath = localStorage.getItem('redirectAfterLogin');
      localStorage.removeItem('redirectAfterLogin');
      navigate(redirectPath || '/home', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = getGoogleLoginUrl();
  };

  const strength = !isLogin ? getPasswordStrength(formData.password) : null;
  const passwordsMismatch =
    !isLogin && formData.confirmPassword && formData.password !== formData.confirmPassword;

  return (
    <AuthLayout>
      <div className="auth-tabs" role="tablist">
        <Link to="/auth/login" role="tab" aria-selected={isLogin} className={`auth-tab ${isLogin ? 'active' : ''}`}>
          Sign In
        </Link>
        <Link to="/auth/signup" role="tab" aria-selected={!isLogin} className={`auth-tab ${!isLogin ? 'active' : ''}`}>
          Create Account
        </Link>
      </div>

      <div className="login-header">
        <h2>{isLogin ? 'Welcome Back' : 'Create Your Account'}</h2>
        <p>{isLogin ? 'Sign in to continue your musical journey' : 'New here? Join SyncWave in seconds'}</p>
      </div>

      <button type="button" className="google-login-btn" onClick={handleGoogleLogin}>
        <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {isLogin ? 'Continue with Google' : 'Sign up with Google'}
      </button>

      <div className="divider">
        <span>or {isLogin ? 'sign in' : 'sign up'} with email</span>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {!isLogin && (
          <div className="form-group">
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder=" "
              autoComplete="name"
              maxLength={50}
              required
            />
            <label htmlFor="name">Full Name</label>
          </div>
        )}

        <div className="form-group">
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleInputChange}
            placeholder=" "
            autoComplete="email"
            required
          />
          <label htmlFor="email">Email</label>
        </div>

        <div className="form-group password-input">
          <input
            type={showPassword ? 'text' : 'password'}
            id="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            placeholder=" "
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />
          <label htmlFor="password">Password</label>
          <button
            type="button"
            className="toggle-password"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>

        {strength && (
          <div className="password-strength" aria-live="polite">
            <div className="strength-bars">
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={`strength-bar ${n <= strength.level ? `level-${strength.level}` : ''}`} />
              ))}
            </div>
            <span className="strength-label">{strength.label}</span>
          </div>
        )}

        {!isLogin && (
          <div className="form-group">
            <input
              type={showPassword ? 'text' : 'password'}
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleInputChange}
              placeholder=" "
              autoComplete="new-password"
              className={passwordsMismatch ? 'input-error' : ''}
              required
            />
            <label htmlFor="confirmPassword">Confirm Password</label>
          </div>
        )}

        {isLogin && (
          <div className="form-options">
            <label className="remember-me">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span>Remember me</span>
            </label>
            <Link to="/auth/forgot-password" className="forgot-password">
              Forgot password?
            </Link>
          </div>
        )}

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="submit-btn" disabled={isLoading}>
          {isLoading ? (isLogin ? 'Signing in...' : 'Creating account...') : isLogin ? 'Sign In' : 'Create Account'}
        </button>

        <p className="switch-auth">
          {isLogin ? "New to SyncWave? " : 'Already have an account? '}
          <Link to={isLogin ? '/auth/signup' : '/auth/login'}>{isLogin ? 'Create an account' : 'Sign in'}</Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Auth;
