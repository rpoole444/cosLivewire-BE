// middleware/auth.js
function ensureAuth(req, res, next) {
  // Passport sessions set req.isAuthenticated()
  if (req.isAuthenticated && req.isAuthenticated()) return next();

  // Fallback: sometimes only the session id is present
  const sessionUserId = req.session?.passport?.user;
  if (sessionUserId) {
    // mimic Passport deserialize result enough for this route
    req.user = req.user || { id: sessionUserId };
    return next();
  }

  return res.status(401).json({ message: 'Unauthorized' });
}

module.exports = { ensureAuth };
