require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
// const bodyParser = require('body-parser');
const initializePassport = require('./passport-config');
const authRouter = require('./routes/authRouter');
const eventRouter = require('./routes/eventRouter');
const { findUserByEmail, findUserById } = require('./models/User');

const app = express();

const allowedOrigins = [
  'http://localhost:3000', // Local development
  'http://localhost:3001', // Another local development port
  'https://alpine-groove-guide.vercel.app' // Vercel deployment
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '50mb' })); // Set JSON limit
// app.use(bodyParser.urlencoded({ limit: '50mb', extended: true })); // Set URL-encoded limit

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Ensure cookies are secure in production
    httpOnly: true,
    sameSite: 'lax' // Adjust based on your needs (strict/lax/none)
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Initialize Passport
initializePassport(passport, findUserByEmail, findUserById);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Use routers
app.use('/api/events', eventRouter);
app.use('/api/auth', authRouter);

app.get('/', (req, res) => res.send('Hello World Welcome to Alpine Groove Guide API!'));

// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// const PORT = process.env.PORT || 3000;
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
module.exports = app;
