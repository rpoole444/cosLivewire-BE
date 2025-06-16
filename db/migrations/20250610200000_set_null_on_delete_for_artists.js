exports.up = async function(knex) {
  // Drop existing foreign key
  await knex.schema.alterTable('artists', table => {
    table.dropForeign('user_id');
  });

  // Alter column to be nullable
  await knex.schema.alterTable('artists', table => {
    table.integer('user_id').unsigned().nullable().alter();
  });

  // Recreate foreign key with SET NULL on delete
  await knex.schema.alterTable('artists', table => {
    table.foreign('user_id').references('users.id').onDelete('SET NULL');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('artists', table => {
    table.dropForeign('user_id');
  });

  await knex.schema.alterTable('artists', table => {
    table.integer('user_id').unsigned().notNullable().alter();
  });

  await knex.schema.alterTable('artists', table => {
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
  });
};
