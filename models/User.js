const knex = require('knex');

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