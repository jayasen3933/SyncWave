import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import timesync from 'timesync';
import { useAuth } from '../context/AuthContext';
import './Session.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlay,
  faPause,
  faForward,
  faBackward,
  faPoll,
  faPaperPlane,
  faShare,
  faSync
} from '@fortawesome/free-solid-svg-icons';

import { API_URL } from '../config';
import { getToken } from '../services/authServices';

// Rebuild the chat timeline (messages + polls) from the server's session state
const buildChatHistory = (messages = [], polls = []) => {
  const pollMessages = polls
    .filter((poll) => poll && poll.id !== undefined)
    .map((poll) => ({
      type: 'poll',
      poll,
      sender: poll.creator,
      timestamp: poll.timestamp || new Date(poll.id).toISOString(),
    }));
  return [...messages.filter((m) => m && m.type !== 'poll'), ...pollMessages].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
};

// Resolve a song to a playable HTTP URL.
// Prefer song.url (the streaming endpoint set by the server),
// fall back to constructing one from _id, and reject raw filesystem paths.
const getSongUrl = (song) => {
  if (!song) return '';
  if (song.url) {
    // If the stored URL is a relative path like /api/songs/…, make it absolute
    if (song.url.startsWith('/')) return `${API_URL}${song.url}`;
    // If it looks like a valid http(s) URL, use it directly
    if (song.url.startsWith('http://') || song.url.startsWith('https://')) return song.url;
    // Anything else (e.g. a firebase:// or Windows path) — ignore it
  }
  if (song._id) return `${API_URL}/api/songs/${song._id}/stream`;
  return '';
};

// Drift threshold in seconds — if further apart than this, hard-seek.
const DRIFT_THRESHOLD = 1.5;

