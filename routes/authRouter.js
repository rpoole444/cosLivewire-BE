const express = require('express');
const knex = require('../db/knex');
const crypto = require('crypto'); // Node.js built-in module
const bcrypt = require('bcryptjs');
const passport = require('passport');
const isInTrial = require('../utils/isInTrial');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { sendPasswordResetEmail, sendRegistrationEmail, sendNewsletterEmail } = require("../models/mailer");
const { getProfilePictureUrl, deleteProfilePicture, findUserByEmail, findUserById, createUser, updateUserLoginStatus, getAllUsers, setPasswordResetToken, updateUser, updateUserProfilePicture, clearUserResetToken, resetPassword, updateUserAdminStatus, deleteUser, startTrial } = require('../models/User');
const { computeProActive } = require('../utils/proState');
const { findInviteByCode, markInviteUsed } = require('../models/Invite');
const { imageFileFilter, safeFileName, extractS3Key } = require('../utils/uploadPolicy');
const { clientKey, createRateLimit } = require('../middleware/rateLimit');
const { userResponse } = require('../utils/userResponse');
const { parseGenreSelection } = require('../utils/profileInput');

const authRouter = express.Router();
const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => clientKey(req, req.body?.email),
  message: 'Too many login attempts. Please wait and try again.',
});
const registrationRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 8 });
const passwordResetRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => clientKey(req, req.body?.email),
  message: 'Too many password reset attempts. Please wait and try again.',
});
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
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: imageFileFilter,
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const fileName = `profile-pictures/${Date.now().toString()}-${safeFileName(file.originalname)}`;
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
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
};

const passwordHashSaltRounds = () => Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

const createNewsletterToken = () => crypto.randomBytes(32).toString('hex');

const getFrontendBaseUrl = () => (
  process.env.FRONTEND_BASE_URL ||
  process.env.FRONTEND_URL ||
  process.env.CORS_ORIGIN ||
  'https://app.alpinegrooveguide.com'
).replace(/\/+$/, '');

const getApiBaseUrl = (req) => (
  process.env.API_BASE_URL ||
  process.env.BACKEND_BASE_URL ||
  `${req.protocol}://${req.get('host')}`
).replace(/\/+$/, '');

const getGoogleLoginConfig = (req) => ({
  clientId: process.env.GOOGLE_LOGIN_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID,
  clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  redirectUri:
    process.env.GOOGLE_LOGIN_REDIRECT_URI ||
    `${getApiBaseUrl(req)}/api/auth/google/callback`,
});

const requireGoogleLoginConfig = (req, res) => {
  const config = getGoogleLoginConfig(req);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    res.status(500).json({ message: 'Google login is not configured.' });
    return null;
  }
  return config;
};

const sanitizeRedirectPath = (value) => {
  const fallback = '/UserProfile';
  if (!value) return fallback;
  const redirect = String(value);
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return fallback;
  return redirect;
};

const splitGoogleName = (name = '') => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Alpine', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'User' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const normalizeGoogleLoginHint = (value) => {
  const hint = String(value || '').trim().toLowerCase();
  if (!hint || hint.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) return null;
  return hint;
};

const findOrCreateGoogleUser = async (profile) => {
  const email = String(profile?.email || '').trim().toLowerCase();
  if (!email || profile?.email_verified !== true) {
    const error = new Error('Google did not return a verified email address.');
    error.status = 400;
    throw error;
  }

  const existing = await findUserByEmail(email);
  if (existing) return { user: existing, created: false };

  const { firstName, lastName } = splitGoogleName(profile.name);
  const generatedPassword = crypto.randomBytes(32).toString('hex');
  const user = await createUser({
    firstName: profile.given_name || firstName,
    lastName: profile.family_name || lastName,
    displayName: profile.name || email.split('@')[0],
    email,
    password: generatedPassword,
    userDescription: '',
    topMusicGenres: [],
  });

  try {
    await sendRegistrationEmail(user.email, user.first_name, user.last_name);
  } catch (error) {
    console.error('Google registration email failed:', error);
  }

  return { user, created: true };
};

