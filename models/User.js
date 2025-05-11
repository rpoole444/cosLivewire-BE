const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const bcrypt = require('bcryptjs');
const { S3Client, DeleteObjectCommand, GetObjectCommand  } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});


const createUser = async ({
  firstName,
  lastName,
  displayName,
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
    display_name: displayName,
    email,
    password: hashedPassword,
    user_description: userDescription,
    top_music_genres: JSON.stringify(topMusicGenres), // Saving the array as a JSON string
    is_admin,
  }).returning('*');

  return newUser;
};

const updateUser = async (id, userData, profilePictureUrl) => {
  const genres = Array.isArray(userData.top_music_genres)
    ? userData.top_music_genres
    : JSON.parse(userData.top_music_genres); // Ensure it's an array

  const [updatedUser] = await knex('users')
    .where({ id })
    .update({ 
      ...userData, 
      profile_picture: profilePictureUrl,
      top_music_genres: JSON.stringify(genres), // Save as JSON string
    })
    .returning('*');
  return updatedUser;
};

const updateUserProfilePicture = async (id, profilePictureUrl) => {
  const [updatedUser] = await knex('users')
    .where({ id })
    .update({ profile_picture: profilePictureUrl })
    .returning('*');
  return updatedUser;
};

const deleteProfilePicture = async (key) => {
  try {
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    };
    await s3.send(new DeleteObjectCommand(deleteParams));
  } catch (error) {
    console.error("Error deleting profile picture:", error);
    throw new Error("Could not delete profile picture");
  }
};

const getProfilePictureUrl = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // URL expires in 1 hour
  return url;
};
const updateUserLoginStatus = async (userId, isLoggedIn) => {
  if(userId === undefined){
    throw new Error('UserId is Undefined')
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
  clearUserResetToken,
  updateUser,
  updateUserProfilePicture,
  deleteProfilePicture,
  getProfilePictureUrl,
}