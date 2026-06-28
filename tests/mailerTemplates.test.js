const assert = require('assert');
const {
  buildImportBatchSummaryEmailHtml,
  buildProfileCreatedEmailHtml,
  buildProfileReviewedEmailHtml,
  buildEventRejectionEmailHtml,
  buildEventSubmissionDigestEmailHtml,
  buildClaimSubmittedEmailHtml,
  buildClaimReviewedEmailHtml,
  buildNewsletterEmailHtml,
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

const approvedProfileHtml = buildProfileReviewedEmailHtml({
  profile: {
    display_name: 'Dazzle',
    profile_type: 'venue',
    slug: 'dazzle',
  },
  approved: true,
});
assert(approvedProfileHtml.includes('Your venue profile is approved'));
assert(approvedProfileHtml.includes('Dazzle'));

const rejectedEventHtml = buildEventRejectionEmailHtml({
  event: {
    title: 'Incomplete Show',
    date: '2026-07-09',
    venue_name: 'Venue TBA',
  },
  adminNotes: 'Please add a real venue and start time.',
});
assert(rejectedEventHtml.includes('Your event was not approved'));
assert(rejectedEventHtml.includes('Please add a real venue'));

const submissionDigestHtml = buildEventSubmissionDigestEmailHtml({
  user: { email: 'artist@example.com' },
  events: [
    {
      title: 'Batch Show',
      venue_name: 'Lulu’s',
      date: '2026-07-10',
      start_time: '20:00:00',
      slug: 'batch-show',
    },
  ],
});
assert(submissionDigestHtml.includes('1 event is in review'));
assert(submissionDigestHtml.includes('Batch Show'));

const claimSubmittedHtml = buildClaimSubmittedEmailHtml({
  claim: { status: 'pending' },
  event: { title: 'Claimable Show' },
  artist: { display_name: 'Poole and the Gang' },
});
assert(claimSubmittedHtml.includes('Claim request submitted'));
assert(claimSubmittedHtml.includes('Poole and the Gang'));

const claimReviewedHtml = buildClaimReviewedEmailHtml({
  claim: { status: 'approved' },
  event: { title: 'Claimable Show', slug: 'claimable-show' },
  artist: { display_name: 'Poole and the Gang' },
  approved: true,
});
assert(claimReviewedHtml.includes('Claim approved'));
assert(claimReviewedHtml.includes('Improve this listing'));

const newsletterHtml = buildNewsletterEmailHtml({
  subject: 'What is new on Alpine Groove Guide',
  previewText: 'New tools are live.',
  message: 'Artists can claim imported shows.\n\nVenues can manage better listings.',
  unsubscribeUrl: 'https://app.alpinegrooveguide.com/unsubscribe/test-token',
});
assert(newsletterHtml.includes('What is new on Alpine Groove Guide'));
assert(newsletterHtml.includes('Artists can claim imported shows.'));
assert(newsletterHtml.includes('Venues can manage better listings.'));
assert(newsletterHtml.includes('/unsubscribe/test-token'));

console.log('mailer template tests passed.');
