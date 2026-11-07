import React from 'react';
import '../../Auth.css';

const FEATURES = [
  { icon: '🎧', title: 'Synchronized Music', text: 'Listen together, perfectly in sync, on any device.' },
  { icon: '👥', title: 'Collaborative Playlists', text: 'Create and share playlists with friends in real-time.' },
  { icon: '🌐', title: 'Global Connections', text: 'Distance is no barrier - connect with friends worldwide.' },
  { icon: '🎮', title: 'Real-Time Control', text: 'Synchronized playback controls across all devices.' },
];

// Shared two-column layout for every auth screen: branding on the left, card on the right.
const AuthLayout = ({ children }) => (
  <div className="auth-container">
    <div className="branding-section">
      <div className="branding-header">
        <div className="logo-container">
          <img src="/logo.png" alt="SyncWave logo" className="brand-logo" />
          <div className="branding-text">
            <h1>SyncWave</h1>
            <p className="tagline">Multi-Device Synchronized Music Player</p>
          </div>
        </div>
      </div>

      <div className="intro-section">
        <h2>What is SyncWave?</h2>
        <p>
          SyncWave lets you connect with friends through real-time, synchronized music — share tracks,
          chat with friends, and enjoy virtual listening parties from anywhere in the world.
        </p>
      </div>

      <div className="features-section">
        <h2>Key Features</h2>
        <div className="features-grid">
          {FEATURES.map((feature) => (
            <div className="feature-card" key={feature.title}>
              <div className="feature-icon">{feature.icon}</div>
              <div className="feature-content">
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="login-section">
      <div className="login-card">{children}</div>
    </div>
  </div>
);

export default AuthLayout;
