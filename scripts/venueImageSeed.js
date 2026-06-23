require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
});

const fs = require('fs');
const path = require('path');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const {
  applyVenuePhotoMaintenancePlan,
  normalizeVenueCandidateName,
} = require('../utils/venuePhotoMaintenance');

const DEFAULT_SEED_PATH = path.resolve(__dirname, '..', 'data', 'venueImageSeed.json');

const parseArgs = (argv) => {
  const args = {
    seedPath: DEFAULT_SEED_PATH,
    output: null,
    execute: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed') {
      args.seedPath = path.resolve(argv[index + 1] || DEFAULT_SEED_PATH);
      index += 1;
    } else if (arg === '--output') {
      args.output = path.resolve(argv[index + 1] || '');
      index += 1;
    } else if (arg === '--execute') {
      args.execute = true;
    } else if (arg === '--force') {
      args.force = true;
    }
  }

  return args;
};

const ensureOutputPath = (requestedPath, execute) => {
  if (requestedPath) return requestedPath;
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(reportsDir, `venue-image-seed-${execute ? 'executed' : 'preview'}-${stamp}.json`);
};

const readSeedRows = (seedPath) => {
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Venue image seed file not found: ${seedPath}`);
  }

  const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error('Venue image seed file must contain a JSON array.');
  }

  return rows;
};

const findExistingVenue = (venues, displayName) => {
  const normalized = normalizeVenueCandidateName(displayName);
  return venues.find((venue) => normalizeVenueCandidateName(venue.display_name) === normalized) ||
    venues.find((venue) => String(venue.display_name || '').trim().toLowerCase() === String(displayName || '').trim().toLowerCase());
};

const buildApprovalsFromSeed = async (db, rows, { force = false } = {}) => {
  const venues = await db('artists')
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at')
    .select('id', 'display_name', 'slug', 'profile_image');

  const approvals = {
    venue_photo_updates: [],
    shell_venues: [],
    event_image_repairs: [],
  };
  const resolved = [];
  const skipped = [];

  for (const row of rows) {
    const displayName = String(row.display_name || row.name || '').trim();
    const filePath = row.file_path ? path.resolve(row.file_path) : null;
    const imageUrl = row.image_url || row.profile_image || null;

    if (!displayName) {
      skipped.push({ reason: 'missing_display_name', row });
      continue;
    }

    if (filePath && !fs.existsSync(filePath)) {
      skipped.push({ reason: 'missing_file', display_name: displayName, file_path: filePath });
      continue;
    }

    const existing = findExistingVenue(venues, displayName);
    if (existing) {
      approvals.venue_photo_updates.push({
        profile_id: existing.id,
        file_path: filePath,
        image_url: imageUrl,
        force,
      });
      resolved.push({
        display_name: displayName,
        action: 'update_existing_profile_image',
        profile_id: existing.id,
        slug: existing.slug,
        current_profile_image: existing.profile_image || null,
      });
      continue;
    }

    approvals.shell_venues.push({
      display_name: displayName,
      file_path: filePath,
      image_url: imageUrl,
      bio: row.bio,
      website: row.website,
      home_region: row.home_region || row.region,
      venue_address: row.venue_address || row.address,
      venue_city: row.venue_city || row.city,
      venue_state: row.venue_state || row.state || 'CO',
      venue_postal_code: row.venue_postal_code || row.postal_code,
      venue_phone: row.venue_phone || row.phone,
      age_policy: row.age_policy,
    });
    resolved.push({
      display_name: displayName,
      action: 'create_shell_venue_with_image',
      slug: null,
    });
  }

  return { approvals, resolved, skipped };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const rows = readSeedRows(args.seedPath);
  const plan = await buildApprovalsFromSeed(knex, rows, { force: args.force });
  const s3 = new S3Client({
    credentials: fromEnv(),
    region: process.env.AWS_REGION,
  });

  const result = await applyVenuePhotoMaintenancePlan(knex, {
    approvals: plan.approvals,
    execute: args.execute,
    s3,
  });

  const outputPath = ensureOutputPath(args.output, args.execute);
  const output = {
    execute: args.execute,
    force: args.force,
    seed_path: args.seedPath,
    plan,
    result,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(args.execute ? 'Venue image seed executed.' : 'Venue image seed preview complete.');
  console.log(`Result: ${outputPath}`);
  console.log(JSON.stringify({
    seed_rows: rows.length,
    planned_existing_profile_updates: plan.approvals.venue_photo_updates.length,
    planned_shell_creates: plan.approvals.shell_venues.length,
    plan_skipped: plan.skipped.length,
    venues_updated: result.venues_updated.length,
    shell_venues_created: result.shell_venues_created.length,
    apply_skipped: result.skipped.length,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('Venue image seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
