// routes/sessionRoutes.js
const express = require('express');
const router = express.Router();
const { createSession, joinSession, getSessionById } = require('../controllers/sessionController');
const { protect } = require('../middleware/auth');

router.post('/create', protect, createSession);
router.post('/join', protect, joinSession);
router.get('/:sessionId', protect, getSessionById);

module.exports = router;