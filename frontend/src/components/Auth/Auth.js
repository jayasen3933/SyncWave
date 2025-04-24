import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../../Auth.css";
import { useAuth } from '../../context/AuthContext';

const Auth = ({ isLogin }) => {
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const navigate = useNavigate();

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIsLoading(true);

    if (!isLogin) {
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match");
        setIsLoading(false);
        return;
      }
    }

    try {
      const endpoint = isLogin ? "login" : "register";
      const body = isLogin
        ? { email: formData.email, password: formData.password }
        : {
          name: formData.username,
          email: formData.email,
          password: formData.password,
        };

      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/auth/${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (response.ok) {
        // Store the token and user data
        localStorage.setItem('user', JSON.stringify(data));
        localStorage.setItem('token', data.token);

        // Update auth context
        login(data);

        setSuccess(
          isLogin ? "Login successful!" : "Account created successfully!"
        );

        // Check if there's a redirect path saved
        const redirectPath = localStorage.getItem('redirectAfterLogin');
        localStorage.removeItem('redirectAfterLogin'); // Clear it after getting it

        setTimeout(() => {
          navigate(redirectPath || '/home');
        }, 1500);
      } else {
        setError(
          data.message ||
          `${isLogin ? "Login" : "Signup"} failed. Please try again.`
        );
      }
    } catch (error) {
      setError("Connection error. Please check your internet and try again.");
      console.error("Network error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Replace the existing handleGoogleLogin function
  const handleGoogleLogin = () => {
    // Store the return URL in localStorage
    localStorage.setItem('returnTo', '/home');

    // Redirect to Google OAuth endpoint
    window.location.href = `${process.env.REACT_APP_API_URL}/api/auth/google`;
  };

  return (
    <div className="auth-container">
      {/* Updated Branding Section */}
      <div className="branding-section">
        {/* Updated header with logo and title in top-left */}
        <div className="branding-header">
          <div className="logo-container">
            <div className="logo">
              <span className="logo-icon">♫</span>
            </div>
            <div className="branding-text">
              <h1>SyncWave</h1>
              <p className="tagline">Multi-Device Synchronized Music Player</p>
            </div>
          </div>
        </div>

        {/* New "What is SyncWave?" section */}
        <div className="intro-section">
          <h2>What is SyncWave?</h2>
          <p>
            SyncWave lets you connect with friends through real-time, synchronized music — share tracks,
            react with emojis, and enjoy virtual listening parties from anywhere in the world.
          </p>
        </div>

        {/* Key Features section - keep structure but adjust styling */}
        <div className="features-section">
          <h2>Key Features</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🎧</div>
              <div className="feature-content">
                <h3>Synchronized Music</h3>
                <p>Listen together, perfectly in sync, on any device.</p>
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <div className="feature-content">
                <h3>Collaborative Playlists</h3>
                <p>Create and share playlists with friends in real-time.</p>
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🌐</div>
              <div className="feature-content">
                <h3>Global Connections</h3>
                <p>Distance is no barrier - connect with friends worldwide.</p>
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🎮</div>
              <div className="feature-content">
                <h3>Real-Time Control</h3>
                <p>Synchronized playback controls across all devices.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Login/Signup Form Section */}
      <div className="login-section mt-10">
        <div className={`login-card ${isLogin ? 'login-form' : 'signup-form'}`}>
          <div className="login-header text-center mb-4">
            <h2>{isLogin ? "Welcome Back" : "Create Account"}</h2>
            <p>
              {isLogin
                ? "Sign in to continue your musical journey"
                : "Join the music revolution today"}
            </p>
          </div>

          <button
            type="button"
            className="google-login-btn"
            onClick={handleGoogleLogin}
            aria-label="Continue with Google"
          >
            <img
              src="https://www.google.com/favicon.ico"
              alt="Google"
              className="google-icon"
            />
            Continue with Google
          </button>

          <div className="divider">
            <span>or continue with email</span>
          </div>

          <form onSubmit={handleSubmit}>
            {!isLogin && (
              <div className="form-group">
                <input
                  type="text"
                  id="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder=" "
                  required
                  aria-label="Username"
                />
                <label htmlFor="username">Username</label>
              </div>
            )}

            <div className="form-group">
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder=" "
                required
                aria-label="Email"
              />
              <label htmlFor="email">Email</label>
            </div>

            <div className="form-group">
              <div className="password-input">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder=" "
                  required
                  aria-label="Password"
                />
                <label htmlFor="password">Password</label>
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className="form-group">
                <div className="password-input">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder=" "
                    required
                    aria-label="Confirm password"
                  />
                  <label htmlFor="confirmPassword">Confirm Password</label>
                </div>
              </div>
            )}

            {isLogin && (
              <div className="form-options">
                <label className="remember-me">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" className="forgot-password">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <button type="submit" className="submit-btn" disabled={isLoading}>
              {isLoading
                ? isLogin
                  ? "Signing in..."
                  : "Creating Account..."
                : isLogin
                  ? "Sign In"
                  : "Create Account"}
            </button>

            <p className="switch-auth">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <Link to={isLogin ? "/auth/signup" : "/auth/login"}>
                {isLogin ? "Sign Up" : "Sign in"}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Auth;