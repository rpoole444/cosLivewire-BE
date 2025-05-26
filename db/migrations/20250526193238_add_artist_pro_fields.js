exports.up = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.string('website');
    table.boolean('is_pro').defaultTo(false);
    table.string('embed_youtube');
    table.string('embed_soundcloud');
    table.string('embed_bandcamp');
    table.string('promo_photo');
    table.string('stage_plot');
    table.string('press_kit');
  });
};

exports.down = function(knex) {
  return knex.schema.table('artists', function(table) {
    table.dropColumns(
      'website',
      'is_pro',
      'embed_youtube',
      'embed_soundcloud',
      'embed_bandcamp',
      'promo_photo',
      'stage_plot',
      'press_kit'
    );
  });
};
