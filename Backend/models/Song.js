// models/Song.js
const mongoose = require('mongoose');

const SongSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  artist: {
    type: String,
    default: 'Unknown'
  },
  duration: {
    type: Number
  },
url: {
  type: String,
  required: true
},
  filename: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
firebaseUrl: {
  type: String,
  required: false
},

  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Song', SongSchema);