const assert = require('assert');
const {
  extractS3Key,
  imageFileFilter,
  profileFileFilter,
  safeFileName,
} = require('../utils/uploadPolicy');

assert.strictEqual(safeFileName('../../A poster (final).PNG'), 'A-poster-final.png');
assert.strictEqual(
  extractS3Key('https://bucket.s3.us-west-2.amazonaws.com/events/a%20poster.png'),
  'events/a poster.png'
);

const runFilter = (filter, file) => new Promise((resolve) => {
  filter({}, file, (error, accepted) => resolve({ error, accepted }));
});

(async () => {
  let result = await runFilter(imageFileFilter, { fieldname: 'poster', mimetype: 'image/webp' });
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.accepted, true);

  result = await runFilter(imageFileFilter, { fieldname: 'poster', mimetype: 'text/html' });
  assert.strictEqual(result.error.status, 400);

  result = await runFilter(profileFileFilter, { fieldname: 'press_kit', mimetype: 'application/pdf' });
  assert.strictEqual(result.error, null);

  result = await runFilter(profileFileFilter, { fieldname: 'profile_image', mimetype: 'application/pdf' });
  assert.strictEqual(result.error.status, 400);

  console.log('uploadPolicy tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
