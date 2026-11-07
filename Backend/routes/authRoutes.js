const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const {
  registerUser,
  loginUser,
  getUserProfile,
  forgotPassword,
  resetPassword,
  logoutUser,
  generateToken,
  getFrontendUrl
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many attempts. Please try again in a few minutes.' });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many reset requests. Please try again later.' });

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/logout', logoutUser);
router.get('/profile', protect, getUserProfile);
router.post('/forgot-password', resetLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);

router.get('/google', (req, res, next) => {
  if (!passport.isGoogleConfigured) {
    return res.redirect(`${getFrontendUrl()}/auth/login?error=google_unavailable`);
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account'
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!passport.isGoogleConfigured) {
    return res.redirect(`${getFrontendUrl()}/auth/login?error=google_unavailable`);
  }
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      if (err) console.error('Google OAuth error:', err);
      return res.redirect(`${getFrontendUrl()}/auth/login?error=google_failed`);
    }
    const token = generateToken(user._id);
    res.redirect(`${getFrontendUrl()}/auth/redirect?token=${encodeURIComponent(token)}`);
  })(req, res, next);
});

module.exports = router;
