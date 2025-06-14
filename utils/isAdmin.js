function isAdmin(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user?.is_admin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

module.exports = isAdmin;
