require('dotenv').config(); 
const cors = require('cors');

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const initializePassport = require('./passport-config')
const { createUser, findUserByEmail, findUserById } = require('./models/User');
const { createEvent, getAllEvents, getEventsForReview, updateEventStatus } = require('./models/Event');
// const flash = require('connect-flash');
const app = express();
app.use(cors({
  origin: 'http://localhost:3001', // Update to match the domain you're making the request from
  credentials: true, // Allow cookies to be sent
}));
app.use(express.urlencoded({ extended:false }));
app.use(express.json());
//session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave:false,
  saveUninitialized:false
}));
//passport middleware
app.use(passport.initialize());
app.use(passport.session());
//initialize Passport
initializePassport(passport, findUserByEmail, findUserById);
//define routers
const authRouter = express.Router();
const eventRouter = express.Router();

//use routers
app.use('/api/events', eventRouter);
app.use('/api/auth', authRouter)

// Registration endpoint
authRouter.post('/register', async (req, res, next) => {
  try{
    const { email, password } = req.body;
    if(!email || !password){
      return res.status(400).json({error: 'Please provide an email and password'});
    }

    const existingUser = await findUserByEmail(email);
    if(existingUser){
      return res.status(400).json({error: 'User already exists'});
    }
    await createUser(email,password);
    res.status(201).json({message: 'User created successfully'})
  } catch (err) {
    console.error(err);
    next(err);
  }
});

authRouter.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: info.message });
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      // Send back user info and possibly a session token, depending on your session handling strategy
      return res.json({ message: 'Logged in successfully', user: { id: user.id, email: user.email } });
    });
  })(req, res, next);
});

//EVENT Endpoints
eventRouter.post('/submit', async (req, res) => {
  try {
    const eventData = req.body; // Include user_id, title, description, location, date, etc.
    const event = await createEvent(eventData);
    res.status(201).json({ event: event[0], message: 'Event submitted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Fetch events pending review
eventRouter.get('/review', async (req, res) => {
  try {
    const events = await getEventsForReview();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update event status (approve/deny)
eventRouter.put('/review/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { isApproved } = req.body; // Expecting a boolean value
    const updatedEvent = await updateEventStatus(eventId, isApproved);
    res.json({ event: updatedEvent[0], message: 'Event status updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

eventRouter.get('/', async (req, res) => {
  try {
    const events = await getAllEvents(); 
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/', (req, res) => res.send('Hello World!'));

// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

