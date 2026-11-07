const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const timesync = require('timesync');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const passport = require('./config/passport');
const connectDB = require('./config/db');
const Session = require('./models/Session');
const Song = require('./models/Song');
const User = require('./models/User');
const mongoose = require('mongoose');

// Load env vars first
dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set. Add it to Backend/.env');
  process.exit(1);
}

// Never let a stray async error take the whole server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// MongoDB Session Operations with retries
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function createOrUpdateMongoSession(sessionId, sessionData, userId) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      let session = await Session.findOne({ sessionId });
      if (session) {
        Object.assign(session, sessionData);
        await session.save();
        return session;
      } else {
        return await Session.create({
          ...sessionData,
          sessionId,
          host: userId,
          participants: [userId]
        });
      }
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed:`, error);
      retries++;
      if (retries === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function getMongoSession(sessionId) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      return await Session.findOne({ sessionId });
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed:`, error);
      retries++;
      if (retries === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function updateSessionInMongoDB(sessionId, updateData) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      await Session.findOneAndUpdate(
        { sessionId },
        updateData,
        { new: true }
      );
      return true;
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed:`, error);
      retries++;
      if (retries === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function updateParticipants(sessionId, userId, joining) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) return false;
      // Atomic update: avoids VersionError races with other writes to the same session
      const update = joining
        ? { $addToSet: { participants: userId } }
        : { $pull: { participants: userId } };
      const result = await Session.updateOne({ sessionId }, update);
      return result.matchedCount > 0;
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed:`, error);
      retries++;
      if (retries === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function deleteMongoSession(sessionId) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      const session = await Session.findOne({ sessionId });
      if (!session) return false;

      // Delete all songs (and their audio files) associated with this session
      const songDocs = await Song.find({ session: session._id });
      await deleteSongFiles(songDocs);
      await Song.deleteMany({ session: session._id });

      // Delete the session
      await Session.deleteOne({ sessionId });

      console.log(`MongoDB session ${sessionId} and its songs deleted`);
      return true;
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed to delete session:`, error);
      retries++;
      if (retries === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// Normalize a song for storage/broadcast. Returns null for incomplete entries
// (e.g. the empty { startedAt } object Mongo creates as a currentSong default).
function cleanSong(song) {
  if (!song || !(song.url || song.firebaseUrl)) return null;
  const out = { name: song.title || song.name || 'Untitled', url: song.url || song.firebaseUrl };
  if (song._id) out._id = String(song._id);
  return out;
}

// Delete uploaded audio files belonging to songs that are being removed
async function deleteSongFiles(songDocs) {
  const songsDir = path.join(__dirname, 'uploads', 'songs');
  await Promise.all(songDocs.map(async (doc) => {
    if (!doc.filename) return;
    const filePath = path.resolve(songsDir, doc.filename);
    if (!filePath.startsWith(songsDir + path.sep)) return;
    await fs.promises.unlink(filePath).catch(() => {});
  }));
}

// Clean up empty sessions on server start
async function cleanupEmptySessions() {
  try {
    console.log('🧹 Checking for empty sessions to clean up...');
    const allSessions = await Session.find({});
    let cleanedCount = 0;

    for (const session of allSessions) {
      if (!session.participants || session.participants.length === 0) {
        // Delete all songs (and their audio files) associated with this session
        const songDocs = await Song.find({ session: session._id });
        await deleteSongFiles(songDocs);
        await Song.deleteMany({ session: session._id });
        // Delete the session
        await Session.deleteOne({ _id: session._id });
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🗑️ Cleaned up ${cleanedCount} empty sessions`);
    } else {
      console.log('✨ No empty sessions found to clean up');
    }
  } catch (error) {
    console.error('Error cleaning up empty sessions:', error);
  }
}

// Import routes
const authRoutes = require('./routes/authRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const songRoutes = require('./routes/songRoutes');

const app = express();
const server = http.createServer(app);
const uploadsPath = path.join(__dirname, 'uploads');

// Essential middleware first
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS configuration
const allowedOrigins = [
  ...(process.env.FRONTEND_URL || 'http://localhost:3000').split(','),
  ...(process.env.CORS_ORIGIN || '').split(',')
].map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin header) and whitelisted origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // In development also allow localhost / 127.0.0.1 / LAN addresses (testing from a phone etc.)
    if (process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
};

