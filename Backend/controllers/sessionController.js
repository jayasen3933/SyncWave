// controllers/sessionController.js
const Session = require('../models/Session');
const User = require('../models/User');
const { nanoid } = require('nanoid');

// @desc    Create a new session
// @route   POST /api/sessions/create
// @access  Private
const createSession = async (req, res) => {
  try {
    const sessionId = nanoid(10); // Generate a 10-character session ID
    
    const session = await Session.create({
      sessionId,
      host: req.user._id,
      participants: [req.user._id]
    });

    if (session) {
      res.status(201).json({
        _id: session._id,
        sessionId: session.sessionId,
        host: session.host,
        participants: session.participants
      });
    } else {
      res.status(400).json({ message: 'Invalid session data' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Join a session
// @route   POST /api/sessions/join
// @access  Private
const joinSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check if user is already in the session
    if (!session.participants.includes(req.user._id)) {
      session.participants.push(req.user._id);
      await session.save();
    }

    await session.populate('host', 'name email');
    await session.populate('songs');

    res.json({
      _id: session._id,
      sessionId: session.sessionId,
      host: session.host,
      participants: session.participants,
      songs: session.songs,
      currentSong: session.currentSong,
      currentPosition: session.currentPosition,
      isPlaying: session.isPlaying
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get session details
// @route   GET /api/sessions/:sessionId
// @access  Private
const getSessionById = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findOne({ sessionId })
      .populate('host', 'name email')
      .populate('participants', 'name email')
      .populate('songs')
      .populate('currentSong');

    if (session) {
      res.json({
        _id: session._id,
        sessionId: session.sessionId,
        host: session.host,
        participants: session.participants,
        songs: session.songs,
        currentSong: session.currentSong,
        currentPosition: session.currentPosition,
        isPlaying: session.isPlaying
      });
    } else {
      res.status(404).json({ message: 'Session not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createSession,
  joinSession,
  getSessionById
};