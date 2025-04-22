// routes/songRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { uploadSong, getSongsBySession, streamSong } = require('../controllers/songController');
const { protect } = require('../middleware/auth');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// Check file type
const fileFilter = (req, file, cb) => {
  // Define allowed extensions and their corresponding mimetypes
  const allowedTypes = {
    'mp3': ['audio/mpeg', 'audio/mp3'],
    'wav': ['audio/wav', 'audio/wave', 'audio/x-wav'],
    'ogg': ['audio/ogg', 'application/ogg'],
    'm4a': ['audio/mp4', 'audio/x-m4a'],
    'aac': ['audio/aac', 'audio/aacp'],
    'wma': ['audio/x-ms-wma'],
    'flac': ['audio/flac', 'audio/x-flac']
  };

  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  const isValidExt = Object.keys(allowedTypes).includes(extension);
  const isValidMime = isValidExt && allowedTypes[extension].includes(file.mimetype);

  console.log('File upload attempt:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    extension: extension,
    mimetypeValid: isValidMime,
    extnameValid: isValidExt
  });

  if (isValidExt && isValidMime) {
    return cb(null, true);
  } else {
    const supportedFormats = Object.keys(allowedTypes).join(', ');
    cb(new Error(`Unsupported file format. Please upload one of these audio formats: ${supportedFormats}`));
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure routes are properly registered with correct middleware
router.post('/upload', protect, upload.single('song'), uploadSong);
router.get('/session/:sessionId', protect, getSongsBySession);
router.get('/:id/stream', protect, streamSong);

module.exports = router;