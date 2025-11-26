exports.up = function (knex) {
  return knex.schema.alterTable('artists', function (table) {
    table.text('embed_youtube').alter();
    table.text('embed_soundcloud').alter();
    table.text('embed_bandcamp').alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('artists', function (table) {
    table.string('embed_youtube').alter();
    table.string('embed_soundcloud').alter();
    table.string('embed_bandcamp').alter();
  });
};
