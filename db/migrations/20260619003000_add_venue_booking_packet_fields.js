const addColumnIfMissing = async (knex, tableName, columnName, buildColumn) => {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (hasColumn) return;
  await knex.schema.alterTable(tableName, (table) => buildColumn(table));
};

const dropColumnIfExists = async (knex, tableName, columnName) => {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) return;
  await knex.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
};

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'artists', 'venue_stage_size', (table) => table.string('venue_stage_size', 160));
  await addColumnIfMissing(knex, 'artists', 'venue_pa_details', (table) => table.text('venue_pa_details'));
  await addColumnIfMissing(knex, 'artists', 'venue_backline', (table) => table.text('venue_backline'));
  await addColumnIfMissing(knex, 'artists', 'venue_load_in', (table) => table.text('venue_load_in'));
  await addColumnIfMissing(knex, 'artists', 'venue_parking', (table) => table.text('venue_parking'));
  await addColumnIfMissing(knex, 'artists', 'venue_green_room', (table) => table.text('venue_green_room'));
  await addColumnIfMissing(knex, 'artists', 'venue_sound_contact', (table) => table.string('venue_sound_contact', 255));
  await addColumnIfMissing(knex, 'artists', 'venue_booking_policy', (table) => table.text('venue_booking_policy'));
};

exports.down = async function down(knex) {
  await dropColumnIfExists(knex, 'artists', 'venue_booking_policy');
  await dropColumnIfExists(knex, 'artists', 'venue_sound_contact');
  await dropColumnIfExists(knex, 'artists', 'venue_green_room');
  await dropColumnIfExists(knex, 'artists', 'venue_parking');
  await dropColumnIfExists(knex, 'artists', 'venue_load_in');
  await dropColumnIfExists(knex, 'artists', 'venue_backline');
  await dropColumnIfExists(knex, 'artists', 'venue_pa_details');
  await dropColumnIfExists(knex, 'artists', 'venue_stage_size');
};