app.use(cors(corsOptions));
app.use('/uploads', express.static(uploadsPath));

// Enable pre-flight requests for all routes
app.options('*', cors(corsOptions));

// Behind a reverse proxy (Render, Heroku, Nginx) so req.ip / protocol are correct
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Passport (stateless: we issue JWTs, no server-side login session)
app.use(passport.initialize());

// Connect to database
connectDB();

// Set up timesync endpoint
// timesync clients send a JSON-RPC request and expect { id, result: serverNow }
app.post('/timesync', (req, res) => {
  res.json({
    jsonrpc: '2.0',
    id: req.body && req.body.id,
    result: Date.now()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/songs', songRoutes);

// Unknown API routes return JSON instead of the React app / HTML
app.use('/api', (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Serve static files from the React app
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  const staticPath = path.resolve(__dirname, '../frontend/build');
  app.use(express.static(staticPath));

  // For any route that is not an API route, serve the React app
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../frontend/build', 'index.html'));
  });
} else {
  // Root route (for development)
  app.get('/', (req, res) => {
    res.send('SyncWave API is running');
  });
}

// Socket.io setup
const io = new Server(server, {
  cors: corsOptions
});

// Store active sessions and their songs
const sessions = new Map();
const participantCounts = new Map();
const sessionParticipants = new Map();
const userSessions = new Map();
const sessionDeletionTimeouts = new Map(); // Track deletion timeouts
const activeUserSockets = new Map(); // Track active sockets per user
const participantNames = new Map(); // Add map to track participant names

// Add new state management maps
const readyStates = new Map(); // Track ready state of participants
const syncTimeouts = new Map(); // Track sync timeouts

// Add new state management for buffer sync
const clientBuffers = new Map(); // Track buffer progress for each client
const clientSyncStates = new Map(); // Track sync state for each client

// Session cleanup delay (5 minutes)
const SESSION_CLEANUP_DELAY = 5 * 60 * 1000;

// Helper function to cancel pending session deletion
const cancelSessionDeletion = (sessionId) => {
  const timeoutId = sessionDeletionTimeouts.get(sessionId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    sessionDeletionTimeouts.delete(sessionId);
    console.log(`Cancelled pending deletion for session ${sessionId}`);
  }
};

// Helper function to check if user is already in session
const isUserInSession = (userId, sessionId) => {
  const participants = sessionParticipants.get(sessionId);
  return participants && participants.has(userId);
};

const isSocketInSession = (socket, sessionId) => {
  const userEntry = Array.from(userSessions.entries())
    .find(([_, data]) => data.socketId === socket.id);
  return userEntry?.[1].sessionId === sessionId &&
    isUserInSession(userEntry[0], sessionId);
};

// Helper function to handle existing user socket
const handleExistingUserSocket = async (userId) => {
  const existingSocket = activeUserSockets.get(userId);
  if (existingSocket) {
    console.log(`Disconnecting existing socket for user ${userId}`);
    const userSession = userSessions.get(userId);
    if (userSession) {
      const { sessionId } = userSession;
      const participants = sessionParticipants.get(sessionId);
      if (participants) {
        participants.delete(userId);
        const currentCount = updateParticipantCount(sessionId);
        existingSocket.to(sessionId).emit('user-left', {
          userId,
          participantCount: currentCount
        });
      }
    }
    existingSocket.disconnect(true);
  }
};

// Generate a unique session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

// Clean up empty sessions
cleanupEmptySessions();

// Helper function to update participant count and notify all users
const updateParticipantCount = (sessionId) => {
  const participants = sessionParticipants.get(sessionId);
  if (participants) {
    const count = participants.size;
    participantCounts.set(sessionId, count);
    io.to(sessionId).emit('participant-count', count);
    console.log(`Updated participant count for session ${sessionId}: ${count}`);

    // If count becomes 0, schedule deletion
    if (count === 0) {
      console.log(`Scheduling deletion for empty session ${sessionId} in ${SESSION_CLEANUP_DELAY / 1000} seconds`);
      const timeoutId = setTimeout(async () => {
        // Check again if still empty before deleting
        const currentCount = participantCounts.get(sessionId) || 0;
        if (currentCount === 0) {
          console.log(`Removing empty session ${sessionId} after timeout`);
          sessionParticipants.delete(sessionId);
          participantCounts.delete(sessionId);
          sessions.delete(sessionId);
          sessionDeletionTimeouts.delete(sessionId);

          // Delete session from MongoDB
          try {
            await deleteMongoSession(sessionId);
          } catch (error) {
            console.error('Error deleting MongoDB session:', error);
          }
        }
      }, SESSION_CLEANUP_DELAY);

      sessionDeletionTimeouts.set(sessionId, timeoutId);
    } else {
      // If count is not 0, cancel any pending deletion
      cancelSessionDeletion(sessionId);
    }
    return count;
  }
  return 0;
};

// Authenticate every socket with the same JWT used for the REST API
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Not authorized: no token'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('name');
    if (!user) return next(new Error('Not authorized: user not found'));
    socket.data.userId = user._id.toString();
    socket.data.username = user.name;
    next();
  } catch (error) {
    next(new Error('Not authorized: invalid token'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Wrap handlers so an error in one event never crashes the server, and so
  // the user identity always comes from the verified token, not the client.
  const on = (event, handler) => {
    socket.on(event, async (data = {}, ...rest) => {
      try {
        if (data && typeof data === 'object') {
          if ('userId' in data || event === 'join-session' || event === 'create-session') {
            data.userId = socket.data.userId;
          }
          if (event === 'join-session') {
            data.username = socket.data.username;
          }
        }
        await handler(data, ...rest);
      } catch (error) {
        console.error(`Error handling socket event "${event}":`, error);
        socket.emit('server-error', { event, message: 'Something went wrong. Please try again.' });
      }
    });
  };

  // Handle session creation
  on('create-session', async (data) => {
    const sessionId = data.sessionId || generateSessionId();
    const sessionName = data.sessionName || 'Untitled Session';
    const userId = data.userId;

    console.log(`Creating session: ${sessionId} with name: ${sessionName} by user: ${userId}`);

    const sessionData = {
      name: sessionName,
      songs: [],
      currentSong: null,
      currentTime: 0,
      isPlaying: false,
      messages: [],
      polls: []
    };

    // Create session in MongoDB
    const mongoSession = await createOrUpdateMongoSession(sessionId, sessionData, userId);

    // Keep in-memory copy for real-time operations
    sessions.set(sessionId, sessionData);

    // Initialize participants tracking
    if (!sessionParticipants.has(sessionId)) {
      sessionParticipants.set(sessionId, new Set());
    }

    if (userId) {
      const participants = sessionParticipants.get(sessionId);
      participants.add(userId);
      userSessions.set(userId, {
        sessionId,
        socketId: socket.id
      });
      updateParticipantCount(sessionId);
    }

    socket.join(sessionId);
    io.to(sessionId).emit('session-name-updated', { sessionName });
    socket.emit('session-created', {
      sessionId,
      sessionName: sessionData.name,
      participantCount: sessionParticipants.get(sessionId).size
    });
  });

  // Handle session name updates
  on('update-session-name', (data) => {
    const { sessionId, sessionName } = data;
    console.log(`Updating session name to: ${sessionName} for session: ${sessionId}`);

    const session = sessions.get(sessionId);
    if (session) {
      session.name = sessionName;
      // Emit to all users in the session
      io.to(sessionId).emit('session-name-updated', { sessionName });
    }
  });

  // Handle session joining
  on('join-session', async (data) => {
    const { sessionId, userId, username, sessionName } = data;

    // Store the username
    participantNames.set(userId, username);

    // Handle existing socket for this user if any
    await handleExistingUserSocket(userId);

    // Store this as the active socket for this user
    activeUserSockets.set(userId, socket);

    console.log(`User ${userId} attempting to join session: ${sessionId}`);
    console.log("Available sessions:", Array.from(sessions.keys()));

    // Make sure the sessionId is a string and properly trimmed
    const normalizedSessionId = String(sessionId).trim();


    // Try to get session from MongoDB first
    let mongoSession = await getMongoSession(normalizedSessionId);

    if (!mongoSession && !sessions.has(normalizedSessionId)) {
      // A concurrent creator may still be saving the session.
      if (!sessionName) {
        await new Promise(resolve => setTimeout(resolve, 100));
        mongoSession = await getMongoSession(normalizedSessionId);
      }

      if (sessions.has(normalizedSessionId)) {
        mongoSession = await getMongoSession(normalizedSessionId);
      }

      if (!mongoSession && !sessions.has(normalizedSessionId)) {
        console.log(`Session not found: "${normalizedSessionId}"`);
        console.log(`Session types in map: ${Array.from(sessions.keys()).map(id => typeof id)}`);

        // If session doesn't exist and sessionName is provided, create a new session
        if (sessionName) {
          const sessionData = {
            name: sessionName,
            songs: [],
            currentSong: null,
            currentTime: 0,
            isPlaying: false,
            messages: [],
            polls: []
          };

          mongoSession = await createOrUpdateMongoSession(normalizedSessionId, sessionData, userId);
          sessions.set(normalizedSessionId, sessionData);

          // Initialize participants set
          sessionParticipants.set(normalizedSessionId, new Set());

          // Notify all users about the session creation
          io.to(normalizedSessionId).emit('session-created', {
            sessionName: sessionData.name
          });

          console.log(`Created new session: ${normalizedSessionId} with name: ${sessionName}`);
        } else {
          // If no sessionName is provided, it means user is trying to join an existing session
          socket.emit('session-not-found', { sessionId: normalizedSessionId });
          console.log(`Session not found: ${normalizedSessionId}`);
          return;
        }
      }
    }

    // Rehydrate in-memory state after a restart or concurrent join.
    if (!sessions.has(normalizedSessionId) && mongoSession) {
      sessions.set(normalizedSessionId, {
        name: mongoSession.name,
        songs: (mongoSession.songs || []).map(cleanSong).filter(Boolean),
        currentSong: cleanSong(mongoSession.currentSong),
        currentTime: mongoSession.currentTime || 0,
        isPlaying: mongoSession.isPlaying || false,
        messages: mongoSession.messages || [],
        polls: mongoSession.polls || [],
        lastUpdate: mongoSession.lastUpdate || Date.now()
      });
    }

    // Update participants in MongoDB
    await updateParticipants(normalizedSessionId, userId, true);

    for (const room of socket.rooms) {
      if (room !== socket.id && room !== normalizedSessionId) socket.leave(room);
    }
    socket.join(normalizedSessionId);
    console.log(`User ${userId} joined room: ${normalizedSessionId}`);

    // Store user's current session and socket mapping
    userSessions.set(userId, {
      sessionId: normalizedSessionId,
      socketId: socket.id
    });

    // Initialize participants set if it doesn't exist
    if (!sessionParticipants.has(normalizedSessionId)) {
      sessionParticipants.set(normalizedSessionId, new Set());
    }

    // Add participant if not already in the session
    const participants = sessionParticipants.get(normalizedSessionId);
    const isNewParticipant = !participants.has(userId);
    if (isNewParticipant) {
      participants.add(userId);
      console.log(`Added user ${userId} to participants list`);
      updateParticipantCount(normalizedSessionId);
    }

    // Get the session
    const session = sessions.get(normalizedSessionId);

    // Calculate the current time with server timestamp for better sync
    const currentTime = session.currentSong && session.isPlaying ?
      session.currentTime + (Date.now() - (session.lastUpdate || Date.now())) / 1000 :
      session.currentTime || 0;

    // Send the full session state to the new client
    session.currentSong = cleanSong(session.currentSong);
    socket.emit('session-state', {
      sessionName: session.name,
      songs: session.songs || [],
      currentSong: session.currentSong,
      currentTime: currentTime,
      isPlaying: session.isPlaying,
      messages: session.messages,
      polls: session.polls,
      participantCount: participants.size,
      participants: Array.from(participants).map(participantId => ({
        id: participantId,
        name: participantNames.get(participantId) || 'Unknown User',
        isCurrentUser: participantId === userId
      })),
      timestamp: Date.now(),
      serverTime: Date.now(),
      syncId: Date.now()
    });

    // Notify other users about the new participant
    if (isNewParticipant) {
      socket.to(normalizedSessionId).emit('user-joined', {
        userId,
        username,
        participantCount: participants.size
      });
    }
  });

  // Add handler for sync request
  on('request-sync', (data) => {
    const sessionId = data.sessionId || Array.from(socket.rooms)[1];
    if (!isSocketInSession(socket, sessionId)) return;
    const session = sessions.get(sessionId);
    if (session) {
      // Calculate adjusted current time
      const adjustedTime = session.isPlaying && session.lastUpdate
        ? session.currentTime + (Date.now() - session.lastUpdate) / 1000
        : session.currentTime || 0;
      // Send immediate sync response
      socket.emit('sync-response', {
        song: session.currentSong || null,
        currentTime: Math.max(0, adjustedTime),
        isPlaying: session.isPlaying,
        serverTime: Date.now(),
        clientTime: data.clientTime,
        syncId: Date.now()
      });
    }
  });

  on('sync-playback', (data) => {
    if (!isSocketInSession(socket, data.sessionId)) return;
    const session = sessions.get(data.sessionId);
    if (!session) return;

    const now = Date.now();
    // Update in-memory session state so server stays authoritative
    session.currentTime = data.currentTime ?? session.currentTime ?? 0;
    session.isPlaying = data.isPlaying ?? session.isPlaying ?? false;
    if (cleanSong(data.song)) session.currentSong = cleanSong(data.song);
    session.lastUpdate = now;

    socket.broadcast.to(data.sessionId).emit('sync-playback', {
      song: session.currentSong || null,
      currentTime: session.currentTime,
      isPlaying: session.isPlaying,
      serverTime: now,
      clientTime: data.clientTime || now,
      syncId: now
    });
  });

  // Handle ready state changes
  on('player-ready', async (data) => {
    const { sessionId, userId, timestamp } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Initialize ready states for session if not exists
      if (!readyStates.has(sessionId)) {
        readyStates.set(sessionId, new Map());
      }

      const sessionReadyStates = readyStates.get(sessionId);
      sessionReadyStates.set(userId, { ready: true, timestamp });

      // Check if all participants are ready
      const participants = sessionParticipants.get(sessionId) || new Set();
      const allReady = participants.size > 0 && Array.from(participants).every(
        participantId => sessionReadyStates.get(participantId)?.ready
      );

      if (allReady) {
        // Calculate sync start time (2 seconds from now)
        const syncStartTime = Date.now() + 2000;

        // Clear any existing sync timeout
        if (syncTimeouts.has(sessionId)) {
          clearTimeout(syncTimeouts.get(sessionId));
        }

        // Set timeout to start playback
        const timeoutId = setTimeout(() => {
          io.to(sessionId).emit('start-sync-playback', {
            timestamp: syncStartTime,
            currentTime: session.currentTime,
            isPlaying: session.isPlaying
          });
          // Reset ready states after sync
          sessionReadyStates.clear();
        }, 2000);

        syncTimeouts.set(sessionId, timeoutId);

        // Notify all clients about countdown
        io.to(sessionId).emit('sync-countdown', {
          startTime: syncStartTime
        });
      }

      // Notify all clients about ready state update
      io.to(sessionId).emit('ready-state-update', {
        userId,
        ready: true,
        readyCount: sessionReadyStates.size,
        totalCount: participants.size
      });
    }
  });

  on('chat-message', async (data) => {
    const { sessionId, message } = data;
    console.log(`Chat message in session ${sessionId}: ${JSON.stringify(message)}`);

    // Update MongoDB and broadcast
    if (!message || !isSocketInSession(socket, sessionId)) return;
    const memSession = sessions.get(sessionId);
    if (memSession) {
      memSession.messages = [...(memSession.messages || []), message];
    }

    // Broadcast first (to other clients, not the sender), then persist atomically
    socket.broadcast.to(sessionId).emit('chat-message', message);
    await Session.updateOne({ sessionId }, { $push: { messages: message } });
  });

  on('upload-songs', async (data) => {
    const { sessionId, songs } = data;
    if (!Array.isArray(songs) || !isSocketInSession(socket, sessionId)) return;
    console.log(`Uploading songs to session ${sessionId}: ${songs.length} songs`);

    // Update MongoDB
    // The upload endpoint already stores each song on the session in MongoDB;
    // this only adds any the DB is missing, atomically.
    const mongoSession = await getMongoSession(sessionId);
    if (mongoSession) {
      const existingUrls = new Set((mongoSession.songs || []).map(song => song.url));
      const missing = songs
        .map(song => ({ name: song.title || song.name, url: song.url || song.firebaseUrl }))
        .filter(song => song.url && !existingUrls.has(song.url));
      if (missing.length) {
        await Session.updateOne({ sessionId }, { $push: { songs: { $each: missing } } });
      }
    }

    // Update in-memory session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { songs: [] });
    }

    const session = sessions.get(sessionId);
    // Ensure songs have proper URL format
    const songsWithUrls = songs.map(song => ({
      _id: song._id,
      name: song.title || song.name,
      url: song.url || song.firebaseUrl // Handle both URL formats
    }));
    const existingUrls = new Set((session.songs || []).map(song => song.url));
    session.songs = [
      ...(session.songs || []),
      ...songsWithUrls.filter(song => song.url && !existingUrls.has(song.url))
    ];

    console.log(`Songs after upload: ${session.songs.length}`);

    // Broadcast the updated songs list to all clients in the session
    io.to(sessionId).emit('songs-updated', session.songs);
  });

  on('play-song', async (data) => {
    const { sessionId } = data;
    const song = cleanSong(data.song);
    if (!isSocketInSession(socket, sessionId) || !song) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    const now = Date.now();
    session.currentSong = song;
    session.currentTime = Number(data.currentTime) || 0;
    session.isPlaying = data.isPlaying !== false;
    session.lastUpdate = now;

    socket.broadcast.to(sessionId).emit('song-update', {
      song,
      currentTime: session.currentTime,
      isPlaying: session.isPlaying,
      timestamp: now,
      serverTime: now,
      lastUpdate: now
    });

    await updateSessionInMongoDB(sessionId, {
      currentSong: song,
      currentTime: session.currentTime,
      isPlaying: session.isPlaying,
      lastUpdate: now
    });
  });

  // Modify play-pause handler to handle simple play/pause without sync
  on('play-pause', async (data) => {
    const { sessionId } = data;
    const isPlaying = Boolean(data.isPlaying);
    const currentTime = Math.max(0, Number(data.currentTime) || 0);
    if (!isSocketInSession(socket, sessionId)) return;
    const session = sessions.get(sessionId);

    if (session) {
      const now = Date.now();
      // Update session state
      session.isPlaying = isPlaying;
      session.currentTime = currentTime;
      session.lastUpdate = now;

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        isPlaying,
        currentTime,
        lastUpdate: now
      });

      // Broadcast to all clients without triggering sync
      socket.broadcast.to(sessionId).emit('song-update', {
        song: session.currentSong,
        currentTime,
        isPlaying,
        timestamp: now,
        serverTime: now,
        lastUpdate: now
      });
    }
  });

  // Update this in your server.js socket handler
  on('seek', async (data) => {
    const { sessionId } = data;
    const isPlaying = Boolean(data.isPlaying);
    const currentTime = Math.max(0, Number(data.currentTime) || 0);
    if (!isSocketInSession(socket, sessionId)) return;
    const session = sessions.get(sessionId);

    if (session) {
      session.currentTime = currentTime;
      session.isPlaying = isPlaying; // Make sure to update the isPlaying state
      session.lastUpdate = Date.now();

      await updateSessionInMongoDB(sessionId, {
        currentTime,
        isPlaying,
        lastUpdate: session.lastUpdate
      });

      // Broadcast to all clients in the session
      const now = Date.now();
      socket.broadcast.to(sessionId).emit('song-update', {
        currentTime,
        isPlaying,
        timestamp: now,
        serverTime: now,
        song: session.currentSong
      });
    }
  });

  on('remove-song', async (data) => {
    const { sessionId, songName } = data;
    if (!isSocketInSession(socket, sessionId)) return;
    const session = sessions.get(sessionId);

    if (session) {
      // Remove the song from the session's songs array
      session.songs = (session.songs || []).filter(song => song.name !== songName);
      await updateSessionInMongoDB(sessionId, { songs: session.songs });

      // If the removed song was the current song, clear the current song state
      if (session.currentSong && session.currentSong.name === songName) {
        session.currentSong = null;
        session.currentTime = 0;
        session.isPlaying = false;

        await updateSessionInMongoDB(sessionId, { currentSong: null, currentTime: 0, isPlaying: false });

        // Broadcast the song state update
        io.to(sessionId).emit('song-update', {
          song: null,
          currentTime: 0,
          isPlaying: false,
          timestamp: Date.now(),
          serverTime: Date.now()
        });
      }

      // Broadcast the updated songs list to all clients in the session
      io.to(sessionId).emit('songs-updated', session.songs);
    }
  });

  // Add handler for reordering songs
  on('reorder-songs', async (data) => {
    const { sessionId } = data;
    if (!Array.isArray(data.songs) || !isSocketInSession(socket, sessionId)) return;
    const songs = data.songs.map(cleanSong).filter(Boolean);
    const session = sessions.get(sessionId);

    if (session) {
      // Update the session's song list with the new order
      session.songs = songs;

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        songs,
        lastUpdate: Date.now()
      });

      // Broadcast the updated song list
      io.to(sessionId).emit('songs-updated', session.songs);
    }
  });

  on('next-song', async (data) => {
    const { sessionId } = data;
    const song = cleanSong(data.song);
    if (!isSocketInSession(socket, sessionId) || !song) return;
    const session = sessions.get(sessionId);

    if (session) {
      const now = Date.now();
      session.currentSong = song;
      session.currentTime = 0;
      session.isPlaying = true;
      session.lastUpdate = now;

      // Broadcast first so other listeners switch tracks with minimal delay
      socket.broadcast.to(sessionId).emit('next-song', {
        song,
        timestamp: now,
        serverTime: now,
        currentTime: 0,
        isPlaying: true
      });

      await updateSessionInMongoDB(sessionId, {
        currentSong: song,
        currentTime: 0,
        isPlaying: true,
        lastUpdate: now
      });
    }
  });

  on('previous-song', async (data) => {
    const { sessionId } = data;
    const song = cleanSong(data.song);
    if (!isSocketInSession(socket, sessionId) || !song) return;
    const session = sessions.get(sessionId);

    if (session) {
      const now = Date.now();
      session.currentSong = song;
      session.currentTime = 0;
      session.isPlaying = true;
      session.lastUpdate = now;

      // Broadcast first so other listeners switch tracks with minimal delay
      socket.broadcast.to(sessionId).emit('previous-song', {
        song,
        timestamp: now,
        serverTime: now,
        currentTime: 0,
        isPlaying: true
      });

      await updateSessionInMongoDB(sessionId, {
        currentSong: song,
        currentTime: 0,
        isPlaying: true,
        lastUpdate: now
      });
    }
  });

  // Handle new polls
  on('new-poll', async (data) => {
    const { sessionId, poll } = data;
    const session = sessions.get(sessionId);

    if (session) {
      session.polls = [...(session.polls || []), poll];

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        polls: session.polls
      });

      // Broadcast poll to all clients
      io.to(sessionId).emit('new-poll', {
        type: 'poll',
        poll,
        sender: poll.creator,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle poll votes
  on('poll-vote', async (data) => {
    const { sessionId, pollId, optionIndex, voter } = data;
    const session = sessions.get(sessionId);

    if (session) {
      const poll = (session.polls || []).find(p => p.id === pollId);
      const option = poll && poll.options && poll.options[optionIndex];
      if (option) {
        option.voters = option.voters || [];

        // Toggle vote
        if (option.voters.includes(voter)) {
          option.voters = option.voters.filter(v => v !== voter);
        } else {
          option.voters.push(voter);
        }
        option.votes = option.voters.length;

        // Update MongoDB
        await updateSessionInMongoDB(sessionId, {
          polls: session.polls
        });

        // Broadcast vote update
        io.to(sessionId).emit('poll-vote', {
          pollId,
          optionIndex,
          voter,
          updatedOption: option
        });
      }
    }
  });

  // Handle poll deletion
  on('delete-poll', async (data) => {
    const { sessionId, pollId } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Remove poll from session
      session.polls = (session.polls || []).filter(p => p.id !== pollId);
      session.messages = (session.messages || []).filter(msg =>
        msg.type !== 'poll' || !msg.poll || msg.poll.id !== pollId
      );

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        polls: session.polls,
        messages: session.messages
      });

      // Broadcast poll deletion
      io.to(sessionId).emit('poll-deleted', {
        pollId,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle user leaving session
  on('user-leave-session', async (data) => {
    const { sessionId, userId } = data;
    console.log(`User ${userId} is leaving session ${sessionId}`);

    const participants = sessionParticipants.get(sessionId);

    if (participants) {
      participants.delete(userId);
      userSessions.delete(userId);
      participantNames.delete(userId); // Clean up username

      const currentCount = updateParticipantCount(sessionId);

      io.to(sessionId).emit('user-left', {
        userId,
        participantCount: currentCount
      });
    }
  });

  // Add handler for sync check
  on('sync-check', (data) => {
    const { sessionId, clientTime, bufferProgress, isBuffering } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Store client's buffer progress
      if (!clientBuffers.has(sessionId)) {
        clientBuffers.set(sessionId, new Map());
      }
      const sessionBuffers = clientBuffers.get(sessionId);
      sessionBuffers.set(socket.id, { bufferProgress, isBuffering });

      // Calculate the current playback time using server-authoritative reference
      let adjustedCurrentTime = session.currentTime || 0;
      if (session.isPlaying && session.lastUpdate) {
        const elapsedTime = (Date.now() - session.lastUpdate) / 1000;
        adjustedCurrentTime += elapsedTime;
      }

      const now = Date.now();
      // Send sync response
      socket.emit('sync-response', {
        song: session.currentSong || null,
        currentTime: adjustedCurrentTime,
        serverTime: now,
        clientTime,
        isPlaying: session.isPlaying,
        syncId: now
      });
    }
  });

  // Add handler for buffer state updates
  on('buffer-state', (data) => {
    const { sessionId, bufferProgress, isBuffering } = data;

    if (!clientBuffers.has(sessionId)) {
      clientBuffers.set(sessionId, new Map());
    }

    const sessionBuffers = clientBuffers.get(sessionId);
    sessionBuffers.set(socket.id, { bufferProgress, isBuffering });

    // Broadcast buffer state to all clients in session
    const bufferValues = Array.from(sessionBuffers.values());
    const avgBufferProgress = bufferValues.reduce((sum, state) => sum + state.bufferProgress, 0) / bufferValues.length;
    const anyBuffering = bufferValues.some(state => state.isBuffering);

    io.to(sessionId).emit('buffer-update', {
      avgBufferProgress,
      anyBuffering,
      timestamp: Date.now()
    });
  });

  on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);

    // Find which session and user this socket belonged to
    const userEntry = Array.from(userSessions.entries())
      .find(([_, data]) => data.socketId === socket.id);

    if (userEntry) {
      const [userId, { sessionId }] = userEntry;
      console.log(`Disconnected user ${userId} was in session ${sessionId}`);

      const participants = sessionParticipants.get(sessionId);

      if (participants) {
        // Remove the participant from memory
        participants.delete(userId);
        userSessions.delete(userId);
        participantNames.delete(userId); // Clean up username on disconnect

        // Remove participant from MongoDB session
        try {
          await updateParticipants(sessionId, userId, false);
          console.log(`Removed user ${userId} from MongoDB session ${sessionId}`);

          // Get updated MongoDB session to check if it's empty
          const mongoSession = await Session.findOne({ sessionId });
          if (mongoSession && (!mongoSession.participants || mongoSession.participants.length === 0)) {
            console.log(`MongoDB session ${sessionId} is now empty after disconnect`);
          }
        } catch (error) {
          console.error('Error updating MongoDB session participants:', error);
        }

        const currentCount = updateParticipantCount(sessionId);

        // Notify remaining users about the user leaving
        io.to(sessionId).emit('user-left', {
          userId,
          participantCount: currentCount
        });
      }
    }

    // Clean up buffer tracking for this socket
    clientBuffers.forEach((sessionBuffers) => {
      sessionBuffers.delete(socket.id);
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum size is 10MB.'
      : err.message;
    return res.status(400).json({ message });
  }
  if (err.message && (err.message.startsWith('Unsupported file format') || err.message.includes('not allowed by CORS'))) {
    return res.status(400).json({ message: err.message });
  }
  console.error(err);
  res.status(err.status || 500).json({ message: 'Server error' });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});