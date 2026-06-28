const assert = require('assert');
const {
  buildImportBatchSummaryEmailHtml,
  buildProfileCreatedEmailHtml,
  escapeHtml,
} = require('../models/mailer');

assert.strictEqual(
  escapeHtml('<script>alert("x")</script>'),
  '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
);

const batchHtml = buildImportBatchSummaryEmailHtml({
  batch: { source: 'moondog', source_name: 'Moondog Weekly Calendar' },
  sourceLabel: 'Provided by Moondog',
  submittedBy: 'Mike',
  promotedEvents: [
    {
      title: 'Jazz Night',
      venue_name: 'Dazzle',
      date: '2026-07-04',
      start_time: '19:30:00',
      region: 'denver',
      slug: 'jazz-night',
    },
  ],
  skippedEvents: [
    {
      title: 'Duplicate Show',
      venue_name: 'Dazzle',
      reason: 'Duplicate existing event',
    },
  ],
});

assert(batchHtml.includes('1 event accepted'));
assert(batchHtml.includes('Moondog Weekly Calendar'));
assert(batchHtml.includes('Jazz Night'));
assert(batchHtml.includes('Duplicate Show'));
assert(batchHtml.includes('/eventRouter/jazz-night'));

const profileHtml = buildProfileCreatedEmailHtml({
  profile: {
    display_name: 'Poole and the Gang',
    profile_type: 'artist',
    slug: 'poole-and-the-gang',
    contact_email: 'poole@example.com',
    is_approved: false,
  },
  user: { email: 'poole@example.com' },
});

assert(profileHtml.includes('Your artist profile was created'));
assert(profileHtml.includes('Poole and the Gang'));
assert(profileHtml.includes('Pending admin review'));
assert(profileHtml.includes('/UserProfile'));

console.log('mailer template tests passed.');