function Session() {
  const [isReady, setIsReady] = useState(true);
  const { sessionId } = useParams();
  const seekTimeoutRef = useRef(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [sessionName, setSessionName] = useState('');
  const [readyCount, setReadyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [countdownTime, setCountdownTime] = useState(null);
  const messagesEndRef = useRef(null);
  const audioRef = useRef(null);
  const playSongRef = useRef(null);
  const socketRef = useRef(null);
  const tsRef = useRef(null);
  const progressBarRef = useRef(null);
  const isSeekingRef = useRef(false);
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({});
  const [bufferProgress, setBufferProgress] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Guard ref to avoid re-emitting socket events we just received
  const isRemoteUpdate = useRef(false);
  // True when the browser refused to autoplay (no user gesture yet on this tab)
  const autoplayBlockedRef = useRef(false);
  // The pending "canplay" listener of the last load, so rapid song changes don't stack listeners
  const pendingCanPlayRef = useRef(null);
  const rateResetTimeoutRef = useRef(null);

  // Current time on the *server's* clock (timesync offset), used for latency maths.
  const serverNow = useCallback(
    () => (tsRef.current && typeof tsRef.current.now === 'function' ? tsRef.current.now() : Date.now()),
    []
  );

  // Seconds elapsed since the server stamped an event
  const secondsSince = useCallback(
    (serverTimestamp) => (serverTimestamp ? Math.max(0, (serverNow() - serverTimestamp) / 1000) : 0),
    [serverNow]
  );

  // ───────────────────────────────────────────────
  // Audio helpers — single imperative Audio element
  // ───────────────────────────────────────────────

  const safePlay = useCallback((audio) => {
    const result = audio.play();
    if (result && typeof result.then === 'function') {
      result
        .then(() => {
          autoplayBlockedRef.current = false;
        })
        .catch((err) => {
          if (err.name === 'AbortError') return; // interrupted by a newer load/pause: harmless
          console.warn('Playback failed:', err.message);
          setIsPlaying(false);
          if (err.name === 'NotAllowedError') {
            autoplayBlockedRef.current = true;
            setPlaybackError('Your browser blocked autoplay. Press Play to join the music in sync.');
          } else {
            setPlaybackError('Could not play this song. The file may be missing or unsupported.');
          }
        });
    }
  }, []);

  // Load a URL into the audio element, seek to startTime, optionally auto-play.
  // startTime may be a function so the position is computed when the audio is actually ready.
  const loadAndPlay = useCallback((url, startTime = 0, autoPlay = true) => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    const resolvedUrl = new URL(url, window.location.href).href;
    const needsLoad = (audio.currentSrc || audio.src || '') !== resolvedUrl;

    const applySeekAndPlay = () => {
      const target = typeof startTime === 'function' ? startTime() : startTime;
      if (Number.isFinite(target)) {
        const max = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : Infinity;
        audio.currentTime = Math.min(Math.max(0, target), max);
      }
      if (autoPlay) {
        safePlay(audio);
      } else if (!audio.paused) {
        audio.pause();
      }
    };

    if (pendingCanPlayRef.current) {
      audio.removeEventListener('canplay', pendingCanPlayRef.current);
      pendingCanPlayRef.current = null;
    }

    if (needsLoad) {
      audio.pause();
      audio.src = resolvedUrl;
      audio.load();
      setIsBuffering(true);
      const onCanPlay = () => {
        audio.removeEventListener('canplay', onCanPlay);
        pendingCanPlayRef.current = null;
        setIsBuffering(false);
        applySeekAndPlay();
      };
      pendingCanPlayRef.current = onCanPlay;
      audio.addEventListener('canplay', onCanPlay);
    } else {
      applySeekAndPlay();
    }
  }, [safePlay]);

  // Correct drift: hard-seek when far off, gently nudge playback speed when slightly off.
  const correctDrift = useCallback((audio, targetTime) => {
    if (!audio || audio.paused || !Number.isFinite(targetTime)) return;
    const diff = targetTime - audio.currentTime; // > 0 means we're behind
    clearTimeout(rateResetTimeoutRef.current);

    if (Math.abs(diff) > DRIFT_THRESHOLD) {
      audio.playbackRate = 1;
      audio.currentTime = targetTime;
    } else if (Math.abs(diff) > 0.08) {
      audio.playbackRate = diff > 0 ? 1.05 : 0.95;
      // 5% speed change closes the gap in |diff| / 0.05 seconds
      rateResetTimeoutRef.current = setTimeout(() => {
        audio.playbackRate = 1;
      }, Math.min((Math.abs(diff) / 0.05) * 1000, 2500));
    } else {
      audio.playbackRate = 1;
    }
  }, []);

  // ───────────────────────────────────────────────
  // Simple handlers (session name, polls, etc.)
  // ───────────────────────────────────────────────

  const handleSessionCreated = (data) => {
    console.log('Session created:', data);
    setSessionName(data.sessionName);
  };

  const handleSessionNameUpdated = (data) => {
    setSessionName(data.sessionName);
  };

  const handleSongAdded = (newSong) => {
    setSongs((prev) => [...prev, newSong]);
  };

  const handleSongRemoved = (removedSong) => {
    setSongs((prev) => prev.filter((song) => song.name !== removedSong.name));
  };

  // ───────────────────────────────────────────────
  // Playlist controls: next / previous / play-pause / seek
  // ───────────────────────────────────────────────

  const handleNextSong = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (songs.length === 0) return;

    const currentIndex = songs.findIndex(
      (song) => currentSong && song.name === currentSong.name
    );

    let nextIndex;
    if (currentIndex === -1 || currentIndex === songs.length - 1) {
      nextIndex = 0;
    } else {
      nextIndex = currentIndex + 1;
    }

    const nextSong = songs[nextIndex];
    const url = getSongUrl(nextSong);

    setCurrentSong(nextSong);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError('');
    setIsPlaying(true);

    loadAndPlay(url, 0, true);

    socketRef.current?.emit('next-song', {
      sessionId,
      song: nextSong,
      timestamp: Date.now(),
    });
  }, [songs, currentSong, sessionId, loadAndPlay]);

  const handlePreviousSong = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (songs.length === 0) return;

    // Like most players: if we're more than 3s in, "previous" restarts the current song
    const audio = audioRef.current;
    if (currentSong && audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      socketRef.current?.emit('seek', {
        sessionId,
        currentTime: 0,
        isPlaying: !audio.paused,
      });
      return;
    }

    const currentIndex = songs.findIndex(
      (song) => currentSong && song.name === currentSong.name
    );

    let prevIndex;
    if (currentIndex === -1 || currentIndex === 0) {
      prevIndex = songs.length - 1;
    } else {
      prevIndex = currentIndex - 1;
    }

    const prevSong = songs[prevIndex];
    const url = getSongUrl(prevSong);

    setCurrentSong(prevSong);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError('');
    setIsPlaying(true);

    loadAndPlay(url, 0, true);

    socketRef.current?.emit('previous-song', {
      sessionId,
      song: prevSong,
      timestamp: Date.now(),
    });
  }, [songs, currentSong, sessionId, loadAndPlay]);

  const handlePlayPause = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const audio = audioRef.current;
    if (!audio) return;

    // Nothing selected yet: start the playlist from the first song
    if (!currentSong) {
      if (songs.length > 0) playSongRef.current?.(songs[0]);
      return;
    }

    setPlaybackError('');
    const url = getSongUrl(currentSong);

    // Autoplay was blocked while the group was already playing: just join in,
    // at the server's position, without changing anyone else's playback.
    if (autoplayBlockedRef.current && audio.paused) {
      autoplayBlockedRef.current = false;
      if (!audio.currentSrc && url) {
        loadAndPlay(url, currentTime, true);
      } else {
        safePlay(audio);
      }
      socketRef.current?.emit('request-sync', { sessionId, clientTime: Date.now() });
      return;
    }

    const shouldPlay = audio.paused;

    if (shouldPlay) {
      if (!audio.currentSrc && url) {
        loadAndPlay(url, currentTime, true);
      } else {
        safePlay(audio);
      }
    } else {
      audio.pause();
    }

    socketRef.current?.emit('play-pause', {
      sessionId,
      isPlaying: shouldPlay,
      currentTime: audio.currentTime,
    });
  }, [currentSong, songs, sessionId, currentTime, loadAndPlay, safePlay]);

  const handleSeek = useCallback(
    (e) => {
      const audio = audioRef.current;
      if (!audio || !progressBarRef.current || !Number.isFinite(duration) || duration <= 0) return;

      const rect = progressBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const percentage = Math.max(0, Math.min(1, x / width));
      const newTime = percentage * duration;

      isSeekingRef.current = true;

      audio.currentTime = newTime;
      setCurrentTime(newTime);

      // Debounce the seek socket event
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      seekTimeoutRef.current = setTimeout(() => {
        isSeekingRef.current = false;
        socketRef.current?.emit('seek', {
          sessionId,
          currentTime: newTime,
          timestamp: Date.now(),
          isPlaying: isPlaying,
        });
      }, 300);
    },
    [sessionId, duration, isPlaying]
  );

  // ───────────────────────────────────────────────
  // Socket event handlers for remote playback updates
  // ───────────────────────────────────────────────

  // Apply an authoritative playback state coming from the server/another user.
  // `stampedAt` is the server time the state refers to; position is extrapolated from it.
  const applyRemoteState = useCallback(({ song, currentTime: remoteTime = 0, isPlaying: remotePlaying, stampedAt }) => {
    const audio = audioRef.current;
    if (!audio) return;
    isRemoteUpdate.current = true;

    // Explicit null song = playback was cleared (e.g. current song removed)
    if (song === null) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setCurrentSong(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      isRemoteUpdate.current = false;
      return;
    }

    const expectedAt = () => (remoteTime || 0) + (remotePlaying ? secondsSince(stampedAt) : 0);
    const url = getSongUrl(song);
    if (song) setCurrentSong(song);
    setIsPlaying(Boolean(remotePlaying));
    setPlaybackError('');

    const resolvedNext = url ? new URL(url, window.location.href).href : null;
    const loadedSrc = audio.currentSrc || audio.src || '';

    if (resolvedNext && loadedSrc !== resolvedNext) {
      // Different song: load it and seek once it's ready (accounts for load time)
      if (song) {
        setDuration(0);
      }
      loadAndPlay(url, expectedAt, Boolean(remotePlaying));
    } else if (loadedSrc) {
      if (remotePlaying) {
        if (audio.paused) {
          audio.currentTime = Math.max(0, expectedAt());
          safePlay(audio);
        } else {
          correctDrift(audio, expectedAt());
        }
      } else {
        if (!audio.paused) audio.pause();
        if (Math.abs(audio.currentTime - remoteTime) > 0.25) audio.currentTime = Math.max(0, remoteTime);
      }
    }
    setCurrentTime(expectedAt());
    isRemoteUpdate.current = false;
  }, [loadAndPlay, safePlay, correctDrift, secondsSince]);

  const handleSongUpdate = useCallback((data) => {
    applyRemoteState({
      song: data.song,
      currentTime: data.currentTime,
      isPlaying: data.isPlaying,
      stampedAt: data.serverTime || data.timestamp,
    });
  }, [applyRemoteState]);

  const handleTrackChangeEvent = useCallback((data) => {
    if (!data.song) return;
    applyRemoteState({
      song: data.song,
      currentTime: data.currentTime || 0,
      isPlaying: data.isPlaying !== false,
      stampedAt: data.serverTime || data.timestamp,
    });
  }, [applyRemoteState]);

  const handleNextSongEvent = handleTrackChangeEvent;
  const handlePreviousSongEvent = handleTrackChangeEvent;

  const handleSyncPlayback = useCallback((data) => {
    if (!data.song) return;
    applyRemoteState({
      song: data.song,
      currentTime: data.currentTime,
      isPlaying: data.isPlaying,
      stampedAt: data.serverTime,
    });
  }, [applyRemoteState]);

  // Periodic drift check answer from the server
  const handleSyncResponse = useCallback((data) => {
    const audio = audioRef.current;
    if (!audio || autoplayBlockedRef.current) return;

    const expected = (data.currentTime || 0) + (data.isPlaying ? secondsSince(data.serverTime) : 0);

    if (data.song && getSongUrl(data.song)) {
      const url = new URL(getSongUrl(data.song), window.location.href).href;
      if ((audio.currentSrc || audio.src) !== url) {
        handleSyncPlayback(data);
        return;
      }
    }

    if (data.isPlaying) {
      if (audio.paused) {
        audio.currentTime = Math.max(0, expected);
        safePlay(audio);
      } else {
        correctDrift(audio, expected);
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [secondsSince, safePlay, correctDrift, handleSyncPlayback]);

  const handlePollVote = (data) => {
    const { pollId, optionIndex, updatedOption } = data;
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.type === 'poll' && msg.poll.id === pollId) {
          const updatedPoll = { ...msg.poll };
          updatedPoll.options[optionIndex] = updatedOption;
          return { ...msg, poll: updatedPoll };
        }
        return msg;
      })
    );
  };

  const handlePreparePlayback = useCallback((data) => {
    setIsReady(false);
    if (audioRef.current) {
      audioRef.current.currentTime = data.currentTime;
      setCurrentTime(data.currentTime);
    }
    socketRef.current?.emit('player-ready', {
      sessionId,
      userId: user._id,
      timestamp: tsRef.current ? tsRef.current.now() : Date.now(),
    });
  }, [sessionId, user]);

  const handleStartSyncPlayback = useCallback((data) => {
    const audio = audioRef.current;
    if (audio) {
      const now = tsRef.current ? tsRef.current.now() : Date.now();
      const timeUntilStart = data.timestamp - now;

      audio.currentTime = data.currentTime;
      setCurrentTime(data.currentTime);

      if (timeUntilStart > 0) {
        setTimeout(() => {
          if (data.isPlaying) {
            audio.play().catch(console.error);
            setIsPlaying(true);
          } else {
            audio.pause();
            setIsPlaying(false);
          }
        }, timeUntilStart);
      }
    }
    setCountdownTime(null);
    setIsReady(true);
  }, []);

  const handleShareClick = () => {
    // Clean invite link (no ?name=… creation parameter)
    const sessionUrl = `${window.location.origin}/session/${encodeURIComponent(sessionId)}`;
    const done = () => {
      setShowCopyMessage(true);
      setTimeout(() => setShowCopyMessage(false), 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(sessionUrl).then(done).catch(() => window.prompt('Copy this invite link:', sessionUrl));
    } else {
      // Clipboard API is unavailable over plain http on a LAN IP
      window.prompt('Copy this invite link:', sessionUrl);
    }
  };

  // ───────────────────────────────────────────────
  // Main effect: socket connection + audio element setup
  // ───────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    // Create socket connection
    socketRef.current = io(API_URL, { auth: { token: getToken() } });
    const socket = socketRef.current;

    socket.on('session-not-found', () => {
      alert('Session not found. Please check the session ID and try again.');
      navigate('/home');
    });

    socket.on('server-error', (data) => {
      console.error('Server error:', data);
    });

    // (Re)join the session on every connect. socket.io gives a new socket id after a
    // reconnect (server restart, network drop, laptop sleep); without re-joining, the
    // server would ignore every play/pause/skip from this tab.
    socket.on('connect', () => {
      socket.emit('join-session', {
        sessionId,
        sessionName: searchParams.get('name'),
      });

      // Clock sync (JSON-RPC over HTTP against the backend's /timesync endpoint)
      if (tsRef.current) return;
      try {
        tsRef.current = timesync.create({
          server: `${API_URL}/timesync`,
          interval: 10000,
        });
      } catch (error) {
        console.error('Error creating timesync:', error);
        tsRef.current = {
          now: () => Date.now(),
          destroy: () => { }
        };
      }
    });

    // Set up event handlers
    const handlers = {
      'participant-count': (count) => {
        setParticipantCount(count);
      },
      'session-name-updated': (data) => {
        handleSessionNameUpdated(data);
      },
      'session-state': (data) => {
        console.log('Received session state:', data);
        setSongs(data.songs);
        setSessionName(data.sessionName);
        setParticipantCount(data.participantCount);
        setParticipants(data.participants || []);
        setMessages(buildChatHistory(data.messages, data.polls));
        if (data.currentSong && getSongUrl(data.currentSong)) {
          applyRemoteState({
            song: data.currentSong,
            currentTime: data.currentTime,
            isPlaying: data.isPlaying,
            stampedAt: data.serverTime,
          });
        }
      },
      'song-update': (data) => handleSongUpdate(data),
      'poll-vote': handlePollVote,
      'songs-updated': (newSongs) => setSongs(newSongs),
      'chat-message': (message) => {
        if (message.sender !== user._id) {
          setMessages((prev) => [...prev, { ...message, isSelf: false }]);
        }
      },
      'new-poll': (pollMessage) => {
        const isSelf = pollMessage.sender === user._id;
        setMessages((prev) => [...prev, { ...pollMessage, isSelf }]);
      },
      'poll-deleted': ({ pollId }) => {
        setMessages((prev) =>
          prev.filter((msg) => msg.type !== 'poll' || msg.poll.id !== pollId)
        );
      },
      'session-created': handleSessionCreated,
      'user-joined': (data) => {
        if (data.participantCount !== undefined) {
          setParticipantCount(data.participantCount);
        }
        if (data.username) {
          setParticipants(prev => [
            ...prev.filter((p) => p.id !== data.userId),
            {
              id: data.userId,
              name: data.username,
              isCurrentUser: data.userId === user._id
            }
          ]);
        }
      },
      'user-left': (data) => {
        if (data.participantCount !== undefined) {
          setParticipantCount(data.participantCount);
        }
        if (data.userId) {
          setParticipants(prev => prev.filter(p => p.id !== data.userId));
        }
      },
      'next-song': (data) => handleNextSongEvent(data),
      'previous-song': (data) => handlePreviousSongEvent(data),
      'volume-change': (volumeData) => {
        if (audioRef.current) {
          audioRef.current.volume = volumeData.volume;
        }
      },
      'song-added': handleSongAdded,
      'song-removed': handleSongRemoved,
      'sync-playback': (data) => handleSyncPlayback(data),
      'sync-response': (data) => handleSyncResponse(data),
      'prepare-playback': (data) => handlePreparePlayback(data),
      'ready-state-update': (data) => {
        setReadyCount(data.readyCount);
        setTotalCount(data.totalCount);
      },
      'sync-countdown': (data) => setCountdownTime(data.startTime),
      'start-sync-playback': (data) => handleStartSyncPlayback(data),
      'connect_error': (err) => {
        console.error('Connection error:', err);
        if (err?.message?.startsWith('Not authorized')) {
          alert('Your session has expired. Please sign in again.');
          navigate('/auth/login?error=session_expired');
          return;
        }
        // Network errors: socket.io keeps retrying automatically, so only warn once
        if (!socket.__warned) {
          socket.__warned = true;
          alert('Failed to connect to the server. Retrying...');
        }
      }
    };

    // Register all event handlers
    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    // Cleanup function
    return () => {
      Object.keys(handlers).forEach(event => {
        socket.off(event);
      });
      socket.disconnect();
      if (tsRef.current && typeof tsRef.current.destroy === 'function') {
        tsRef.current.destroy();
      }
      tsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user, searchParams, navigate]);

  // ───────────────────────────────────────────────
  // Audio event listeners — mounted once via ref
  // ───────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const onDurationChange = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      setPlaybackError('');
    };

    const onPause = () => {
      // Only update state if it wasn't triggered by our own loadAndPlay
      setIsPlaying(false);
    };

    const onEnded = () => {
      // handled by the ended effect below
    };

    const onError = () => {
      const code = audio.error?.code;
      console.error('Audio error code:', code, 'src:', audio.src);
      if (audio.src && audio.src !== window.location.href) {
        setPlaybackError('Audio failed to load. The file may be missing or in an unsupported format.');
        setIsPlaying(false);
      }
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onProgress = () => {
      if (audio.buffered.length > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        setBufferProgress(bufferedEnd / audio.duration);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('progress', onProgress);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('progress', onProgress);
    };
  }, []); // Run once — audio ref is stable

  // ───────────────────────────────────────────────
  // Song ended → advance playlist or repeat
  // ───────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      const idx = songs.findIndex((s) => currentSong && s.name === currentSong.name);

      if (idx !== -1 && idx < songs.length - 1) {
        handleNextSong();
      } else {
        setIsPlaying(false);
        setCurrentTime(0);
        socketRef.current?.emit('play-pause', {
          sessionId,
          isPlaying: false,
          currentTime: 0,
          timestamp: Date.now(),
        });
      }
    };

    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [currentSong, songs, handleNextSong, sessionId]);

  // ───────────────────────────────────────────────
  // Periodic sync check
  // ───────────────────────────────────────────────

  useEffect(() => {
    if (isPlaying && currentSong) {
      const interval = setInterval(() => {
        if (audioRef.current && socketRef.current) {
          socketRef.current.emit('sync-check', {
            sessionId,
            currentTime: audioRef.current.currentTime,
            clientTime: Date.now(),
            bufferProgress,
            isBuffering,
          });
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isPlaying, currentSong, sessionId, bufferProgress, isBuffering]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ───────────────────────────────────────────────
  // File upload
  // ───────────────────────────────────────────────

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newSongs = [];
    const supportedFormats = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'flac'];

    for (const file of files) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (!supportedFormats.includes(fileExtension)) {
        alert(
          `File "${file.name}" is not a supported audio format.\nSupported formats: ${supportedFormats.join(', ')}`
        );
        continue;
      }

      const formData = new FormData();
      formData.append('song', file);
      formData.append('sessionId', sessionId);
      formData.append('title', file.name);

      try {
        setUploadStatus(prev => ({
          ...prev,
          [file.name]: {
            status: 'uploading',
            message: `${file.name} is being uploaded by ${user.name}...`
          }
        }));

        const response = await fetch(`${API_URL}/api/songs/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const update = JSON.parse(line.trim());

                  setUploadStatus(prev => ({
                    ...prev,
                    [file.name]: {
                      status: update.status,
                      message: update.message
                    }
                  }));

                  if (update.status === 'complete' && update.song) {
                    newSongs.push({
                      _id: update.song._id,
                      name: update.song.title,
                      url: update.song.url,
                    });
                  }
                } catch (e) {
                  console.error('Error parsing chunk:', e, 'Line:', line);
                }
              }
            }
          }
        } catch (e) {
          console.error('Error reading response stream:', e);
          throw e;
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        console.error('Error uploading file:', error);
        setUploadStatus(prev => ({
          ...prev,
          [file.name]: {
            status: 'error',
            message: `Failed to upload "${file.name}" by ${user.name}: ${error.message}`
          }
        }));
        setTimeout(() => {
          setUploadStatus(prev => {
            const newStatus = { ...prev };
            if (newStatus[file.name] && newStatus[file.name].status === 'error') {
              delete newStatus[file.name];
            }
            return newStatus;
          });
        }, 3000);
      }
    }

    if (newSongs.length > 0) {
      socketRef.current?.emit('upload-songs', {
        sessionId,
        songs: newSongs,
      });
    }

    setTimeout(() => {
      setUploadStatus(prev => {
        const newStatus = { ...prev };
        Object.keys(newStatus).forEach(fileName => {
          if (newStatus[fileName].status === 'complete') {
            delete newStatus[fileName];
          }
        });
        return newStatus;
      });
    }, 5000);
  };

  // ───────────────────────────────────────────────
  // playSong: select & play a song from playlist
  // ───────────────────────────────────────────────

  const playSong = useCallback((song) => {
    if (!audioRef.current) return;

    autoplayBlockedRef.current = false;
    setPlaybackError('');

    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);

    const streamingUrl = getSongUrl(song);
    if (!streamingUrl) {
      console.error('Cannot play song without a streaming URL:', song);
      setIsPlaying(false);
      setPlaybackError('No audio URL available for this song.');
      return;
    }

    // Restart from 0 even if the same song is already loaded
    if (audioRef.current.currentSrc === new URL(streamingUrl, window.location.href).href) {
      audioRef.current.currentTime = 0;
    }
    loadAndPlay(streamingUrl, 0, true);

    socketRef.current?.emit('play-song', {
      sessionId,
      song,
      currentTime: 0,
      isPlaying: true,
    });
  }, [sessionId, loadAndPlay]);

  playSongRef.current = playSong;

  // ───────────────────────────────────────────────
  // Utility functions
  // ───────────────────────────────────────────────

  const formatTime = (time) => {
    if (!Number.isFinite(time) || time < 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleRemoveSong = (songName) => {
    socketRef.current?.emit('remove-song', {
      sessionId,
      songName,
    });
  };

  const handleMoveSong = (index, direction) => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === songs.length - 1)
    ) {
      return;
    }

    const newSongs = [...songs];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [newSongs[index], newSongs[newIndex]] = [newSongs[newIndex], newSongs[index]];

    setSongs(newSongs);

    socketRef.current?.emit('reorder-songs', {
      sessionId,
      songs: newSongs,
    });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() && socketRef.current) {
      const message = {
        text: newMessage.trim(),
        timestamp: new Date().toISOString(),
        sender: user._id,
        senderName: user.name,
        isSelf: true,
      };
      socketRef.current.emit('chat-message', {
        sessionId,
        message: { ...message, isSelf: false },
      });
      setMessages((prev) => [...prev, message]);
      setNewMessage('');
    }
  };

  const handleCreatePoll = (e) => {
    e.preventDefault();
    if (pollQuestion.trim() && pollOptions.every((opt) => opt.trim())) {
      const newPoll = {
        id: Date.now(),
        question: pollQuestion.trim(),
        options: pollOptions
          .filter((opt) => opt.trim())
          .map((option) => ({
            text: option,
            votes: 0,
            voters: [],
          })),
        creator: user._id,
        creatorName: user.name,
        timestamp: new Date().toISOString(),
      };

      socketRef.current?.emit('new-poll', {
        sessionId,
        poll: newPoll,
      });

      setShowPollCreator(false);
      setPollQuestion('');
      setPollOptions(['', '']);
    }
  };

  const handleVote = (pollId, optionIndex) => {
    const poll = messages.find(
      (msg) => msg.type === 'poll' && msg.poll.id === pollId
    )?.poll;
    if (!poll) return;

    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.type === 'poll' && msg.poll.id === pollId) {
          const updatedPoll = { ...msg.poll };
          const option = updatedPoll.options[optionIndex];

          if (option.voters.includes(user._id)) {
            option.voters = option.voters.filter((voter) => voter !== user._id);
          } else {
            option.voters.push(user._id);
          }
          option.votes = option.voters.length;

          return { ...msg, poll: updatedPoll };
        }
        return msg;
      })
    );

    socketRef.current?.emit('poll-vote', {
      sessionId,
      pollId,
      optionIndex,
      voter: user._id,
    });
  };

  const handleDeletePoll = (pollId) => {
    socketRef.current?.emit('delete-poll', {
      sessionId,
      pollId,
    });
  };

  const renderMessage = (message, index) => {
    if (message.type === 'poll') {
      const totalVotes = message.poll.options.reduce(
        (sum, opt) => sum + opt.votes,
        0
      );
      const isCreator = message.poll.creator === user._id;
      return (
        <div
          key={index}
          className={`message poll ${message.isSelf ? 'self' : 'other'}`}
        >
          <div className="poll-header">
            <div className="message-sender">
              {message.poll.creatorName || 'Unknown User'}
            </div>
            {isCreator && (
              <button
                className="close-modal-btn"
                onClick={() => handleDeletePoll(message.poll.id)}
                title="Delete poll"
              >
                ×
              </button>
            )}
          </div>
          <div className="poll-question">{message.poll.question}</div>
          <div className="poll-options">
            {message.poll.options.map((option, optIndex) => {
              const percentage =
                totalVotes > 0 ? (option.votes / totalVotes) * 100 : 0;
              const hasVoted = option.voters.includes(user._id);
              return (
                <button
                  key={optIndex}
                  className={`poll-option ${hasVoted ? 'voted' : ''}`}
                  onClick={() => handleVote(message.poll.id, optIndex)}
                >
                  <div className="poll-option-text">
                    {option.text}
                    {hasVoted && <span className="vote-indicator">✓</span>}
                  </div>
                  <div className="poll-option-stats">
                    <div
                      className="poll-option-bar"
                      style={{ width: `${percentage}%` }}
                    />
                    <span className="poll-option-percentage">
                      {Math.round(percentage)}%
                    </span>
                    <span className="poll-option-votes">
                      ({option.votes} vote{option.votes !== 1 ? 's' : ''})
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="poll-footer">
            <span className="total-votes">Total votes: {totalVotes}</span>
            {message.poll.options.some((opt) =>
              opt.voters.includes(user._id)
            ) && (
                <span className="your-votes">
                  Your votes:{' '}
                  {
                    message.poll.options.filter((opt) =>
                      opt.voters.includes(user._id)
                    ).length
                  }
                </span>
              )}
          </div>
        </div>
      );
    }

    return (
      <div
        key={index}
        className={`message ${message.sender === user._id ? 'self' : 'other'}`}
      >
        {message.sender !== user._id && (
          <div className="message-sender">
            {message.senderName || 'Unknown User'}
          </div>
        )}
        <div className="message-text">{message.text}</div>
        <div className="message-time">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    );
  };

  const handleLeaveSession = () => {
    if (socketRef.current && sessionId) {
      socketRef.current.emit('user-leave-session', {
        sessionId,
        userId: user._id,
      });

      // Stop audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }

      setSongs([]);
      setCurrentSong(null);
      setCurrentTime(0);
      setIsPlaying(false);
      setParticipantCount(0);
      setSessionName('');
      setMessages([]);
      navigate('/home');
    }
  };

  const requestSyncPlayback = useCallback(() => {
    if (audioRef.current && currentSong) {
      setIsSyncing(true);
      socketRef.current?.emit('sync-playback', {
        sessionId,
        currentTime: audioRef.current.currentTime,
        isPlaying: isPlaying,
        song: currentSong,
        clientTime: Date.now(),
      });
      setTimeout(() => setIsSyncing(false), 1000);
    }
  }, [sessionId, isPlaying, currentSong]);

  // ───────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────

  return (
    <div className="session-page">
      <div className="session-container">
        <div className="session-header">
          <div>
            <h2>Session Name: {sessionName}</h2>
            <div className="session-info">
              <button onClick={handleShareClick} className="share-button" title="Share session link">
                <FontAwesomeIcon icon={faShare} />
              </button>
              {showCopyMessage && <span className="copy-message">Session link copied to clipboard</span>}
              <p>Session ID: {sessionId}</p>
            </div>
          </div>
          <div className="syncwave-logo">
          <div className="logo">
              <img src="/logo.png" alt="App Logo" className="logo-icon" style={{ height: '60px', width: '60px', borderRadius: '50%' }} />
            </div>
            <span className="logo-text">SyncWave</span>
          </div>
          <button
            onClick={handleLeaveSession}
            className="leave-session-button"
          >
            Leave Session
          </button>
        </div>

        <div className="chat-container">
          <div className="chat-header">
            <h2>Chat</h2>
            <div className="participant-count" onClick={() => setShowParticipants(!showParticipants)}>
              <span className="participant-label">Participants</span>
              <span className="participant-icon">👥</span>
              <span>{participantCount}</span>
              {showParticipants && (
                <div className="participant-dropdown">
                  <ul className="participant-list">
                    {participants.map((participant) => (
                      <li key={participant.id} className="participant-item">
                        {participant.name}{participant.isCurrentUser ? " (You)" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {showPollCreator && (
            <div className="modal-overlay">
              <div className="poll-creator-modal">
                <div className="poll-creator-header">
                  <h3>Create a Poll</h3>
                  <button
                    className="close-modal-btn"
                    onClick={() => {
                      setShowPollCreator(false);
                      setPollQuestion('');
                      setPollOptions(['', '']);
                    }}
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={handleCreatePoll} className="poll-creator">
                  <input
                    type="text"
                    placeholder="Enter your question"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    className="poll-question-input"
                    autoFocus
                  />
                  {pollOptions.map((option, index) => (
                    <div key={index} className="poll-option-input">
                      <input
                        type="text"
                        placeholder={`Option ${index + 1}`}
                        value={option}
                        onChange={(e) => {
                          const newOptions = [...pollOptions];
                          newOptions[index] = e.target.value;
                          setPollOptions(newOptions);
                        }}
                      />
                      {index >= 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPollOptions(
                              pollOptions.filter((_, i) => i !== index)
                            )
                          }
                          className="close-modal-btn"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="poll-creator-actions">
                    {pollOptions.length < 5 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions([...pollOptions, ''])}
                        className="add-option-btn"
                      >
                        Add Option
                      </button>
                    )}
                    <button type="submit" className="create-poll-submit">
                      Create Poll
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="messages-container">
            {messages.map((message, index) => renderMessage(message, index))}
            <div ref={messagesEndRef} />
          </div>

          <div className="message-input">
            <button
              className="create-poll-btn"
              onClick={() => setShowPollCreator(true)}
              title="Create Poll"
            >
              <FontAwesomeIcon icon={faPoll} />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage(e)}
              placeholder="Type a message..."
              className="message-input-field"
            />
            <button
              className="send-button"
              onClick={handleSendMessage}
              title="Send Message"
            >
              <FontAwesomeIcon icon={faPaperPlane} />
            </button>
          </div>
        </div>

        <div className="song-list">
          <h2>Playlist</h2>
          <ul>
            {songs.map((song, index) => (
              <li
                key={index}
                className={`song-item ${currentSong && currentSong.name === song.name ? 'playing' : ''
                  }`}
              >
                <div className="song-item-content">
                  <button
                    className="song-name-btn"
                    onClick={() => playSong(song)}
                  >
                    {song.name}
                  </button>
                  <div className="song-controls">
                    <button
                      className="move-btn up-btn"
                      onClick={(e) => { e.stopPropagation(); handleMoveSong(index, 'up'); }}
                      disabled={index === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="move-btn down-btn"
                      onClick={(e) => { e.stopPropagation(); handleMoveSong(index, 'down'); }}
                      disabled={index === songs.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="remove-btn"
                      onClick={(e) => { e.stopPropagation(); handleRemoveSong(song.name); }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {uploadStatus[song.name] && (
                  <div className={`upload-status ${uploadStatus[song.name].status}`}>
                    {uploadStatus[song.name].message}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {/* Show any active upload statuses for files not yet in songs list */}
          {Object.entries(uploadStatus).map(([filename, status]) =>
            !songs.find(song => song.name === filename) && (
              <div key={filename} className={`upload-status ${status.status}`}>
                {status.message}
              </div>
            )
          )}
          <div className="file-upload">
            <label htmlFor="audio-upload">
              <i className="fas fa-upload"></i> Upload Audio Files
            </label>
            <input
              id="audio-upload"
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileUpload}
            />
          </div>
        </div>

        <div className="song-playing-section">
          <div className={`player-circle ${isPlaying ? 'playing' : ''}`}>
            {/* Pulsating waves */}
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>

            <div className="player-content">
              {/* Existing content */}
            </div>
          </div>

          <div className="player-controls-wrapper">
            <div className="current-song-title">
              {currentSong ? currentSong.name : 'No song playing'}
              {isBuffering && <span className="buffering-indicator">Buffering...</span>}
            </div>
            {playbackError && (
              <div className="playback-error" role="alert">
                {playbackError}
              </div>
            )}

            <div className="buffer-progress">
              <div
                className="buffer-bar"
                style={{ width: `${bufferProgress * 100}%` }}
              />
            </div>

            <div
              className="progress-container"
              onClick={handleSeek}
              onMouseMove={(event) => {
                if (event.buttons === 1 && duration > 0) handleSeek(event);
              }}
              ref={progressBarRef}
            >
              <div
                className="progress-bar"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>

            <div className="time-display">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Audio element: no src in JSX — managed imperatively */}
            <audio ref={audioRef} preload="auto" />

            <div className="player-controls">
              <button
                className="control-btn"
                onClick={handlePreviousSong}
                disabled={songs.length === 0 || !isReady}
                title="Previous"
              >
                <FontAwesomeIcon icon={faBackward} />
              </button>
              <button
                className="play-pause-btn"
                onClick={handlePlayPause}
                disabled={!currentSong && songs.length === 0}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
              </button>
              <button
                className="control-btn"
                onClick={handleNextSong}
                disabled={songs.length === 0 || !isReady}
                title="Next"
              >
                <FontAwesomeIcon icon={faForward} />
              </button>
              <button
                className={`sync-btn ${isSyncing ? 'syncing' : ''}`}
                onClick={requestSyncPlayback}
                disabled={!currentSong}
                title="Sync playback with other participants"
              >
                <FontAwesomeIcon icon={faSync} />
              </button>
            </div>
          </div>
        </div>

        {countdownTime && (
          <div className="sync-overlay">
            <div className="sync-status">
              <div>Synchronizing playback...</div>
              <div>
                Ready: {readyCount}/{totalCount}
              </div>
              <div>
                Starting in{' '}
                {Math.max(
                  0,
                  Math.floor((countdownTime - (tsRef.current?.now() || Date.now())) / 1000)
                )}
                s
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Session;