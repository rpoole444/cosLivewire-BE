require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env'
});
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');
const bodyParser = require('body-parser');
const initializePassport = require('./passport-config');
const authRouter = require('./routes/authRouter');
const eventRouter = require('./routes/eventRouter');
const artistRouter = require('./routes/artistRouter');
const inviteRouter = require('./routes/inviteRouter');
const { router: stripeRouter, webhookRouter } = require('./routes/stripe');

const { findUserByEmail, findUserById } = require('./models/User');

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
  'http://localhost:3001', // Local development
  'https://app.alpinegrooveguide.com'// Vercel deployment
];

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

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '50mb' }));

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

// Session setup
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET|| 'keyboard cat',
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
app.get('/', (req, res) => res.send('Hello World Welcome to Alpine Groove Guide API!'));

// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error('[ERROR HANDLER]', err);
  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    error: 'Internal server error',
    message: err.message || 'Something broke!',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// module.exports = app; // Export the app for serverless deployment
