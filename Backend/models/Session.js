// models/Session.js
const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    default: 'Untitled Session'
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  songs: [{
    name: String,
    url: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  currentSong: {
    name: String,
    url: String,
    startedAt: {
      type: Date,
      default: Date.now
    }
  },
  currentTime: {
    type: Number,
    default: 0
  },
  isPlaying: {
    type: Boolean,
    default: false
  },
  lastUpdate: {
    type: Date,
    default: Date.now
  },
  serverTime: {
    type: Number,
    default: () => Date.now()
  },
  messages: [{
    text: String,
    timestamp: Date,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    senderName: String,
    type: {
      type: String,
      enum: ['message', 'poll'],
      default: 'message'
    },
    poll: {
      id: Number,
      question: String,
      options: [{
        text: String,
        votes: Number,
        voters: [{
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }]
      }],
      creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      creatorName: String
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Add index on sessionId for faster lookups
SessionSchema.index({ sessionId: 1 });

// Add index on lastUpdate to help with cleanup of old sessions
SessionSchema.index({ lastUpdate: 1 });

module.exports = mongoose.model('Session', SessionSchema);