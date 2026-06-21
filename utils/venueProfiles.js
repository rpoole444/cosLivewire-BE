const normalizeVenueName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

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

  return venue || null;
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
  parseVenueProfileId,
};
