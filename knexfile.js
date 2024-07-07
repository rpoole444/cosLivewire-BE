// Update with your config settings.
require('dotenv').config();

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      port: 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: false // for local development, set to false or remove

    },
    migrations: {
      directory: './db/migrations'
    },
    seeds: {
      directory: './db/seeds'
    }
  },
  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
      },
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './db/seeds'
    }
  }
};
