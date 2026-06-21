require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
});

const fs = require('fs');
const path = require('path');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const { buildVenuePhotoDryRunReport } = require('../utils/venuePhotoMaintenance');

const DEFAULT_FILE_PATHS = [
  '/Users/reidpoole/Downloads/pikespeakcenterlogo.avif',
  '/Users/reidpoole/Downloads/Phil Long Music Hall Logo.svg',
  '/Users/reidpoole/Downloads/Boulder Theater Logo.webp',
  '/Users/reidpoole/Downloads/Mission Ballroom Schedule.webp',
  '/Users/reidpoole/Downloads/240859455_10158396796295976_9171849917896898466_n.jpg',
  '/Users/reidpoole/Downloads/282131803_372136374951002_2660293495078733075_n.jpg',
  '/Users/reidpoole/Downloads/RedRocks Logo.png',
  '/Users/reidpoole/Downloads/Ford Amphitheater hero-logo.png',
  '/Users/reidpoole/Downloads/Dazzle Logo.webp',
  '/Users/reidpoole/Downloads/Nocturne Logo.webp',
  '/Users/reidpoole/Downloads/Mining Exchange Logo.jpg',
  '/Users/reidpoole/Downloads/Black Sheep Logo.jpg',
  '/Users/reidpoole/Downloads/441353614_948342760625149_3500635560579635335_n.jpg',
  '/Users/reidpoole/Downloads/Tokki Logo.png',
];

const parseArgs = (argv) => {
  const args = {
    files: [],
    output: null,
    eventLimit: 250,
    includeMissingFiles: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file' || arg === '--files') {
      const next = argv[index + 1] || '';
      args.files.push(...next.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if (arg === '--output') {
      args.output = argv[index + 1] || null;
      index += 1;
    } else if (arg === '--event-limit') {
      args.eventLimit = Number(argv[index + 1]) || args.eventLimit;
      index += 1;
    } else if (arg === '--include-missing-files') {
      args.includeMissingFiles = true;
    }
  }

  return args;
};

const ensureReportPath = (requestedPath) => {
  if (requestedPath) return path.resolve(requestedPath);
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(reportsDir, `venue-photo-dry-run-${stamp}.json`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const requestedFiles = args.files.length ? args.files : DEFAULT_FILE_PATHS;
  const filePaths = requestedFiles.filter((filePath) => {
    if (args.includeMissingFiles) return true;
    return fs.existsSync(filePath);
  });
  const missingFiles = requestedFiles.filter((filePath) => !fs.existsSync(filePath));

  const report = await buildVenuePhotoDryRunReport(knex, {
    filePaths,
    eventLimit: args.eventLimit,
  });

  report.input = {
    requested_file_count: requestedFiles.length,
    existing_file_count: filePaths.length,
    missing_files: missingFiles,
  };

  const outputPath = ensureReportPath(args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Venue photo dry-run complete.');
  console.log(`Report: ${outputPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
  if (missingFiles.length) {
    console.log(`Skipped ${missingFiles.length} missing file(s). Use --include-missing-files to include them in the report.`);
  }
};

main()
  .catch((error) => {
    console.error('Venue photo dry-run failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
