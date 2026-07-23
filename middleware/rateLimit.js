const crypto = require('crypto');

const clientKey = (req, discriminator = '') => {
  const raw = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(discriminator).toLowerCase()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const createRateLimit = ({ windowMs, max, keyGenerator, message }) => {
  const attempts = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : clientKey(req);
    const current = attempts.get(key);
    const record = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    if (record.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        message: message || 'Too many requests. Please try again later.',
        retry_after_seconds: retryAfter,
      });
    }

    record.count += 1;
    attempts.set(key, record);

    if (attempts.size > 10000) {
      for (const [storedKey, stored] of attempts.entries()) {
        if (stored.resetAt <= now) attempts.delete(storedKey);
      }
    }

    return next();
  };
};

module.exports = { clientKey, createRateLimit };
