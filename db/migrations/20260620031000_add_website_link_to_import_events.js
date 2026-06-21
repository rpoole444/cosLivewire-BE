exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('import_events', 'website_link');
  if (!hasColumn) {
    await knex.schema.alterTable('import_events', (table) => {
      table.string('website_link', 255);
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('import_events', 'website_link');
  if (hasColumn) {
    await knex.schema.alterTable('import_events', (table) => {
      table.dropColumn('website_link');
    });
  }
};
