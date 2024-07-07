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

// const allowedOrigins = process.env.NODE_ENV === 'production' ? ['https://alpine-groove-guide-be-e5150870a33a.herokuapp.com/'] : ['http://localhost:3001'];
app.use(cors({
   origin: 'https://alpine-groove-guide.vercel.app/', // Replace this with your frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed methods
  allowedHeaders: ['Content-Type', 'Authorization'],
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