const newsletterUnsubscribeUrl = (token) => {
  const baseUrl = (
    process.env.FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    ''
  ).replace(/\/+$/, '');
  return `${baseUrl || 'https://app.alpinegrooveguide.com'}/unsubscribe/${token}`;
};

authRouter.get('/google/start', (req, res) => {
  const config = requireGoogleLoginConfig(req, res);
  if (!config) return;

  const redirect = sanitizeRedirectPath(req.query.redirect);
  const state = `${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  req.session.googleLoginOAuthState = state;
  req.session.googleLoginRedirect = redirect;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  const loginHint = normalizeGoogleLoginHint(req.query.login_hint);
  if (loginHint) {
    params.set('login_hint', loginHint);
  }

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRouter.get('/google/callback', async (req, res) => {
  const redirectBase = getFrontendBaseUrl();
  const redirectPath = sanitizeRedirectPath(req.session?.googleLoginRedirect);

  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(`${redirectBase}/LoginPage?googleLogin=error&message=${encodeURIComponent(String(error))}`);
    }

    if (!code || !state || state !== req.session?.googleLoginOAuthState) {
      return res.redirect(`${redirectBase}/LoginPage?googleLogin=error&message=${encodeURIComponent('Invalid Google login response.')}`);
    }

    const config = getGoogleLoginConfig(req);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code: String(code),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData?.error_description || 'Unable to finish Google login.');
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok || !profile.email) {
      throw new Error(profile?.error_description || 'Unable to read Google profile.');
    }

    const { user } = await findOrCreateGoogleUser(profile);
    req.session.googleLoginOAuthState = null;
    req.session.googleLoginRedirect = null;

    req.logIn(user, async (loginError) => {
      if (loginError) {
        console.error('Google login session failed:', loginError);
        return res.redirect(`${redirectBase}/LoginPage?googleLogin=error&message=${encodeURIComponent('Unable to create login session.')}`);
      }

      try {
        await updateUserLoginStatus(user.id, true);
      } catch (statusError) {
        console.error('Google login status update failed:', statusError);
      }

      return res.redirect(`${redirectBase}${redirectPath}${redirectPath.includes('?') ? '&' : '?'}googleLogin=success`);
    });
  } catch (callbackError) {
    console.error('Google login callback failed:', callbackError);
    return res.redirect(`${redirectBase}/LoginPage?googleLogin=error&message=${encodeURIComponent(callbackError.message || 'Google login failed.')}`);
  }
});

authRouter.delete('/users/:id', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { id } = req.params;
  if (Number(id) === Number(req.user.id)) {
    return res.status(400).json({ message: 'You cannot delete your own admin account.' });
  }

  try {
    const deletedUser = await deleteUser(Number(id));
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found or already deleted' });
    }
    res.json({ message: 'User deleted successfully', user: userResponse(deletedUser) });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

// User registration
authRouter.post('/register', registrationRateLimit, async (req, res, next) => {
  try {
    const { first_name, last_name, displayName, email, password, user_description, top_music_genres, inviteCode } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'Please provide an email and password' });
    }

    if (!validatePassword(password)) {
  return res.status(400).json({ 
    error: 'Password must be between 8 and 128 characters.'
  });
}
    const normalizedEmail = email.toLowerCase();
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const genres = parseGenreSelection(top_music_genres);
    if (genres === null) {
      return res.status(400).json({ error: 'Music genres must be a list.' });
    }

    const defaultTrialDays = Number(process.env.DEFAULT_TRIAL_DAYS) || 30;
    let trialDays = null;
    let appliedInvite = null;

    if (inviteCode) {
      const invite = await findInviteByCode(inviteCode);
      if (invite) {
        if (invite.is_active === false) {
          console.warn('[register] invite inactive', invite.code);
        } else {
          const hasCapacity =
            invite.max_uses == null || invite.used_count < invite.max_uses;
          if (hasCapacity) {
            const inviteEmailMismatch =
              invite.email &&
              invite.email.toLowerCase() !== normalizedEmail.toLowerCase()
            ;
            if (inviteEmailMismatch) {
              console.warn(
                '[register] invite email mismatch',
                invite.email,
                normalizedEmail
              );
            } else {
              trialDays = invite.trial_days || defaultTrialDays;
              appliedInvite = invite;
            }
          } else {
            console.warn('[register] invite max uses reached for', invite.code);
          }
        }
      } else {
        console.warn('[register] invite code not found', inviteCode);
      }
    }

    let trialEndsAt = null;
    let trialActive = false;
    if (trialDays) {
      const now = new Date();
      trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
      trialActive = true;
    }

    const newUser = await createUser({
      firstName: first_name,
      lastName: last_name,
      displayName,
      email: normalizedEmail,
      password,
      userDescription: user_description,
      topMusicGenres: genres, // Save as array
      trialEndsAt,
      trialActive,
    });

    if (appliedInvite) {
      await markInviteUsed(appliedInvite.id);
    }

    try {
      await sendRegistrationEmail(normalizedEmail, first_name, last_name);
    } catch (mailError) {
      console.error('Registration email failed after account creation:', mailError);
    }

    res.status(201).json({ 
      message: 'User created successfully',
      user: userResponse(newUser),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while creating the user' });
  }
});

// Update user profile route
authRouter.put('/update-profile', ensureAuthenticated, upload.single('profile_picture'), async (req, res) => {
  const userId = req.user.id;
  const { first_name, last_name, email, user_description, top_music_genres, displayName } = req.body;
  const previousPictureUrl = req.user.profile_picture;
  const profilePictureUrl = req.file ? `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.file.key}` : previousPictureUrl;

  try {
    const genres = parseGenreSelection(top_music_genres);
    if (genres === null) {
      if (req.file?.key) await deleteProfilePicture(req.file.key);
      return res.status(400).json({ message: 'Music genres must be a list.' });
    }

    const normalizedEmail = String(email || req.user.email).trim().toLowerCase();
    if (normalizedEmail !== String(req.user.email).trim().toLowerCase()) {
      if (req.file?.key) await deleteProfilePicture(req.file.key);
      return res.status(400).json({
        message: 'Email changes require verification and are not available from profile editing yet.',
      });
    }

    const updatedUser = await updateUser(userId, {
      first_name,
      last_name,
      display_name: displayName,
      email: normalizedEmail,
      user_description,
      top_music_genres: JSON.stringify(genres), // Save as JSON string
    }, profilePictureUrl);

    if (req.file && previousPictureUrl) {
      const oldKey = extractS3Key(previousPictureUrl);
      if (oldKey) {
        deleteProfilePicture(oldKey).catch((deleteError) => {
          console.error('Failed to delete replaced profile picture:', deleteError);
        });
      }
    }

    res.json({ message: 'Profile updated successfully', profile_picture: updatedUser.profile_picture });
  } catch (error) {
    console.error('Error updating profile:', error);
    if (req.file?.key) {
      deleteProfilePicture(req.file.key).catch((cleanupError) => {
        console.error('Failed to clean up unused profile picture:', cleanupError);
      });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

authRouter.post('/upload-profile-picture', ensureAuthenticated, upload.single('profilePicture'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Profile picture is required.' });

  const previousPictureUrl = req.user.profile_picture;
  try {
    const updatedUser = await updateUserProfilePicture(req.user.id, req.file.location);
    if (previousPictureUrl) {
      const oldKey = extractS3Key(previousPictureUrl);
      if (oldKey) {
        deleteProfilePicture(oldKey).catch((deleteError) => {
          console.error('Failed to delete replaced profile picture:', deleteError);
        });
      }
    }
    return res.status(200).json({ imageUrl: updatedUser.profile_picture });
  } catch (error) {
    deleteProfilePicture(req.file.key).catch((cleanupError) => {
      console.error('Failed to clean up unused profile picture:', cleanupError);
    });
    return res.status(500).json({ message: 'Unable to save profile picture.' });
  }
});

authRouter.get('/profile-picture', ensureAuthenticated, async (req, res) => {
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
    res.json(userResponse(updatedUser));
  } catch (error) {
    console.error('Error starting trial:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Login user
authRouter.post('/login', loginRateLimit, (req, res, next) => {
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
    res.json(users.map(userResponse));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

authRouter.post('/newsletter', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  const previewText = String(req.body?.preview_text || '').trim();
  const dryRun = req.body?.dry_run === true;

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required.' });
  }

  try {
    const users = await knex('users')
      .select('id', 'email', 'newsletter_opt_out_at', 'newsletter_unsubscribe_token')
      .whereNotNull('email')
      .whereNull('newsletter_opt_out_at')
      .orderBy('id', 'asc');

    const recipientsByEmail = new Map();
    users.forEach((user) => {
      const email = String(user.email || '').trim().toLowerCase();
      if (email && email.includes('@') && !recipientsByEmail.has(email)) {
        recipientsByEmail.set(email, user);
      }
    });
    const recipients = Array.from(recipientsByEmail.values());

    if (dryRun) {
      return res.json({
        dry_run: true,
        recipient_count: recipients.length,
        message: `${recipients.length} users would receive this newsletter.`,
      });
    }

    const failed = [];
    for (const user of recipients) {
      let token = user.newsletter_unsubscribe_token;
      if (!token) {
        token = createNewsletterToken();
        await knex('users')
          .where({ id: user.id })
          .whereNull('newsletter_unsubscribe_token')
          .update({ newsletter_unsubscribe_token: token });
      }

      try {
        await sendNewsletterEmail({
          to: user.email,
          subject,
          message,
          previewText,
          unsubscribeUrl: newsletterUnsubscribeUrl(token),
        });
      } catch (error) {
        console.error('Newsletter e-mail failed:', user.email, error);
        failed.push(user.email);
      }
    }

    return res.json({
      sent_count: recipients.length - failed.length,
      failed_count: failed.length,
      failed,
      message: `Newsletter sent to ${recipients.length - failed.length} users.`,
    });
  } catch (error) {
    console.error('Newsletter send failed:', error);
    return res.status(500).json({ message: 'Unable to send newsletter.' });
  }
});

authRouter.post('/newsletter/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ message: 'Invalid unsubscribe link.' });

  try {
    const [updated] = await knex('users')
      .where({ newsletter_unsubscribe_token: token })
      .update({ newsletter_opt_out_at: knex.fn.now() })
      .returning(['id', 'email', 'newsletter_opt_out_at']);

    if (!updated) {
      return res.status(404).json({ message: 'Unsubscribe link not found.' });
    }

    return res.json({ message: 'You have been unsubscribed from platform update emails.' });
  } catch (error) {
    console.error('Newsletter unsubscribe failed:', error);
    return res.status(500).json({ message: 'Unable to unsubscribe right now.' });
  }
});

// Forgot password reset link sent to user email
authRouter.post('/forgot-password', passwordResetRateLimit, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await findUserByEmail(email);

    if (!user) {
      return res.json({ message: 'If an account exists for that email, we sent a password reset link.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(resetToken, passwordHashSaltRounds());
    const expireTime = new Date(Date.now() + 3600000);

    await setPasswordResetToken(user.id, hash, expireTime);
    await sendPasswordResetEmail(user.email, resetToken);
    return res.json({ message: 'If an account exists for that email, we sent a password reset link.' });
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.status(500).json({ message: 'Unable to send a password reset email right now.' });
  }
});

// Actually resets password
authRouter.post('/reset-password/:token', passwordResetRateLimit, async (req, res) => {
  try {
    const { token } = req.params;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!validatePassword(password)) {
      return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' });
    }

    const user = await findUserByEmail(email);

    if (!user || new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    const isMatch = await bcrypt.compare(token, user.reset_token);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    const hashedPassword = await bcrypt.hash(password, passwordHashSaltRounds());
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

  if (typeof is_admin !== 'boolean') {
    return res.status(400).json({ message: 'is_admin must be a boolean.' });
  }
  if (Number(userId) === Number(req.user.id) && !is_admin) {
    return res.status(400).json({ message: 'You cannot revoke your own admin access.' });
  }

  try {
    const users = await updateUserAdminStatus(userId, is_admin);
    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User admin status updated successfully', user: userResponse(users[0]) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = authRouter;
