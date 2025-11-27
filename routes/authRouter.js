const express = require('express');
const crypto = require('crypto'); // Node.js built-in module
const bcrypt = require('bcryptjs');
const passport = require('passport');
const isInTrial = require('../utils/isInTrial');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { sendPasswordResetEmail, sendRegistrationEmail } = require("../models/mailer");
const { getProfilePictureUrl, deleteProfilePicture, findUserByEmail, findUserById, createUser, updateUserLoginStatus, getAllUsers, setPasswordResetToken, updateUser, clearUserResetToken, resetPassword, updateUserAdminStatus, deleteUser, startTrial } = require('../models/User');
const { computeProActive } = require('../utils/proState');

const authRouter = express.Router();
authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
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
  const passwordRegex = /^.{8,}$/; // At least 8 characters
  return passwordRegex.test(password);
};

authRouter.delete('/users/:id', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { id } = req.params;

  try {
    const deletedUser = await deleteUser(Number(id));
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found or already deleted' });
    }
    res.json({ message: 'User deleted successfully', user: deletedUser });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

// User registration
authRouter.post('/register', async (req, res, next) => {
  try {
    const { first_name, last_name, displayName, email, password, user_description, top_music_genres } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'Please provide an email and password' });
    }

    if (!validatePassword(password)) {
  return res.status(400).json({ 
    error: 'Password must be at least 8 characters and include a mix of uppercase letters, lowercase letters, numbers, and a symbol.' 
  });
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
      displayName,
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
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
console.log("File Data-UPDATEPROFILEPIC : ", req.file);

  const userId = req.user.id;
  const { first_name, last_name, email, user_description, top_music_genres, displayName } = req.body;
  const profilePictureUrl = req.file ? `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.file.key}` : req.user.profile_picture;

  try {
    const genres = Array.isArray(top_music_genres)
      ? top_music_genres.slice(0, 3)
      : typeof top_music_genres === 'string'
      ? JSON.parse(top_music_genres).slice(0, 3)
      : [];

    if (req.file && req.user.profile_picture) {
      const oldKey = req.user.profile_picture.split('/').pop();
      await deleteProfilePicture(oldKey);
    }

    const updatedUser = await updateUser(userId, {
      first_name,
      last_name,
      display_name: displayName,
      email,
      user_description,
      top_music_genres: JSON.stringify(genres), // Save as JSON string
    }, profilePictureUrl);

    res.json({ message: 'Profile updated successfully', profile_picture: updatedUser.profile_picture });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error' });
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
authRouter.get('/session', async (req, res) => {
  if (!(req.isAuthenticated?.() && req.user)) {
    return res.json({ isLoggedIn: false, user: null });
  }

  try {
    const dbUser = await findUserById(req.user.id);
    if (!dbUser) {
      return res.json({ isLoggedIn: false, user: null });
    }

    const pro_active = computeProActive(dbUser);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[auth.session]', dbUser.email, {
        is_pro: dbUser.is_pro,
        trial_ends_at: dbUser.trial_ends_at,
        pro_cancelled_at: dbUser.pro_cancelled_at,
        pro_active,
      });
    }

    return res.json({
      isLoggedIn: true,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        is_admin: dbUser.is_admin,
        is_pro: !!dbUser.is_pro,
        trial_active: isInTrial(dbUser.trial_ends_at),
        trial_ends_at: dbUser.trial_ends_at,
        display_name: dbUser.display_name,
        displayName: dbUser.display_name,
        top_music_genres: dbUser.top_music_genres,
        user_description: dbUser.user_description,
        profile_picture: dbUser.profile_picture,
        pro_cancelled_at: dbUser.pro_cancelled_at,
        stripe_customer_id: dbUser.stripe_customer_id,
        pro_active,
      },
    });
  } catch (err) {
    console.error('[auth.session] error fetching session user', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Start a user's trial
authRouter.post('/start-trial', async (req, res) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.trial_ends_at) {
      return res.status(400).json({ message: 'Trial already used' });
    }

    const updatedUser = await startTrial(user.id);
    res.json(updatedUser);
  } catch (error) {
    console.error('Error starting trial:', error);
    res.status(500).json({ message: 'Internal server error' });
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
            is_pro: user.is_pro,
            trial_active: isInTrial(user.trial_ends_at),
            trial_ends_at: user.trial_ends_at,
            top_music_genres: user.top_music_genres,
            displayName: user.display_name,
            user_description: user.user_description,
            pro_cancelled_at: user.pro_cancelled_at,
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
