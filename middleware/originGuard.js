const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const createOriginGuard = ({ allowedOrigins, enabled }) => (req, res, next) => {
  if (!enabled || !UNSAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  // Browsers send Origin on cross-site writes. Requests without it may be trusted
  // server-to-server calls from the Next.js API layer.
  if (!origin || allowedOrigins.includes(origin)) return next();

  return res.status(403).json({
    message: 'This request did not come from an approved Alpine Groove Guide site.',
  });
};

module.exports = { createOriginGuard };
