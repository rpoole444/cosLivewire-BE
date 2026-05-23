// middleware/auth.js
const { findUserById } = require('../models/User');

async function ensureAuth(req, res, next) {
  // Passport sessions set req.isAuthenticated()
  if (req.isAuthenticated && req.isAuthenticated()) return next();

  // Fallback: sometimes only the session id is present
  const sessionUserId = req.session?.passport?.user;
  if (sessionUserId) {
    try {
      const user = await findUserById(sessionUserId);
      if (user) {
        req.user = user;
        return next();
      }
    } catch (err) {
      console.error('[ensureAuth] failed to hydrate session user', err);
    }
  }

  return res.status(401).json({ message: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  // Require an authenticated session before checking admin privileges.
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // Authenticated users without admin privileges are explicitly forbidden.
  if (!req.user || req.user.is_admin !== true) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
}

module.exports = { ensureAuth, requireAdmin };
