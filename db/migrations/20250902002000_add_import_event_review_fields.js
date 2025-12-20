exports.up = function(knex) {
  return knex.schema.alterTable('import_events', table => {
    table.integer('accepted_by');
    table.timestamp('accepted_at');
    table.integer('rejected_by');
    table.timestamp('rejected_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('import_events', table => {
    table.dropColumn('accepted_by');
    table.dropColumn('accepted_at');
    table.dropColumn('rejected_by');
    table.dropColumn('rejected_at');
  });
};
