exports.up = async function (knex) {
  await knex.schema.alterTable('tips', (table) => {
    table.integer('artist_id').nullable().alter();
    table.string('source').defaultTo('profile');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('tips', (table) => {
    table.integer('artist_id').notNullable().alter();
    table.dropColumn('source');
  });
};
