// controllers/sessionController.js
const Session = require('../models/Session');
const { nanoid } = require('nanoid');

const sessionResponse = (session) => ({
  _id: session._id,
  sessionId: session.sessionId,
  name: session.name,
  host: session.host,
  participants: session.participants,
  songs: session.songs,
  currentSong: session.currentSong,
  currentTime: session.currentTime,
  isPlaying: session.isPlaying
});

// @desc    Create a new session
// @route   POST /api/sessions/create
// @access  Private
const createSession = async (req, res) => {
  try {
    const session = await Session.create({
      sessionId: nanoid(10),
      name: String(req.body.name || '').trim() || 'Untitled Session',
      host: req.user._id,
      participants: [req.user._id]
    });

    res.status(201).json(sessionResponse(session));
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
    const sessionId = String(req.body.sessionId || '').trim();
    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const alreadyIn = session.participants.some((id) => id.equals(req.user._id));
    if (!alreadyIn) {
      session.participants.push(req.user._id);
      await session.save();
    }

    await session.populate('host', 'name email');
    res.json(sessionResponse(session));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get session details (also used to check a session exists before joining)
// @route   GET /api/sessions/:sessionId
// @access  Private
const getSessionById = async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: String(req.params.sessionId).trim() })
      .populate('host', 'name email')
      .populate('participants', 'name email');

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(sessionResponse(session));
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
