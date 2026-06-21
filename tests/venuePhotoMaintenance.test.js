const assert = require('assert');
const knex = require('knex');
const {
  applyVenuePhotoMaintenancePlan,
  buildVenuePhotoDryRunReport,
  classifyImageValue,
  filenameToVenueHint,
  normalizeVenueCandidateName,
  scoreVenuePhotoMatch,
} = require('../utils/venuePhotoMaintenance');
const { DEFAULT_EVENT_IMAGE_URL } = require('../utils/eventImages');

assert.strictEqual(
  normalizeVenueCandidateName('The Black Sheep Colorado Springs'),
  'the black sheep'
);

assert.strictEqual(
  filenameToVenueHint('/Users/reidpoole/Downloads/Black Sheep Logo.jpg'),
  'the black sheep'
);

const blackSheepMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Black Sheep Logo.jpg',
  { id: 10, display_name: 'The Black Sheep' }
);
assert.ok(blackSheepMatch);
assert.strictEqual(blackSheepMatch.confidence, 'high');

const boulderMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Boulder Theater Logo.webp',
  { id: 11, display_name: 'Boulder Theater' }
);
assert.ok(boulderMatch);
assert.strictEqual(boulderMatch.confidence, 'high');

const noMatch = scoreVenuePhotoMatch(
  '/Users/reidpoole/Downloads/Boulder Theater Logo.webp',
  { id: 12, display_name: 'Dazzle' }
);
assert.strictEqual(noMatch, null);

assert.deepStrictEqual(
  classifyImageValue(null),
  { status: 'missing', repairable: true, reason: 'empty_or_placeholder_text' }
);

assert.deepStrictEqual(
  classifyImageValue('TBD'),
  { status: 'missing', repairable: true, reason: 'empty_or_placeholder_text' }
);

assert.deepStrictEqual(
  classifyImageValue('/images/event-placeholder.png'),
  { status: 'default', repairable: true, reason: 'default_alpine_image' }
);

assert.deepStrictEqual(
  classifyImageValue('not a url'),
  { status: 'possibly_broken', repairable: true, reason: 'not_url_or_public_path' }
);

assert.deepStrictEqual(
  classifyImageValue('https://example.com/poster.jpg'),
  { status: 'set', repairable: false, reason: 'image_value_present' }
);

const createTestDb = async () => {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await db.schema.createTable('artists', (table) => {
    table.increments('id').primary();
    table.integer('user_id').nullable();
    table.string('display_name');
    table.string('slug').unique();
    table.string('profile_type');
    table.boolean('is_shell').defaultTo(false);
    table.string('profile_image').nullable();
    table.string('venue_address').nullable();
    table.string('venue_city').nullable();
    table.string('venue_state').nullable();
    table.string('home_region').nullable();
    table.string('website').nullable();
    table.string('bio').nullable();
    table.string('contact_email').nullable();
    table.string('venue_postal_code').nullable();
    table.string('venue_phone').nullable();
    table.string('age_policy').nullable();
    table.integer('shell_created_by_user_id').nullable();
    table.boolean('is_approved').defaultTo(false);
    table.boolean('is_listed').defaultTo(false);
    table.boolean('is_pro').defaultTo(false);
    table.boolean('trial_active').defaultTo(false);
    table.timestamp('deleted_at').nullable();
    table.timestamp('updated_at').nullable();
  });

  await db.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.string('title');
    table.date('date').nullable();
    table.string('venue_name').nullable();
    table.integer('venue_profile_id').nullable();
    table.string('location').nullable();
    table.string('address').nullable();
    table.string('region').nullable();
    table.string('poster').nullable();
    table.string('source').nullable();
    table.string('source_label').nullable();
    table.timestamp('created_at').nullable();
    table.timestamp('updated_at').nullable();
  });

  return db;
};

const seedMaintenanceScenario = async (db) => {
  await db('artists').insert([
    {
      id: 1,
      display_name: 'The Black Sheep',
      slug: 'the-black-sheep',
      profile_type: 'venue',
      profile_image: null,
      home_region: 'colorado-springs',
      deleted_at: null,
    },
    {
      id: 2,
      display_name: 'Dazzle',
      slug: 'dazzle',
      profile_type: 'venue',
      profile_image: 'https://example.com/dazzle.jpg',
      home_region: 'denver',
      deleted_at: null,
    },
  ]);

  await db('events').insert([
    {
      id: 10,
      title: 'Imported Blank Poster',
      venue_name: 'The Black Sheep',
      venue_profile_id: 1,
      poster: null,
      region: 'colorado-springs',
      created_at: '2026-06-20T12:00:00.000Z',
    },
    {
      id: 11,
      title: 'Existing Good Poster',
      venue_name: 'Dazzle',
      venue_profile_id: 2,
      poster: 'https://example.com/good-poster.jpg',
      region: 'denver',
      created_at: '2026-06-20T12:01:00.000Z',
    },
    {
      id: 12,
      title: 'Repeated Unknown Venue A',
      venue_name: 'Mystery Lounge',
      poster: 'TBD',
      region: 'colorado-springs',
      created_at: '2026-06-20T12:02:00.000Z',
    },
    {
      id: 13,
      title: 'Repeated Unknown Venue B',
      venue_name: 'Mystery Lounge',
      poster: '',
      region: 'colorado-springs',
      created_at: '2026-06-20T12:03:00.000Z',
    },
  ]);
};

