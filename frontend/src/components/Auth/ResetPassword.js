import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { resetPassword } from '../../services/authServices';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from './AuthLayout';

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      const data = await resetPassword(token, password);
      setSuccess(data.message || 'Password reset successfully.');
      login(data);
      setTimeout(() => navigate('/home', { replace: true }), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="login-header">
        <div className="auth-icon" aria-hidden="true">🔒</div>
        <h2>Set a New Password</h2>
        <p>Choose a new password for your SyncWave account.</p>
      </div>

      {success ? (
        <div className="success-message" role="status">
          {success} Signing you in...
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group password-input">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              name="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder=" "
              autoComplete="new-password"
              autoFocus
              required
            />
            <label htmlFor="password">New Password</label>
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <div className="form-group">
            <input
              type={showPassword ? 'text' : 'password'}
              id="confirmPassword"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError('');
              }}
              placeholder=" "
              autoComplete="new-password"
              required
            />
            <label htmlFor="confirmPassword">Confirm New Password</label>
          </div>

          {error && (
            <div className="error-message" role="alert">
              {error}
              {error.includes('expired') && (
                <>
                  {' '}
                  <Link to="/auth/forgot-password">Request a new link</Link>
                </>
              )}
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      )}

      <p className="switch-auth">
        <Link to="/auth/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
};

export default ResetPassword;
