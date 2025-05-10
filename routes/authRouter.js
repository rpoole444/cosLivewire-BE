const express = require('express');
const crypto = require('crypto'); // Node.js built-in module
const bcrypt = require('bcryptjs');
const passport = require('passport');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { sendPasswordResetEmail, sendRegistrationEmail } = require("../models/mailer");
const { getProfilePictureUrl, deleteProfilePicture, findUserByEmail, findUserById, createUser, updateUserLoginStatus, getAllUsers, setPasswordResetToken, updateUser, clearUserResetToken, resetPassword, updateUserAdminStatus } = require('../models/User');

const authRouter = express.Router();

const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    acl: 'public-read',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const fileName = `profile-pictures/${Date.now().toString()}-${file.originalname}`;
      cb(null, fileName);
    },
  }),
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized' });
}
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
      ? JSON.parse(top_music_genres).slice(0, 3)
      : [];

    const newUser = await createUser({
      firstName: first_name,
      lastName: last_name,
      email: normalizedEmail,
      password,
      userDescription: user_description,
      topMusicGenres: genres, // Save as array
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

// Update user profile route
authRouter.put('/update-profile', upload.single('profile_picture'), async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    console.log("File Data-UPDATEPROFILEPIC : ", req.file);
    console.log("Body Data: ", req.body);
    console.log("User from session: ", req.user);

    const userId = req.user.id;
    const { first_name, last_name, email, user_description, top_music_genres } = req.body;

    const profilePictureUrl = req.file
      ? `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.file.key}`
      : req.user.profile_picture;

    const genres = Array.isArray(top_music_genres)
      ? top_music_genres.slice(0, 3)
      : typeof top_music_genres === 'string'
        ? JSON.parse(top_music_genres).slice(0, 3)
        : [];

    if (req.file && req.user.profile_picture) {
      const oldKey = req.user.profile_picture.split('/').pop();
      await deleteProfilePicture(oldKey);
    }

    const updatedUser = await updateUser(
      userId,
      {
        first_name,
        last_name,
        email,
        user_description,
        top_music_genres: JSON.stringify(genres),
      },
      profilePictureUrl
    );

    return res.json({ message: 'Profile updated successfully', profile_picture: updatedUser.profile_picture });

  } catch (error) {
    console.error('🔴 Error in update-profile:', error); // Make sure you see this in the logs
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});


authRouter.post('/upload-profile-picture', upload.single('profilePicture'), (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  res.status(200).json({ imageUrl: req.file.location });
});

authRouter.get('/profile-picture', ensureAuthenticated, async (req, res) => {
  console.log('Fetching profile picture for user:', req.user);
  const userId = req.user.id;

  try {
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const profilePictureUrl = user.profile_picture;
    res.json({ profile_picture_url: profilePictureUrl });
  } catch (error) {
    console.error('Error fetching profile picture:', error);
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
  console.log('Login attempt:', req.body);
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      console.error('Passport error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!user) {
      console.warn("Authentication failed", info.message);
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
        console.error("Error during login", err);
        return res.status(500).json({ message: 'Internal server error' });
      }
      if (user.email === 'poole.reid@gmail.com') {
        user.is_admin = true;
        // Optionally, if you want to ensure it's reflected in the database:
        // await updateUserAdminStatus(user.id, true);
      }
      console.log('User logged in:', user);
      try {
        await updateUserLoginStatus(user.id, true);
        res.json({
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
        return res.status(500).json({ message: 'Internal server error' });
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
