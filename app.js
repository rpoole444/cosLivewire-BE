const express = require('express');
const session = require('express-session');
const passport = require('passport');

const app = express();

app.use(express.urlencoded({ extended:false }));
app.use(express.json());

//session setup
app.use(session({
  secret:'secret',
  resave:false,
  saveUninitialized:true
}));

//passport middleware

app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => res.send('Hello World!'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

