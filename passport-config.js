const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const environment = process.env.NODE_ENV || 'development';
const knexConfig = require('./knexfile')[environment];
const knex = require('knex')(knexConfig);

function initialize(passport, findUserByEmail, findUserById) {
  const authenticateUser = async (email, password, done) => {
    try {
      const user = await findUserByEmail(email);
      if (user == null) {
        return done(null, false, { message: 'No user with that email' });
      }

      if (await bcrypt.compare(password, user.password)) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (e) {
      return done(e);
    }
  };


  passport.use(new LocalStrategy({ usernameField: 'email'}, authenticateUser));
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      console.log('[deserializeUser] id =', id);
      const user = await knex('users').where({ id }).first();
      if (!user) {
        console.warn('[deserializeUser] no user found for id', id);
        return done(null, false);
      }

      console.log('[deserializeUser] loaded user =', { id: user.id, email: user.email });
      return done(null, user);
    } catch (err) {
      console.error('[deserializeUser] error:', err);
      return done(err);
    }
  });
}

module.exports = initialize;
