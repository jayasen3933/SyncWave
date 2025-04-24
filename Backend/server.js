const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const timesync = require('timesync');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('./config/passport');
const connectDB = require('./config/db');
const Session = require('./models/Session');
const Song = require('./models/Song');

// Load env vars first
dotenv.config();

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
      const session = await Session.findOne({ sessionId });
      if (!session) return false;

      if (joining && !session.participants.includes(userId)) {
        session.participants.push(userId);
      } else if (!joining) {
        session.participants = session.participants.filter(id => id.toString() !== userId.toString());
      }

      await session.save();
      return true;
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

      // Delete all songs associated with this session
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

// Clean up empty sessions on server start
async function cleanupEmptySessions() {
  try {
    console.log('🧹 Checking for empty sessions to clean up...');
    const allSessions = await Session.find({});
    let cleanedCount = 0;

    for (const session of allSessions) {
      if (!session.participants || session.participants.length === 0) {
        // Delete all songs associated with this session
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

// Essential middleware first
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
};

app.use(cors(corsOptions));

// Enable pre-flight requests for all routes
app.options('*', cors(corsOptions));

// Session middleware (for Google OAuth)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Connect to database
connectDB();

// Set up timesync endpoint
app.post('/timesync', (req, res) => {
  const { clientTime } = req.body;
  res.json({
    serverTime: Date.now(),
    clientTime: clientTime
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/songs', songRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('SyncWave API is running');
});

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
          participantNames.clear(); // Clean up all participant names

          // Delete session from MongoDB
          try {
            await deleteMongoSession(sessionId);
            // Clear MongoDB session participants
            const mongoSession = await Session.findOne({ sessionId });
            if (mongoSession) {
              mongoSession.participants = [];
              await mongoSession.save();
            }
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle session creation
  socket.on('create-session', async (data) => {
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
  socket.on('update-session-name', (data) => {
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
  socket.on('join-session', async (data) => {
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

    // Check if user is already in the session
    if (isUserInSession(userId, normalizedSessionId)) {
      console.log(`User ${userId} is already in session ${normalizedSessionId}`);
      return;
    }

    // Try to get session from MongoDB first
    let mongoSession = await getMongoSession(normalizedSessionId);

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

    // Update participants in MongoDB
    await updateParticipants(normalizedSessionId, userId, true);

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
    const currentTime = session.currentSong ?
      session.currentTime + (Date.now() - (session.lastUpdate || Date.now())) / 1000 : 0;

    // Send the full session state to the new client
    socket.emit('session-state', {
      sessionName: session.name,
      songs: session.songs,
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
  socket.on('request-sync', (data) => {
    const sessionId = data.sessionId || Array.from(socket.rooms)[1];
    const session = sessions.get(sessionId);
    if (session) {
      // Send immediate sync response
      socket.emit('sync-response', {
        currentTime: session.currentTime,
        serverTime: Date.now(),
        clientTime: data.clientTime,
        syncId: Date.now()
      });
    }
  });

  // Handle ready state changes
  socket.on('player-ready', async (data) => {
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
      const participants = sessionParticipants.get(sessionId);
      const allReady = Array.from(participants).every(
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

  socket.on('chat-message', async (data) => {
    const { sessionId, message } = data;
    console.log(`Chat message in session ${sessionId}: ${JSON.stringify(message)}`);

    // Update MongoDB and broadcast
    const mongoSession = await getMongoSession(sessionId);
    if (mongoSession) {
      mongoSession.messages = [...(mongoSession.messages || []), message];
      await mongoSession.save();

      // Only broadcast to other clients, not the sender
      socket.broadcast.to(sessionId).emit('chat-message', message);
    }
  });

  socket.on('upload-songs', async (data) => {
    const { sessionId, songs } = data;
    console.log(`Uploading songs to session ${sessionId}: ${songs.length} songs`);

    // Update MongoDB
    const mongoSession = await getMongoSession(sessionId);
    if (mongoSession) {
      // Ensure songs have proper URL format
      const songsWithUrls = songs.map(song => ({
        name: song.title || song.name,
        url: song.url || song.firebaseUrl // Handle both URL formats
      }));
      mongoSession.songs = [...(mongoSession.songs || []), ...songsWithUrls];
      await mongoSession.save();
    }

    // Update in-memory session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { songs: [] });
    }

    const session = sessions.get(sessionId);
    // Ensure songs have proper URL format
    const songsWithUrls = songs.map(song => ({
      name: song.title || song.name,
      url: song.url || song.firebaseUrl // Handle both URL formats
    }));
    session.songs = [...(session.songs || []), ...songsWithUrls];

    console.log(`Songs after upload: ${session.songs.length}`);

    // Broadcast the updated songs list to all clients in the session
    io.to(sessionId).emit('songs-updated', session.songs);
  });

  socket.on('play-song', async (data) => {
    const { sessionId, song, currentTime, isPlaying } = data;

    // Update MongoDB
    const mongoSession = await getMongoSession(sessionId);
    if (mongoSession) {
      // Ensure proper URL format for current song
      mongoSession.currentSong = {
        name: song.title || song.name,
        url: song.url || song.firebaseUrl
      };
      mongoSession.currentTime = currentTime;
      mongoSession.isPlaying = isPlaying;
      mongoSession.lastUpdate = Date.now();
      await mongoSession.save();
    }

    // Update in-memory session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {});
    }
    const session = sessions.get(sessionId);

    // Only update the current song if it's different
    if (!session.currentSong || session.currentSong.name !== song.name) {
      // Ensure proper URL format for current song
      session.currentSong = {
        name: song.title || song.name,
        url: song.url || song.firebaseUrl
      };
      session.currentTime = currentTime;
      session.isPlaying = isPlaying;
      session.lastUpdate = Date.now();

      // Broadcast to all clients in the session
      io.to(sessionId).emit('song-update', {
        song: session.currentSong,
        currentTime,
        isPlaying,
        timestamp: Date.now(),
        serverTime: Date.now(),
        syncId: Date.now(),
        lastUpdate: session.lastUpdate
      });

      // Send an additional sync event
      io.to(sessionId).emit('sync-playback', {
        currentTime: currentTime,
        isPlaying: isPlaying,
        serverTime: Date.now(),
        clientTime: Date.now(),
        syncId: Date.now()
      });
    } else {
      // If it's the same song, just update the time and playing state
      session.currentTime = currentTime;
      session.isPlaying = isPlaying;
      session.lastUpdate = Date.now();

      io.to(sessionId).emit('song-update', {
        song: session.currentSong,
        currentTime,
        isPlaying,
        timestamp: Date.now(),
        serverTime: Date.now(),
        syncId: Date.now(),
        lastUpdate: session.lastUpdate
      });
    }
  });

  // Modify play-pause handler to handle simple play/pause without sync
  socket.on('play-pause', async (data) => {
    const { sessionId, isPlaying, currentTime, timestamp } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Update session state
      session.isPlaying = isPlaying;
      session.currentTime = currentTime;
      session.lastUpdate = timestamp;

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        isPlaying,
        currentTime,
        lastUpdate: timestamp
      });

      // Broadcast to all clients without triggering sync
      io.to(sessionId).emit('song-update', {
        song: session.currentSong,
        currentTime,
        isPlaying,
        timestamp,
        serverTime: Date.now(),
        lastUpdate: timestamp
      });
    }
  });

  // Update this in your server.js socket handler
  socket.on('seek', (data) => {
    const { sessionId, currentTime, isPlaying, timestamp } = data;
    const session = sessions.get(sessionId);

    if (session) {
      session.currentTime = currentTime;
      session.isPlaying = isPlaying; // Make sure to update the isPlaying state
      session.lastUpdate = Date.now();

      // Broadcast to all clients in the session
      io.to(sessionId).emit('song-update', {
        currentTime,
        isPlaying,
        timestamp: Date.now(),
        song: session.currentSong
      });
    }
  });

  socket.on('remove-song', (data) => {
    const { sessionId, songName } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Remove the song from the session's songs array
      session.songs = session.songs.filter(song => song.name !== songName);

      // If the removed song was the current song, clear the current song state
      if (session.currentSong && session.currentSong.name === songName) {
        session.currentSong = null;
        session.currentTime = 0;
        session.isPlaying = false;

        // Broadcast the song state update
        io.to(sessionId).emit('song-update', {
          song: null,
          currentTime: 0,
          isPlaying: false,
          timestamp: Date.now()
        });
      }

      // Broadcast the updated songs list to all clients in the session
      io.to(sessionId).emit('songs-updated', session.songs);
    }
  });

  // Add handler for reordering songs
  socket.on('reorder-songs', async (data) => {
    const { sessionId, songs } = data;
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

  socket.on('next-song', async (data) => {
    const { sessionId, song, timestamp } = data;
    const session = sessions.get(sessionId);

    if (session) {
      session.currentSong = song;
      session.currentTime = 0;
      session.isPlaying = true;
      session.lastUpdate = timestamp;

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        currentSong: song,
        currentTime: 0,
        isPlaying: true,
        lastUpdate: timestamp
      });

      // Broadcast to all clients
      io.to(sessionId).emit('next-song', {
        song,
        timestamp,
        currentTime: 0,
        isPlaying: true
      });
    }
  });

  socket.on('previous-song', async (data) => {
    const { sessionId, song, timestamp } = data;
    const session = sessions.get(sessionId);

    if (session) {
      session.currentSong = song;
      session.currentTime = 0;
      session.isPlaying = true;
      session.lastUpdate = timestamp;

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        currentSong: song,
        currentTime: 0,
        isPlaying: true,
        lastUpdate: timestamp
      });

      // Broadcast to all clients
      io.to(sessionId).emit('previous-song', {
        song,
        timestamp,
        currentTime: 0,
        isPlaying: true
      });
    }
  });

  // Handle new polls
  socket.on('new-poll', async (data) => {
    const { sessionId, poll } = data;
    const session = sessions.get(sessionId);

    if (session) {
      session.polls.push(poll);

      // Update MongoDB
      await updateSessionInMongoDB(sessionId, {
        polls: [...(session.polls || []), poll]
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
  socket.on('poll-vote', async (data) => {
    const { sessionId, pollId, optionIndex, voter } = data;
    const session = sessions.get(sessionId);

    if (session) {
      const poll = session.polls.find(p => p.id === pollId);
      if (poll) {
        const option = poll.options[optionIndex];

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
  socket.on('delete-poll', async (data) => {
    const { sessionId, pollId } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Remove poll from session
      session.polls = session.polls.filter(p => p.id !== pollId);
      session.messages = session.messages.filter(msg =>
        msg.type !== 'poll' || msg.poll.id !== pollId
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
  socket.on('user-leave-session', async (data) => {
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
  socket.on('sync-check', (data) => {
    const { sessionId, clientTime, bufferProgress, isBuffering } = data;
    const session = sessions.get(sessionId);

    if (session) {
      // Store client's buffer progress
      if (!clientBuffers.has(sessionId)) {
        clientBuffers.set(sessionId, new Map());
      }
      const sessionBuffers = clientBuffers.get(sessionId);
      sessionBuffers.set(socket.id, { bufferProgress, isBuffering });

      // Calculate average buffer progress
      const bufferValues = Array.from(sessionBuffers.values());
      const avgBufferProgress = bufferValues.reduce((sum, state) => sum + state.bufferProgress, 0) / bufferValues.length;

      // If any client is buffering, pause others
      const anyBuffering = bufferValues.some(state => state.isBuffering);

      // Calculate the current playback time
      let adjustedCurrentTime = session.currentTime;
      if (session.isPlaying) {
        const elapsedTime = (Date.now() - session.lastUpdate) / 1000; // Time elapsed in seconds
        adjustedCurrentTime += elapsedTime;
      }

      // Send sync response
      socket.emit('sync-response', {
        currentTime: adjustedCurrentTime, // Adjusted playback time
        serverTime: Date.now(), // Server's current timestamp
        clientTime, // Client's original timestamp
        avgBufferProgress, // Average buffer progress
        shouldPause: anyBuffering, // Whether playback should pause
        isPlaying: session.isPlaying, // Playback state
        syncId: Date.now() // Unique sync ID
      });
    }
  });

  // Add handler for buffer state updates
  socket.on('buffer-state', (data) => {
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

  socket.on('disconnect', async () => {
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

// Start the server
const PORT = process.env.PORT || 5000; // Change to a different port
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});