const knex = require('../db/knex');

const migrationName = '20260615000000_add_profile_type_and_venue_fields_to_artists.js';

async function run() {
  try {
    const alreadyApplied = await knex('knex_migrations')
      .where({ name: migrationName })
      .first();

    if (alreadyApplied) {
      console.log(`Migration already applied: ${migrationName}`);
      return;
    }

    const result = await knex.migrate.up({
      name: migrationName,
      disableMigrationsListValidation: true,
    });

    const applied = result?.[1] || [];
    if (!applied.includes(migrationName)) {
      throw new Error(`Migration did not run: ${migrationName}`);
    }

    console.log(`Applied migration: ${migrationName}`);
  } finally {
    await knex.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
