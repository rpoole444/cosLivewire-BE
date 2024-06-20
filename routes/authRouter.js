const express = require('express');
const crypto = require('crypto'); // Node.js built-in module
const bcrypt = require('bcrypt');
const passport = require('passport');
const { sendPasswordResetEmail, sendRegistrationEmail } = require("../models/mailer");
const { findUserByEmail, createUser, updateUserLoginStatus, getAllUsers, setPasswordResetToken, updateUser, clearUserResetToken, resetPassword, updateUserAdminStatus } = require('../models/User');

const authRouter = express.Router();

// Validate password function
const validatePassword = (password) => {
  const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

// User registration
authRouter.post('/register', async (req, res, next) => {
  try {
    const { first_name, last_name, email, password, user_description, top_music_genres } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'Please provide an email and password' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and include a mix of uppercase letters, lowercase letters, numbers, and special characters.' });
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const genres = Array.isArray(top_music_genres) 
      ? top_music_genres.slice(0, 3) 
      : typeof top_music_genres === 'string'
      ? top_music_genres.split(',').slice(0, 3)
      : [];

    const newUser = await createUser({
      firstName: first_name,
      lastName: last_name,
      email: normalizedEmail,
      password,
      userDescription: user_description,
      topMusicGenres: genres,
    });

    const { password: _, ...userWithoutPassword } = newUser;
    
    await sendRegistrationEmail(normalizedEmail, first_name, last_name);

    res.status(201).json({ 
      message: 'User created successfully',
      user: userWithoutPassword,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while creating the user' });
  }
});

// Update user profile
authRouter.put('/update-profile', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const { first_name, last_name, email, user_description, top_music_genres } = req.body;
  const userId = req.user.id;

  try {
    const genres = Array.isArray(top_music_genres)
      ? top_music_genres.slice(0, 3)
      : typeof top_music_genres === 'string'
      ? top_music_genres.split(',').slice(0, 3)
      : [];

    const updatedUser = await updateUser(userId, {
      first_name,
      last_name,
      email,
      user_description,
      top_music_genres: genres,
    });

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Checks if user is already logged in
authRouter.get('/session', (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({ isLoggedIn: true, user: req.user });
  } else {
    return res.json({ isLoggedIn: false });
  }
});

// Login user
authRouter.post('/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      if (info.message === 'Incorrect username.') {
        return res.status(401).json({ message: 'Email not registered.' });
      }
      if (info.message === 'Incorrect password.') {
        return res.status(401).json({ message: 'Incorrect password.' });
      }
      return res.status(401).json({ message: 'Login failed.' });
    }
    req.logIn(user, async (err) => {
      if (err) {
        return next(err);
      }
      try {
        await updateUserLoginStatus(user.id, true);
        return res.json({
          message: 'Logged in successfully',
          user: { 
            id: user.id, 
            first_name: user.first_name, 
            last_name: user.last_name, 
            email: user.email, 
            is_logged_in: user.is_logged_in, 
            is_admin: user.is_admin,
            top_music_genres: user.top_music_genres,
            user_description: user.user_description,
          }
        });
      } catch (updateError) {
        console.error(updateError);
        return next(updateError);
      }
    });
  })(req, res, next);
});

// Logout user
authRouter.post('/logout', async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(403).json({ message: 'Not logged in' });
  }

  try {
    const userId = req.user.id;
    await updateUserLoginStatus(userId, false);

    req.logout(err => {
      if (err) {
        console.error(err);
        return next(err);
      }

      req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        return res.status(200).json({ message: 'Logged out successfully' });
      });
    });
  } catch (error) {
    console.error('Error during logout:', error);
    return next(error);
  }
});

// Get all users
authRouter.get('/users', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Forgot password reset link sent to user email
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await findUserByEmail(email);

  if (!user) {
    return res.status(404).json({ message: 'No user found with that email.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(resetToken, Number(process.env.BCRYPT_SALT_ROUNDS));

  const expireTime = new Date(Date.now() + 3600000);

  await setPasswordResetToken(user.id, hash, expireTime);

  try {
    await sendPasswordResetEmail(user.email, resetToken);
    res.json({ message: 'Please check your email for the password reset link.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error sending password reset email.' });
  }
});

// Actually resets password
authRouter.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { email, password } = req.body;

    const user = await findUserByEmail(email);

    if (!user || new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    const isMatch = await bcrypt.compare(token, user.reset_token);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS));
    await resetPassword(user.id, hashedPassword);

    await clearUserResetToken(user.id);

    res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting password.' });
  }
});

// Change admin status
authRouter.patch('/setAdmin/:userId', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { userId } = req.params;
  const { is_admin } = req.body;

  try {
    const user = await updateUserAdminStatus(userId, is_admin);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User admin status updated successfully', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = authRouter;
