const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const bcrypt = require('bcrypt');


const createUser = async ({
  firstName,
  lastName,
  email,
  password,
  userDescription = '',
  topMusicGenres = [], // Ensure this is an array
  is_admin = false,
}) => {
  const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 10);

  const [newUser] = await knex('users').insert({
    first_name: firstName,
    last_name: lastName,
    email,
    password: hashedPassword,
    user_description: userDescription,
    top_music_genres: JSON.stringify(topMusicGenres), // Saving the array as a JSON string
    is_admin,
  }).returning('*');

  return newUser;
};

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
  return knex('users').select('*'); // Adjust according to your column names
};

const findUserById = (id) => {
  return knex('users').where({ id: id }).first();
}

const setPasswordResetToken = async (userId, resetTokenHash, expireTime) => {
  return knex('users')
      .where({ id: userId })
      .update({
        reset_token: resetTokenHash,
        reset_token_expires: expireTime
      });};

const findUserByResetToken = async (resetTokenHash) => {
  return knex('users')
      .where('reset_token', resetTokenHash)
      .where('reset_token_expires', '>', knex.fn.now())
      .first();};

const resetPassword = async (userId, hashedPassword) => {
  return knex('users')
    .where({ id: userId })
    .update({
      password: hashedPassword,
      reset_token: null, // Clear the reset token
      reset_token_expires: null // Clear the token expiry time
    });
};

const clearUserResetToken = async (userId) => {
  return knex('users')
    .where({ id: userId })
    .update({
      reset_token: null,
      reset_token_expires: null
    });
};


module.exports = {
  getAllUsers,
  findUserById,
  updateUserAdminStatus,
  createUser,
  findUserByEmail,
  findUserById,
  updateUserLoginStatus,
  setPasswordResetToken,
  findUserByResetToken,
  resetPassword,
  clearUserResetToken
}