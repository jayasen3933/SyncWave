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
  faShare
} from '@fortawesome/free-solid-svg-icons';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

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
  const socketRef = useRef(null);
  const tsRef = useRef(null);
  const isLocalUpdate = useRef(false);
  const lastUpdateTimeRef = useRef(0);
  const networkLatencyRef = useRef(0);
  const progressBarRef = useRef(null);
  const isSeekingRef = useRef(false);
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({});

  const handleSessionCreated = (data) => {
    console.log('Session created:', data);
    setSessionName(data.sessionName);
  };

  const handleSessionJoined = (sessionData) => {
    console.log('Session joined:', sessionData);
    setSessionName(sessionData.sessionName);
    setSongs(sessionData.songs || []);
    setCurrentSong(sessionData.currentSong || null);
    setCurrentTime(sessionData.currentTime || 0);
    setIsPlaying(sessionData.isPlaying || false);
    setParticipantCount(sessionData.participantCount || 0);

    if (audioRef.current && sessionData.currentSong) {
      audioRef.current.src = sessionData.currentSong.url;
      audioRef.current.oncanplay = () => {
        const clientTime = Date.now();
        const latency = (clientTime - sessionData.timestamp) / 1000;
        const serverTimeDiff = (clientTime - sessionData.serverTime) / 1000;
        const adjustedTime = sessionData.currentTime + latency + serverTimeDiff;

        if (adjustedTime < audioRef.current.duration) {
          audioRef.current.currentTime = adjustedTime;
        } else {
          audioRef.current.currentTime = 0;
        }

        if (sessionData.isPlaying) {
          audioRef.current.play().catch((error) => {
            console.log('Playback failed:', error);
          });
        } else {
          audioRef.current.pause();
        }

        audioRef.current.oncanplay = null;
      };

      audioRef.current.load();
    }
  };

  const handleSessionNameUpdated = (data) => {
    setSessionName(data.sessionName);
  };

  const handleUserJoined = (userData) => {
    console.log('User joined:', userData);
    setParticipantCount((prev) => prev + 1);
  };

  const handleUserLeft = (userData) => {
    console.log('User left:', userData);
    setParticipantCount((prev) => Math.max(1, prev - 1));
  };

  const handleVolumeChange = (volumeData) => {
    if (audioRef.current) {
      audioRef.current.volume = volumeData.volume;
    }
  };

  const handleSongAdded = (newSong) => {
    setSongs((prev) => [...prev, newSong]);
  };

  const handleSongRemoved = (removedSong) => {
    setSongs((prev) => prev.filter((song) => song.name !== removedSong.name));
  };

  const handleNextSong = useCallback(() => {
    isLocalUpdate.current = true;
    lastUpdateTimeRef.current = Date.now();

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

    setCurrentSong(nextSong);
    setCurrentTime(0);
    setIsPlaying(true);

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.src = nextSong.url;
      audioRef.current.play().catch((error) => {
        console.log('Playback failed:', error);
      });
    }

    socketRef.current.emit('next-song', {
      sessionId,
      song: nextSong,
      timestamp: Date.now(),
    });
  }, [songs, currentSong, sessionId]);

  const handlePreviousSong = useCallback(() => {
    isLocalUpdate.current = true;
    lastUpdateTimeRef.current = Date.now();

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

    setCurrentSong(prevSong);
    setCurrentTime(0);
    setIsPlaying(true);

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.src = prevSong.url;
      audioRef.current.play().catch((error) => {
        console.log('Playback failed:', error);
      });
    }

    socketRef.current.emit('previous-song', {
      sessionId,
      song: prevSong,
      timestamp: Date.now(),
    });
  }, [songs, currentSong, sessionId]);

  const handlePlayPause = useCallback(() => {
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      isLocalUpdate.current = true;
      lastUpdateTimeRef.current = Date.now();

      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(error => {
          console.error('Playback failed:', error);
          setIsPlaying(false);
        });
      }

      setIsPlaying(!isPlaying);
      socketRef.current.emit('play-pause', {
        sessionId,
        isPlaying: !isPlaying,
        currentTime: currentTime,
        timestamp: Date.now()
      });
    }
  }, [sessionId, isPlaying]);

  const handleSeek = useCallback(
    (e) => {
      if (!audioRef.current || !progressBarRef.current) return;

      const rect = progressBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const percentage = x / width;
      const newTime = percentage * duration;

      isLocalUpdate.current = true;
      lastUpdateTimeRef.current = Date.now();

      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);

      if (isPlaying) {
        audioRef.current.play().catch(error => {
          console.error('Playback failed after seek:', error);
          setIsPlaying(false);
        });
      }

      socketRef.current.emit('seek', {
        sessionId,
        currentTime: newTime,
        timestamp: Date.now(),
        isPlaying: isPlaying
      });
    },
    [sessionId, duration, isPlaying]
  );

  const handleSongUpdate = (data) => {
    if (!isLocalUpdate.current) {
      const now = Date.now();
      const latency = now - data.timestamp;
      networkLatencyRef.current = latency;
  
      if (data.timestamp > lastUpdateTimeRef.current) {
        lastUpdateTimeRef.current = data.timestamp;
        setIsPlaying(data.isPlaying);
  
        if (data.song) {
          setCurrentSong(data.song);
        }
  
        if (audioRef.current) {
          // Only update time if drift is significant
          const expectedTime = data.currentTime + latency / 1000;
          if (Math.abs(audioRef.current.currentTime - expectedTime) > 0.2) {
            audioRef.current.currentTime = expectedTime;
          }
          setCurrentTime(expectedTime);
  
          if (data.isPlaying) {
            audioRef.current.play().catch((error) => {
              console.log('Playback failed:', error);
              setIsPlaying(false);
            });
          } else {
            audioRef.current.pause();
          }
        }
      }
    }
    isLocalUpdate.current = false;
  };
  
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
  
  const handleNextSongEvent = (data) => {
    const now = Date.now();
    const latency = now - data.timestamp;
    networkLatencyRef.current = latency;
  
    if (data.timestamp > lastUpdateTimeRef.current || isLocalUpdate.current) {
      lastUpdateTimeRef.current = data.timestamp;
  
      setCurrentSong(data.song);
      setCurrentTime(0);
      setIsPlaying(true);
  
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.src = data.song.url;
        audioRef.current.play().catch((error) => {
          console.log('Playback failed:', error);
        });
      }
    }
    isLocalUpdate.current = false;
  };
  
  const handlePreviousSongEvent = (data) => {
    const now = Date.now();
    const latency = now - data.timestamp;
    networkLatencyRef.current = latency;
  
    if (data.timestamp > lastUpdateTimeRef.current || isLocalUpdate.current) {
      lastUpdateTimeRef.current = data.timestamp;
  
      setCurrentSong(data.song);
      setCurrentTime(0);
      setIsPlaying(true);
  
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.src = data.song.url;
        audioRef.current.play().catch((error) => {
          console.log('Playback failed:', error);
        });
      }
    }
    isLocalUpdate.current = false;
  };
  
  const handleSyncPlayback = (data) => {
    if (audioRef.current) {
      const clientTime = Date.now();
      const latency = (clientTime - data.clientTime) / 1000;
      const serverTimeDiff = (clientTime - data.serverTime) / 1000;
      const adjustedTime = data.currentTime + latency + serverTimeDiff;
  
      audioRef.current.pause();
  
      if (adjustedTime < audioRef.current.duration) {
        audioRef.current.currentTime = adjustedTime;
      } else {
        audioRef.current.currentTime = 0;
      }
  
      if (data.isPlaying) {
        socketRef.current.emit('request-sync', {
          sessionId,
          syncId: data.syncId,
          clientTime: Date.now(),
        });
  
        setTimeout(() => {
          audioRef.current.play().catch((error) => {
            console.log('Playback failed:', error);
          });
        }, 20);
      }
    }
  };
  
  const handleSyncResponse = (data) => {
    if (audioRef.current) {
      const clientTime = Date.now();
      const latency = (clientTime - data.clientTime) / 1000;
      const serverTimeDiff = (clientTime - data.serverTime) / 1000;
      const adjustedTime = data.currentTime + latency + serverTimeDiff;
  
      if (adjustedTime < audioRef.current.duration) {
        audioRef.current.currentTime = adjustedTime;
      }
    }
  };
  
  const handlePreparePlayback = (data) => {
    setIsReady(false);
    if (audioRef.current) {
      audioRef.current.currentTime = data.currentTime;
      setCurrentTime(data.currentTime);
    }
    socketRef.current.emit('player-ready', {
      sessionId,
      userId: user._id,
      timestamp: tsRef.current.now(),
    });
  };
  
  const handleStartSyncPlayback = (data) => {
    if (audioRef.current) {
      const now = tsRef.current.now();
      const timeUntilStart = data.timestamp - now;
  
      audioRef.current.currentTime = data.currentTime;
      setCurrentTime(data.currentTime);
  
      if (timeUntilStart > 0) {
        setTimeout(() => {
          if (data.isPlaying) {
            audioRef.current.play().catch(console.error);
            setIsPlaying(true);
          } else {
            audioRef.current.pause();
            setIsPlaying(false);
          }
        }, timeUntilStart);
      }
    }
    setCountdownTime(null);
    setIsReady(true);
  };

  const handleShareClick = () => {
    const sessionUrl = window.location.href;
    navigator.clipboard.writeText(sessionUrl).then(() => {
      setShowCopyMessage(true);
      setTimeout(() => setShowCopyMessage(false), 1000); // Changed to 1 second
    });
  };

  useEffect(() => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    // Create socket connection
    socketRef.current = io(API_URL);
    const socket = socketRef.current;

    socket.on('session-not-found', () => {
      alert('Session not found. Please check the session ID and try again.');
      navigate('/');
    });

    // Set up timesync
    socket.on('connect', () => {
      try {
        tsRef.current = timesync.create({
          server: socket,
          interval: 10000,
        });
      } catch (error) {
        console.error('Error creating timesync:', error);
        tsRef.current = {
          now: () => Date.now(),
          destroy: () => {}
        };
      }
    });

    // Join session
    socket.emit('join-session', {
      sessionId,
      userId: user._id,
      username: user.name,
      sessionName: searchParams.get('name'),
    });

    // Set up event handlers
    const handlers = {
      'participant-count': (count) => {
        console.log('Received participant count:', count);
        setParticipantCount(count);
      },
      'session-name-updated': (data) => {
        console.log('Session name updated:', data);
        handleSessionNameUpdated(data);
      },
      'session-state': (data) => {
        console.log('Received session state:', data);
        setSongs(data.songs);
        setSessionName(data.sessionName);
        setParticipantCount(data.participantCount);
        setParticipants(data.participants || []); // Initialize participants from session state
        if (data.currentSong) {
          setCurrentSong(data.currentSong);
          setCurrentTime(data.currentTime);
          setIsPlaying(data.isPlaying);

          if (audioRef.current) {
            audioRef.current.src = data.currentSong.url;
            audioRef.current.currentTime = data.currentTime;
            if (data.isPlaying) {
              audioRef.current.play().catch((error) => {
                console.log('Playback failed:', error);
              });
            }
          }
        }
      },
      'song-update': handleSongUpdate,
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
      'session-joined': handleSessionJoined,
      'user-joined': (data) => {
        console.log('User joined:', data);
        if (data.participantCount !== undefined) {
          setParticipantCount(data.participantCount);
        }
        if (data.username) {
          setParticipants(prev => [...prev, { 
            id: data.userId, 
            name: data.username,
            isCurrentUser: data.userId === user._id 
          }]);
        }
      },
      'user-left': (data) => {
        console.log('User left:', data);
        if (data.participantCount !== undefined) {
          setParticipantCount(data.participantCount);
        }
        if (data.userId) {
          setParticipants(prev => prev.filter(p => {
            if (p.id === data.userId) return false;
            return true; // Keep existing participants with their isCurrentUser flag
          }));
        }
      },
      'next-song': handleNextSongEvent,
      'previous-song': handlePreviousSongEvent,
      'volume-change': handleVolumeChange,
      'song-added': handleSongAdded,
      'song-removed': handleSongRemoved,
      'sync-playback': handleSyncPlayback,
      'sync-response': handleSyncResponse,
      'prepare-playback': handlePreparePlayback,
      'ready-state-update': (data) => {
        setReadyCount(data.readyCount);
        setTotalCount(data.totalCount);
      },
      'sync-countdown': (data) => setCountdownTime(data.startTime),
      'start-sync-playback': handleStartSyncPlayback,
      'connect_error': (err) => {
        console.error('Connection error:', err);
        alert('Failed to connect to the server. Please try again later.');
      }
    };

    // Register all event handlers
    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    // Cleanup function
    return () => {
      // Remove all event handlers
      Object.keys(handlers).forEach(event => {
        socket.off(event);
      });
      
      // Disconnect socket
      socket.disconnect();
      
      // Cleanup timesync
      if (tsRef.current && typeof tsRef.current.destroy === 'function') {
        tsRef.current.destroy();
      }
    };
  }, [sessionId, user, searchParams, navigate]); // Only dependencies that don't change during normal operation

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current;
      const handleEnded = () => {
        const currentIndex = songs.findIndex(
          (song) => currentSong && song.name === currentSong.name
        );

        if (currentIndex !== -1 && currentIndex < songs.length - 1) {
          handleNextSong();
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
          socketRef.current.emit('play-pause', {
            sessionId,
            isPlaying: false,
            currentTime: 0,
            timestamp: Date.now(),
          });
        }
      };

      audio.addEventListener('ended', handleEnded);
      return () => {
        audio.removeEventListener('ended', handleEnded);
      };
    }
  }, [currentSong, songs, handleNextSong, sessionId]);

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current;
      const handleCanPlay = () => {
        if (isPlaying) {
          audio.play().catch((error) => {
            console.log('Playback failed:', error);
          });
        }
      };

      const handlePlay = () => {
        setIsPlaying(true);
      };

      const handlePause = () => {
        setIsPlaying(false);
      };

      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);

      return () => {
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
      };
    }
  }, [isPlaying]);

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
  
    const newSongs = [];
    const supportedFormats = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'flac'];
  
    for (const file of files) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (!supportedFormats.includes(fileExtension)) {
        alert(
          `File "${file.name}" is not a supported audio format.\nSupported formats: ${supportedFormats.join(
            ', '
          )}`
        );
        continue;
      }
  
      const formData = new FormData();
      formData.append('song', file);
      formData.append('sessionId', sessionId);
      formData.append('title', file.name);
  
      try {
        // Set initial upload status
        console.log('Setting initial upload status for:', file.name);
        setUploadStatus(prev => {
          const newStatus = {
            ...prev,
            [file.name]: { 
              status: 'uploading', 
              message: `${file.name} is being uploaded by ${user.name}...` 
            }
          };
          console.log('New upload status state (detailed):', JSON.stringify(newStatus, null, 2));
          return newStatus;
        });
  
        console.log('Starting upload for:', file.name);
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
            
            // Process complete JSON objects
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer
            
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const update = JSON.parse(line.trim());
                  console.log('Server status update (detailed):', JSON.stringify(update, null, 2));
                  
                  setUploadStatus(prev => {
                    console.log('Previous upload status:', JSON.stringify(prev, null, 2));
                    const newStatus = {
                      ...prev,
                      [file.name]: { 
                        status: update.status, 
                        message: update.message 
                      }
                    };
                    console.log('New upload status:', JSON.stringify(newStatus, null, 2));
                    return newStatus;
                  });
  
                  if (update.status === 'complete' && update.song) {
                    newSongs.push({
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
      }
    }
  
    if (newSongs.length > 0) {
      console.log('Adding songs to session:', newSongs);
      socketRef.current.emit('upload-songs', {
        sessionId,
        songs: newSongs,
      });
    }
  
    // Clear successful upload statuses after 5 seconds
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

  const playSong = (song) => {
    if (!audioRef.current) return;

    isLocalUpdate.current = true;
    lastUpdateTimeRef.current = Date.now();

    setCurrentSong(song);
    setCurrentTime(0);
    setIsPlaying(true);

    audioRef.current.src = song.url;
    audioRef.current.load();
    audioRef.current.currentTime = 0;

    const playAudio = async () => {
      if (audioRef.current) {
        try {
          await audioRef.current.play();
        } catch (error) {
          console.error('Playback failed:', error);
          setIsPlaying(false);
        }
      }
    };

    audioRef.current.oncanplay = playAudio;
    audioRef.current.onerror = () => {
      console.error('Error loading audio');
      setIsPlaying(false);
    };

    socketRef.current.emit('play-song', {
      sessionId,
      song,
      currentTime: 0,
      isPlaying: true,
      timestamp: Date.now(),
    });
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isSeekingRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const formatTime = (time) => {
    if (!time) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleRemoveSong = (songName) => {
    socketRef.current.emit('remove-song', {
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

    socketRef.current.emit('reorder-songs', {
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

      socketRef.current.emit('new-poll', {
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
    if (!poll) {
      return;
    }

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

    socketRef.current.emit('poll-vote', {
      sessionId,
      pollId,
      optionIndex,
      voter: user._id,
    });
  };

  const handleDeletePoll = (pollId) => {
    socketRef.current.emit('delete-poll', {
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
            <div className="logo-icon"></div>
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
                className={`song-item ${
                  currentSong && currentSong.name === song.name ? 'playing' : ''
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
                      onClick={() => handleMoveSong(index, 'up')}
                      disabled={index === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="move-btn down-btn"
                      onClick={() => handleMoveSong(index, 'down')}
                      disabled={index === songs.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="remove-btn"
                      onClick={() => handleRemoveSong(song.name)}
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
            </div>
            <div
              className="progress-container"
              onClick={handleSeek}
              ref={progressBarRef}
            >
              <div
                className="progress-bar"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
            </div>
            <div className="time-display">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>

            <audio
              ref={audioRef}
              src={currentSong?.url}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
            />

            <div className="player-controls">
              <button
                className="control-btn"
                onClick={handlePreviousSong}
                disabled={!currentSong}
              >
                <FontAwesomeIcon icon={faBackward} />
              </button>
              <button
                className="play-pause-btn"
                onClick={handlePlayPause}
                disabled={!currentSong}
              >
                <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
              </button>
              <button
                className="control-btn"
                onClick={handleNextSong}
                disabled={!currentSong}
              >
                <FontAwesomeIcon icon={faForward} />
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