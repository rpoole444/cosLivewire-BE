exports.up = async function(knex) {
  await knex.schema.alterTable('import_events', table => {
    table.timestamp('start_at').nullable().alter();
  });

  const addColumnIfMissing = async (name, addColumn) => {
    const exists = await knex.schema.hasColumn('import_events', name);
    if (!exists) {
      await knex.schema.alterTable('import_events', addColumn);
    }
  };

  await addColumnIfMissing('date', table => table.date('date'));
  await addColumnIfMissing('start_time', table => table.time('start_time'));
  await addColumnIfMissing('end_time', table => table.time('end_time'));
  await addColumnIfMissing('location', table => table.string('location', 255));
  await addColumnIfMissing('address', table => table.string('address', 255));
  await addColumnIfMissing('city', table => table.string('city', 255));
  await addColumnIfMissing('title', table => table.string('title', 255));
  await addColumnIfMissing('artist_display', table => table.string('artist_display', 255));
  await addColumnIfMissing('poster', table => table.string('poster', 255));
  await addColumnIfMissing('website', table => table.string('website', 255));
  await addColumnIfMissing('genre', table => table.string('genre', 255));
  await addColumnIfMissing('user_id', table => table.integer('user_id'));
};

exports.down = async function(knex) {
  await knex.schema.alterTable('import_events', table => {
    table.timestamp('start_at').notNullable().alter();
  });

  const dropColumnIfExists = async (name) => {
    const exists = await knex.schema.hasColumn('import_events', name);
    if (exists) {
      await knex.schema.alterTable('import_events', table => {
        table.dropColumn(name);
      });
    }
  };

  await dropColumnIfExists('date');
  await dropColumnIfExists('start_time');
  await dropColumnIfExists('end_time');
  await dropColumnIfExists('location');
  await dropColumnIfExists('address');
  await dropColumnIfExists('city');
  await dropColumnIfExists('title');
  await dropColumnIfExists('artist_display');
  await dropColumnIfExists('poster');
  await dropColumnIfExists('website');
  await dropColumnIfExists('genre');
  await dropColumnIfExists('user_id');
};
