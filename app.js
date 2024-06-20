require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const initializePassport = require('./passport-config');
const authRouter = require('./routes/authRouter');
const eventRouter = require('./routes/eventRouter');
const { findUserByEmail, findUserById } = require('./models/User');

const app = express();

app.use(cors({
  origin: 'http://localhost:3001',
  credentials: true,
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

app.get('/', (req, res) => res.send('Hello World!'));

// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
