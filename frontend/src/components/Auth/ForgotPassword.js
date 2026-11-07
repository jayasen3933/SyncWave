import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../../services/authServices';
import AuthLayout from './AuthLayout';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const data = await forgotPassword(email.trim());
      setSent(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="login-header">
        <div className="auth-icon" aria-hidden="true">🔑</div>
        <h2>Forgot Password?</h2>
        <p>
          {sent
            ? 'Check your inbox for the next step.'
            : "Enter the email you signed up with and we'll send you a link to reset your password."}
        </p>
      </div>

      {sent ? (
        <>
          <div className="success-message" role="status">
            {sent.message}
          </div>
          {sent.devResetUrl && (
            <div className="dev-note">
              <strong>Development mode:</strong> email delivery isn't configured, so here is your reset link:
              <a href={sent.devResetUrl}>Open reset link</a>
            </div>
          )}
          <button type="button" className="secondary-btn" onClick={() => setSent(null)}>
            Use a different email
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <input
              type="email"
              id="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder=" "
              autoComplete="email"
              autoFocus
              required
            />
            <label htmlFor="email">Email</label>
          </div>

          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? 'Sending link...' : 'Send Reset Link'}
          </button>
        </form>
      )}

      <p className="switch-auth">
        Remembered it? <Link to="/auth/login">Back to sign in</Link>
      </p>
      <p className="switch-auth">
        New to SyncWave? <Link to="/auth/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
};

export default ForgotPassword;
