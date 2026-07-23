require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env'
});
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');
const initializePassport = require('./passport-config');
const { requireAdmin } = require('./middleware/auth');
const { createOriginGuard } = require('./middleware/originGuard');
const authRouter = require('./routes/authRouter');
const eventRouter = require('./routes/eventRouter');
const artistRouter = require('./routes/artistRouter');
const inviteRouter = require('./routes/inviteRouter');
const { router: stripeRouter, webhookRouter } = require('./routes/stripe');
const importsRouter = require('./routes/importsRouter');
const venuePhotoMaintenanceRouter = require('./routes/venuePhotoMaintenanceRouter');
const dataQualityRouter = require('./routes/dataQualityRouter');
const knex = require('./db/knex');

const { findUserByEmail, findUserById } = require('./models/User');

const app = express();
app.set('trust proxy', 1);

const productionOrigin = process.env.FRONTEND_BASE_URL || 'https://app.alpinegrooveguide.com';
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [productionOrigin]
  : ['http://localhost:3000', 'http://localhost:3001', productionOrigin];

if (process.env.NODE_ENV === 'production') {
  for (const name of ['SESSION_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
    if (!process.env[name]) throw new Error(`${name} is required in production`);
  }
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl or Postman or same-origin)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('CORS policy: Not allowed by Alpine Groove API'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Raw body parser for Stripe webhooks must come before express.json
app.use('/api/payments/webhook', webhookRouter); // must match Stripe

app.use(createOriginGuard({
  allowedOrigins,
  enabled: process.env.NODE_ENV === 'production',
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '5mb' }));

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
const redisReady = redisClient.connect();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (req, res) => {
  try {
    if (!redisClient.isReady) throw new Error('Redis is not ready');
    await knex.raw('select 1');
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    console.error('[READINESS]', error.message);
    res.status(503).json({ status: 'unavailable' });
  }
});

// Session setup
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24, //1 day
  },
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());
initializePassport(passport, findUserByEmail, findUserById);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Use routers
app.use('/api/events', eventRouter);
app.use('/api/auth', authRouter);
app.use('/api/artists', artistRouter);
app.use('/api/invites', inviteRouter);
app.use('/api/payments', stripeRouter);
app.use('/api/imports', importsRouter);
app.use('/api/admin', requireAdmin);
app.use('/api/admin/imports', importsRouter);
app.use('/api/admin/venue-photo-maintenance', venuePhotoMaintenanceRouter);
app.use('/api/admin/data-quality', dataQualityRouter);
app.get('/', (req, res) => res.send('Hello World Welcome to Alpine Groove Guide API!'));

// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error('[ERROR HANDLER]', err);
  const status = err.status || err.statusCode || 500;
  const isClientError = status >= 400 && status < 500;

  res.status(status).json({
    error: isClientError ? 'Request rejected' : 'Internal server error',
    message: isClientError || process.env.NODE_ENV !== 'production'
      ? (err.message || 'Request failed.')
      : 'Something went wrong.',
  });
});

const startServer = async () => {
  await redisReady;
  const PORT = process.env.PORT || 3000;
  return app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

if (require.main === module) {
  let server;
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down.`);

    const forceExit = setTimeout(() => {
      console.error('Graceful shutdown timed out.');
      process.exit(1);
    }, 10000);
    forceExit.unref();

    try {
      if (server) {
        await new Promise((resolve, reject) => server.close((error) => (
          error ? reject(error) : resolve()
        )));
      }
      if (redisClient.isOpen) await redisClient.quit();
      await knex.destroy();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      console.error('Graceful shutdown failed:', error);
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  startServer()
    .then((startedServer) => { server = startedServer; })
    .catch((error) => {
      console.error('Unable to start Alpine Groove Guide API:', error);
      process.exitCode = 1;
    });
}

module.exports = app;
module.exports.startServer = startServer;
