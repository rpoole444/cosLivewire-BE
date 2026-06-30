const normalizeVenueName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeVenueLookupName = (value) =>
  normalizeVenueName(value)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/\band\b/g, ' ')
    .replace(/\bpark\b/g, ' ')
    .replace(/\bamphitheatre\b/g, 'amphitheater')
    .replace(/\bamphitheater\b/g, ' ')
    .replace(/\bvenue\b/g, ' ')
    .replace(/\bcolorado\b/g, ' ')
    .replace(/\bco\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const GENERIC_SHARED_NAME_TOKENS = new Set([
  'auditorium',
  'bar',
  'boulder',
  'cafe',
  'city',
  'club',
  'colorado',
  'denver',
  'downtown',
  'downstairs',
  'hall',
  'hotel',
  'lounge',
  'music',
  'park',
  'pavilion',
  'piano',
  'pueblo',
  'room',
  'saloon',
  'springs',
  'stage',
  'theater',
  'theatre',
  'upstairs',
  'venue',
]);

const getDistinctiveSharedLeadToken = (left, right) => {
  const leftTokens = left.split(' ').filter(Boolean);
  const rightTokens = right.split(' ').filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return null;

  const sharedTokens = leftTokens.filter((token) => rightTokens.includes(token));
  return sharedTokens.find((token) => (
    token.length >= 5 &&
    !GENERIC_SHARED_NAME_TOKENS.has(token) &&
    (token === leftTokens[0] || token === rightTokens[0])
  )) || null;
};

const venueNamesMatch = (left, right) => {
  const normalizedLeft = normalizeVenueLookupName(left);
  const normalizedRight = normalizeVenueLookupName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft) ||
    Boolean(getDistinctiveSharedLeadToken(normalizedLeft, normalizedRight))
  );
};

const parseVenueProfileId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const findVenueProfileByInput = async (
  db,
  { venueProfileId, venueName } = {}
) => {
  const requestedId = parseVenueProfileId(venueProfileId);
  if (requestedId) {
    const venue = await db('artists')
      .select('id', 'display_name', 'profile_image', 'website', 'venue_address', 'venue_city', 'home_region')
      .where({ id: requestedId, profile_type: 'venue' })
      .whereNull('deleted_at')
      .first();
    if (venue) return venue;
  }

  const normalizedName = normalizeVenueName(venueName);
  if (!normalizedName) return null;

  const venue = await db('artists')
    .select('id', 'display_name', 'profile_image', 'website', 'venue_address', 'venue_city', 'home_region')
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at')
    .whereRaw('LOWER(TRIM(display_name)) = ?', [normalizedName])
    .orderBy('is_approved', 'desc')
    .orderBy('updated_at', 'desc')
    .first();

  if (venue) return venue;

  const venues = await db('artists')
    .select('id', 'display_name', 'profile_image', 'website', 'venue_address', 'venue_city', 'home_region', 'is_approved', 'updated_at')
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at')
    .orderBy('is_approved', 'desc')
    .orderBy('updated_at', 'desc');

  return venues.find((candidate) => venueNamesMatch(normalizedName, candidate.display_name)) || null;
};

const findVenueProfileIdByInput = async (
  db,
  { venueProfileId, venueName } = {}
) => {
  const venue = await findVenueProfileByInput(db, { venueProfileId, venueName });
  return venue?.id || null;
};

module.exports = {
  findVenueProfileByInput,
  findVenueProfileIdByInput,
  normalizeVenueName,
  normalizeVenueLookupName,
  parseVenueProfileId,
  venueNamesMatch,
};
