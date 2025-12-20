exports.up = function(knex) {
  return knex.schema.alterTable('import_batches', table => {
    table.string('status').notNullable().defaultTo('pending');
    table.timestamp('completed_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('import_batches', table => {
    table.dropColumn('status');
    table.dropColumn('completed_at');
  });
};
