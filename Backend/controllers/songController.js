// controllers/songController.js
const Song = require('../models/Song');
const Session = require('../models/Session');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const crypto = require('crypto');

const songsDirectory = path.join(__dirname, '..', 'uploads', 'songs');
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

    const extension = path.extname(req.file.originalname).toLowerCase();
    const filename = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${extension}`;
    const filePath = path.join(songsDirectory, filename);

    await fsPromises.mkdir(songsDirectory, { recursive: true });
    await fsPromises.writeFile(filePath, req.file.buffer, { flag: 'wx' });

    try {
      const song = new Song({
        title: title || path.parse(req.file.originalname).name,
        artist: artist || 'Unknown',
        url: 'pending',
        filename,
        mimeType: req.file.mimetype,
        uploadedBy: req.user._id,
        session: session._id
      });

      const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      song.url = `${backendUrl}/api/songs/${song._id}/stream`;
      await song.save();

      await Session.updateOne(
        { _id: session._id },
        { $push: { songs: { name: song.title, url: song.url } } }
      );

      res.write(JSON.stringify({
        status: 'complete',
        message: `${song.title} was uploaded by ${req.user.name} and is ready to play!`,
        song: {
          _id: song._id,
          title: song.title,
          artist: song.artist,
          url: song.url,
          uploadedBy: song.uploadedBy
        }
      }) + '\n');
      res.end();
    } catch (error) {
      await fsPromises.unlink(filePath).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error('Upload error:', error);
    if (res.headersSent) {
      res.write(JSON.stringify({
        status: 'error',
        message: `Error uploading file by ${req.user.name}`
      }) + '\n');
      return res.end();
    }
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

    const filePath = path.resolve(songsDirectory, song.filename);
    if (!filePath.startsWith(`${path.resolve(songsDirectory)}${path.sep}`)) {
      return res.status(400).json({ message: 'Invalid song path' });
    }

    let fileStats;
    try {
      fileStats = await fsPromises.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ message: 'Audio file not found' });
      }
      throw error;
    }
    const range = req.headers.range;
    const contentType = song.mimeType || 'audio/mpeg';

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);

    if (!range) {
      res.setHeader('Content-Length', fileStats.size);
      return fs.createReadStream(filePath).pipe(res);
    }

    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2])) {
      res.status(416).setHeader('Content-Range', `bytes */${fileStats.size}`);
      return res.end();
    }

    let start;
    let end;
    if (!rangeMatch[1]) {
      const suffixLength = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.status(416).setHeader('Content-Range', `bytes */${fileStats.size}`);
        return res.end();
      }
      start = Math.max(fileStats.size - suffixLength, 0);
      end = fileStats.size - 1;
    } else {
      start = Number.parseInt(rangeMatch[1], 10);
      const requestedEnd = rangeMatch[2]
        ? Number.parseInt(rangeMatch[2], 10)
        : fileStats.size - 1;
      end = requestedEnd;
    }

    if (Number.isNaN(start) || start >= fileStats.size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileStats.size}`);
      return res.end();
    }

    const safeEnd = Math.min(end, fileStats.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${fileStats.size}`);
    res.setHeader('Content-Length', safeEnd - start + 1);
    return fs.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
  } catch (error) {
    console.error(error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'Audio file not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  uploadSong,
  getSongsBySession,
  streamSong
};