const runDatabaseTests = async () => {
  let db = await createTestDb();
  try {
    await seedMaintenanceScenario(db);

    const report = await buildVenuePhotoDryRunReport(db, {
      filePaths: ['/Users/reidpoole/Downloads/Black Sheep Logo.jpg'],
      eventLimit: 25,
    });

    assert.strictEqual(report.dry_run, true);
    assert.strictEqual(report.summary.photo_count, 1);
    assert.strictEqual(report.summary.venue_profile_count, 2);
    assert.strictEqual(report.summary.high_confidence_matches, 1);
    assert.strictEqual(report.photo_matches[0].existing_profile_id, 1);
    assert.strictEqual(report.broken_event_images.some((event) => event.event_id === 10), true);
    assert.strictEqual(report.broken_event_images.some((event) => event.event_id === 11), false);
    assert.strictEqual(report.missing_venues.some((venue) => venue.name === 'Mystery Lounge'), true);

    const preview = await applyVenuePhotoMaintenancePlan(db, {
      execute: false,
      approvals: {
        venue_photo_updates: [{ profile_id: 1, image_url: 'https://example.com/black-sheep.jpg' }],
        event_image_repairs: [
          { event_id: 10, use_venue_image: true, use_default: true },
          { event_id: 11, use_venue_image: true, use_default: true },
        ],
        shell_venues: [{ display_name: 'Mystery Lounge', region: 'colorado-springs' }],
      },
      actorUserId: 99,
    });

    assert.strictEqual(preview.execute, false);
    assert.strictEqual(preview.venues_updated.length, 1);
    assert.strictEqual(preview.events_updated.length, 1);
    assert.strictEqual(preview.shell_venues_created.length, 1);
    assert.strictEqual(preview.skipped.some((item) => item.reason === 'valid_event_poster_preserved'), true);

    const unchangedVenue = await db('artists').where({ id: 1 }).first();
    const unchangedEvent = await db('events').where({ id: 10 }).first();
    assert.strictEqual(unchangedVenue.profile_image, null);
    assert.strictEqual(unchangedEvent.poster, null);
    assert.strictEqual(await db('artists').where({ display_name: 'Mystery Lounge' }).first(), undefined);
  } finally {
    await db.destroy();
  }

  db = await createTestDb();
  try {
    await seedMaintenanceScenario(db);

    const executed = await applyVenuePhotoMaintenancePlan(db, {
      execute: true,
      approvals: {
        venue_photo_updates: [
          { profile_id: 1, image_url: 'https://example.com/black-sheep.jpg' },
          { profile_id: 2, image_url: 'https://example.com/dazzle-new.jpg' },
        ],
        event_image_repairs: [
          { event_id: 10, use_venue_image: true, use_default: true },
          { event_id: 12, use_venue_image: true, use_default: true },
        ],
        shell_venues: [
          { display_name: 'Mystery Lounge', region: 'colorado-springs' },
          { display_name: 'The Black Sheep', region: 'colorado-springs' },
          { display_name: 'Dazzle!', region: 'denver' },
        ],
      },
      actorUserId: 99,
    });

    assert.strictEqual(executed.execute, true);
    assert.strictEqual(executed.venues_updated.length, 1);
    assert.strictEqual(executed.shell_venues_created.length, 1);
    assert.strictEqual(executed.events_updated.length, 2);
    assert.strictEqual(executed.skipped.some((item) => item.reason === 'existing_profile_image_preserved'), true);
    assert.strictEqual(executed.skipped.some((item) => item.reason === 'existing_venue_profile_found'), true);
    assert.strictEqual(executed.skipped.some((item) => item.reason === 'normalized_duplicate_venue_profile_found'), true);

    const updatedBlackSheep = await db('artists').where({ id: 1 }).first();
    const preservedDazzle = await db('artists').where({ id: 2 }).first();
    const repairedLinkedEvent = await db('events').where({ id: 10 }).first();
    const repairedDefaultEvent = await db('events').where({ id: 12 }).first();
    const shellVenue = await db('artists').where({ display_name: 'Mystery Lounge' }).first();

    assert.strictEqual(updatedBlackSheep.profile_image, 'https://example.com/black-sheep.jpg');
    assert.strictEqual(preservedDazzle.profile_image, 'https://example.com/dazzle.jpg');
    assert.strictEqual(repairedLinkedEvent.poster, 'https://example.com/black-sheep.jpg');
    assert.strictEqual(repairedDefaultEvent.poster, DEFAULT_EVENT_IMAGE_URL);
    assert.strictEqual(shellVenue.profile_type, 'venue');
    assert.strictEqual(shellVenue.is_shell, 1);
    assert.strictEqual(shellVenue.is_approved, 1);
    assert.strictEqual(shellVenue.shell_created_by_user_id, 99);
  } finally {
    await db.destroy();
  }
};

runDatabaseTests()
  .then(() => {
    console.log('venuePhotoMaintenance tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
