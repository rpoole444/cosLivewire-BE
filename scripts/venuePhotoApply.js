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
const { applyVenuePhotoMaintenancePlan } = require('../utils/venuePhotoMaintenance');

const parseArgs = (argv) => {
  const args = {
    approvalsPath: null,
    output: null,
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--approvals') {
      args.approvalsPath = argv[index + 1] || null;
      index += 1;
    } else if (arg === '--output') {
      args.output = argv[index + 1] || null;
      index += 1;
    } else if (arg === '--execute') {
      args.execute = true;
    }
  }

  return args;
};

const ensureOutputPath = (requestedPath, execute) => {
  if (requestedPath) return path.resolve(requestedPath);
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(reportsDir, `venue-photo-apply-${execute ? 'executed' : 'preview'}-${stamp}.json`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.approvalsPath) {
    throw new Error('Usage: node scripts/venuePhotoApply.js --approvals /path/to/approvals.json [--execute]');
  }

  const approvalsPath = path.resolve(args.approvalsPath);
  const approvals = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'));
  const s3 = new S3Client({
    credentials: fromEnv(),
    region: process.env.AWS_REGION,
  });

  const result = await applyVenuePhotoMaintenancePlan(knex, {
    approvals,
    execute: args.execute,
    s3,
  });

  const outputPath = ensureOutputPath(args.output, args.execute);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

  console.log(args.execute ? 'Venue photo apply executed.' : 'Venue photo apply preview complete.');
  console.log(`Result: ${outputPath}`);
  console.log(JSON.stringify({
    execute: result.execute,
    venues_updated: result.venues_updated.length,
    shell_venues_created: result.shell_venues_created.length,
    events_updated: result.events_updated.length,
    skipped: result.skipped.length,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('Venue photo apply failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
