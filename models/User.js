const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const bcrypt = require('bcrypt');


const createUser = async (firstName, lastName, email, password) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  return knex('users').insert({
    first_name: firstName,
    last_name: lastName,
    email: email,
    password: hashedPassword,
  });
}

const updateUserLoginStatus = async (userId, isLoggedIn) => {
  if(userId === undefined){
    throw new Error('UserId is Undefied')
  }
  return knex('users')
    .where({ id:userId })
    .update({ is_logged_in: isLoggedIn })
    .returning('*');
}
const updateUserAdminStatus = (userId, isAdmin) => {
  return knex('users')
    .where({ id:userId })
    .update({ is_admin: isAdmin })
    .returning('*');
};
const findUserByEmail = (email) => {
  return knex('users').where({ email }).first();
}

const getAllUsers = () => {
  return knex('users').select('id', 'first_name', 'last_name', 'email', 'is_admin'); // Adjust according to your column names
};
const findUserById = (id) => {
  return knex('users').where({ id: id }).first();
}

module.exports = {
  getAllUsers,
  findUserById,
  updateUserAdminStatus,
  createUser,
  findUserByEmail,
  findUserById,
  updateUserLoginStatus
}