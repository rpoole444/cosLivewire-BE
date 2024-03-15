const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const bcrypt = require('bcrypt');


const createUser = async (email, password) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  return knex('users').insert({
    email,
    password: hashedPassword,
  });
}

const findUserByEmail = (email) => {
  return knex('users').where({ email }).first();
}

const findUserById = (id) => {
  return knex('users').where({ id }).first();
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById
}