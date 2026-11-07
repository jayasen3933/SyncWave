// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Generate JWT
const generateToken = (id, rememberMe = true) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: rememberMe ? '30d' : '1d'
  });

const userResponse = (user, token) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  hasPassword: Boolean(user.password),
  ...(token ? { token } : {})
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (name.length > 50) {
      return res.status(400).json({ message: 'Name must be 50 characters or fewer' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      const hint = userExists.googleId && !userExists.password
        ? ' This email is linked to Google — use "Continue with Google" instead.'
        : ' Try signing in instead.';
      return res.status(409).json({ message: `An account with this email already exists.${hint}` });
    }

    const user = await User.create({ name, email, password });
    res.status(201).json(userResponse(user, generateToken(user._id)));
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, rememberMe } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });

    if (user && !user.password && user.googleId) {
      return res.status(400).json({
        message: 'This account uses Google sign-in. Click "Continue with Google", or use "Forgot password?" to set a password.'
      });
    }

    if (user && (await user.matchPassword(password))) {
      return res.json(userResponse(user, generateToken(user._id, rememberMe !== false)));
    }

    res.status(401).json({ message: 'Invalid email or password' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(userResponse(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Request a password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  const genericMessage = 'If an account exists for that email, a password reset link has been sent.';

  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    const user = await User.findOne({ email });

    // Always answer the same way so the endpoint can't be used to discover
    // which emails are registered.
    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = user.createPasswordResetToken();
    await user.save();

    const resetUrl = `${getFrontendUrl()}/auth/reset-password/${rawToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your SyncWave password',
        text: `Hi ${user.name},\n\nUse the link below to reset your SyncWave password. It expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#9333ea">SyncWave password reset</h2>
            <p>Hi ${user.name.replace(/[<>&"]/g, '')},</p>
            <p>Click the button below to reset your password. This link expires in 1 hour.</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#9333ea;color:#fff;border-radius:6px;text-decoration:none">Reset password</a></p>
            <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
          </div>`
      });
    } catch (mailError) {
      console.error('Failed to send reset email:', mailError);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(502).json({ message: 'Could not send the reset email. Please try again later.' });
    }

    const response = { message: genericMessage };
    // Outside production, return the link so the flow can be tested without SMTP.
    if (process.env.NODE_ENV !== 'production') {
      response.devResetUrl = resetUrl;
    }
    res.json(response);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Reset password using a token from the reset email
// @route   POST /api/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const user = await User.findOne({
      resetPasswordToken: User.hashResetToken(req.params.token),
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({
      message: 'Your password has been reset successfully.',
      ...userResponse(user, generateToken(user._id))
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Log out (JWT is stateless; the client discards its token)
// @route   POST /api/auth/logout
// @access  Public
const logoutUser = (req, res) => {
  res.json({ message: 'Logged out' });
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  forgotPassword,
  resetPassword,
  logoutUser,
  generateToken,
  getFrontendUrl
};
