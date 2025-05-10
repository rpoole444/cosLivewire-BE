const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  // Deletes ALL existing entries
  await knex('users').del();

  const hashedPassword = await bcrypt.hash('Password1!', 10);

  await knex('users').insert([
    {
      first_name: 'Reid',
      last_name: 'Poole',
      email: 'poole.reid@gmail.com',
      password: hashedPassword,
      is_admin: true,
      is_logged_in: false,
      user_description: 'Dev seed user',
      top_music_genres: 'Jazz, Funk, Soul'
    }
  ]);
};
