const {
  DEFAULT_REGION,
  REGION_SLUGS,
  inferRegionFromText,
} = require('../../utils/regions');

const addColumnIfMissing = async (knex, tableName, columnName, addColumn) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
};

const dropColumnIfExists = async (knex, tableName, columnName) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (exists) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn(columnName);
    });
  }
};

exports.up = async function(knex) {
  await addColumnIfMissing(knex, 'events', 'region', (table) => {
    table.string('region', 64).notNullable().defaultTo(DEFAULT_REGION).index();
  });

  await addColumnIfMissing(knex, 'artists', 'home_region', (table) => {
    table.string('home_region', 64).notNullable().defaultTo(DEFAULT_REGION).index();
  });

  const hasImportEvents = await knex.schema.hasTable('import_events');
  if (hasImportEvents) {
    await addColumnIfMissing(knex, 'import_events', 'region', (table) => {
      table.string('region', 64);
    });
  }

  const events = await knex('events').select('id', 'region', 'location', 'address', 'venue_name');
  for (const event of events) {
    const currentRegion = String(event.region || '').trim();
    const region = REGION_SLUGS.has(currentRegion)
      ? currentRegion
      : inferRegionFromText(event.location, event.address, event.venue_name);

    await knex('events')
      .where({ id: event.id })
      .update({ region });
  }

  const artists = await knex('artists').select(
    'id',
    'home_region',
    'venue_city',
    'venue_state'
  );
  for (const artist of artists) {
    const currentRegion = String(artist.home_region || '').trim();
    const homeRegion = REGION_SLUGS.has(currentRegion)
      ? currentRegion
      : inferRegionFromText(artist.venue_city, artist.venue_state);

    await knex('artists')
      .where({ id: artist.id })
      .update({ home_region: homeRegion });
  }
};

exports.down = async function(knex) {
  const hasImportEvents = await knex.schema.hasTable('import_events');
  if (hasImportEvents) {
    await dropColumnIfExists(knex, 'import_events', 'region');
  }
  await dropColumnIfExists(knex, 'artists', 'home_region');
  await dropColumnIfExists(knex, 'events', 'region');
};
