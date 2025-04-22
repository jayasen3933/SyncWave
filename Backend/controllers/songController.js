// controllers/songController.js
const Song = require('../models/Song');
const Session = require('../models/Session');
const path = require('path');
const { bucket } = require('../config/firebase');
const { promisify } = require('util');

// @desc    Upload a song to a session
// @route   POST /api/songs/upload
// @access  Private
const uploadSong = async (req, res) => {
  try {
    const { sessionId, title, artist } = req.body;

    if (!sessionId) {
      console.error('SessionId missing in request body:', req.body);
      return res.status(400).json({ message: 'Session ID is required' });
    }

    if (!req.file) {
      console.error('No file uploaded');
      return res.status(400).json({ message: 'Please upload a file' });
    }

    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      console.error(`Session not found with ID: ${sessionId}`);
      return res.status(404).json({ message: 'Session not found' });
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Send initial status and flush
    res.write(JSON.stringify({ 
      status: 'uploading', 
      message: `${req.file.originalname} is being uploaded by ${req.user.name}...` 
    }) + '\n');
    res.flushHeaders();

    // Upload file to Firebase Storage
    const fileName = `songs/${Date.now()}-${req.file.originalname}`;
    console.log('Initiating Firebase upload:', fileName);
    
    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: req.file.mimetype
      }
    });

    blobStream.on('error', (error) => {
      console.error('Firebase upload error:', error);
      res.write(JSON.stringify({ 
        status: 'error', 
        message: `Error uploading file by ${req.user.name}` 
      }) + '\n');
      res.end();
    });

    blobStream.on('finish', async () => {
      try {
        console.log('Upload to Firebase completed, making file public...');
        await blob.makePublic();
        
        // Get the public URL
        const url = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
        console.log('File uploaded successfully:', url);

        // Create song record
        const song = await Song.create({
          title: title || path.parse(req.file.originalname).name,
          artist: artist || 'Unknown',
          firebaseUrl: url,
          uploadedBy: req.user._id,
          session: session._id
        });

        // Add song to session
        const songData = {
          name: song.title,
          url: url
        };
        
        session.songs.push(songData);
        await session.save();

        // Send final success response and flush
        res.write(JSON.stringify({ 
          status: 'complete',
          message: `${song.title} was uploaded by ${req.user.name} and is ready to play!`,
          song: {
            _id: song._id,
            title: song.title,
            artist: song.artist,
            url: url,
            uploadedBy: song.uploadedBy
          }
        }) + '\n');
        res.end();

      } catch (error) {
        console.error('Error after upload:', error);
        res.write(JSON.stringify({ 
          status: 'error', 
          message: `Error saving song metadata for upload by ${req.user.name}` 
        }) + '\n');
        res.end();
      }
    });

    // Write the file to Firebase
    blobStream.end(req.file.buffer);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all songs in a session
// @route   GET /api/songs/session/:sessionId
// @access  Private
const getSongsBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    res.json(session.songs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Stream a song
// @route   GET /api/songs/:id/stream
// @access  Private
const streamSong = async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    
    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    // Redirect to Firebase Storage URL
    res.redirect(song.firebaseUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  uploadSong,
  getSongsBySession,
  streamSong
};