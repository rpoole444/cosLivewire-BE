require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      host: 'localhost',
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
    },
    debug: true
  },
  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './db/migrations'
    },
    seeds: {
      directory: './db/seeds'
    },
    debug: true
  }
};
