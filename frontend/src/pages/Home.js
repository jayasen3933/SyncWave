import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import './Home.css';

function Home() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const generateSessionId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateSession = (e) => {
    e.preventDefault();
    if (sessionName.trim()) {
      const newSessionId = generateSessionId();
      navigate(`/session/${newSessionId}?name=${encodeURIComponent(sessionName)}`);
    }
  };

  // Accept either a raw session ID or a full invite link (…/session/ABC123?name=…)
  const extractSessionId = (value) => {
    const trimmed = value.trim();
    const match = trimmed.match(/\/session\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  };

  const handleJoinSession = async (e) => {
    e.preventDefault();
    const id = extractSessionId(sessionId);
    if (!id) return;

    setJoinError('');
    setIsJoining(true);
    try {
      await axios.get(`${API_URL}/api/sessions/${encodeURIComponent(id)}`);
      navigate(`/session/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.response?.status === 404) {
        setJoinError('Session not found. Please check the session ID and try again.');
      } else if (!error.response) {
        setJoinError('Cannot connect to server. Please try again later.');
      } else {
        setJoinError(error.response.data?.message || 'Could not join the session.');
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/auth/login', { replace: true });
  };

  return (
    <div className="home-page">
      {user && (
        <div className="greeting-message">
          Hey {user.name}, ready to vibe in sync?
        </div>
      )}
      <div className="logout-button">
        <button onClick={handleLogout} className="btn btn-secondary">
          Logout
        </button>
      </div>
      {/* Background music notes animation */}
      <div className="bg-music-notes">
        {[...Array(15)].map((_, i) => (
          <div key={i} className={`bg-music-note note-${i + 1}`}>
            {i % 2 === 0 ? '♪' : '♫'}
          </div>
        ))}
      </div>

      <div className="content-container">
        <div className="header-section">
          <div className="logo">
            <img src="/logo.png" alt="App Logo" className="logo-icon" style={{ height: '100px', width: '170px', borderRadius: '50%' }} />
          </div>
          <h1 className="title">SyncWave</h1>
          <p className="subtitle">Music Sessions with Friends</p>
        </div>

        <div className="actions-section">
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
            Create Session
          </button>
          <button onClick={() => setShowJoinModal(true)} className="btn btn-secondary">
            Join Session
          </button>
        </div>

        <footer className="footer">
          SyncWave © {new Date().getFullYear()} | Listening Together
        </footer>
      </div>

      {/* Create Session Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Create New Session</h3>
              <button
                className="close-modal-btn"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateSession}>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Enter Session Name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">
                  Create Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Session Modal */}
      {showJoinModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Join Session</h3>
              <button
                className="close-modal-btn"
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinError('');
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleJoinSession}>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Enter Session ID or paste invite link"
                  value={sessionId}
                  onChange={(e) => {
                    setSessionId(e.target.value);
                    setJoinError('');
                  }}
                  required
                  autoFocus
                />
                {joinError && <div className="error-message">{joinError}</div>}
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={isJoining}>
                  {isJoining ? 'Joining...' : 'Join Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;