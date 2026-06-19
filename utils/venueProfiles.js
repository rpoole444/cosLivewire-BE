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

const findVenueProfileIdByInput = async (
  db,
  { venueProfileId, venueName } = {}
) => {
  const requestedId = parseVenueProfileId(venueProfileId);
  if (requestedId) {
    const venue = await db('artists')
      .select('id')
      .where({ id: requestedId, profile_type: 'venue' })
      .whereNull('deleted_at')
      .first();
    if (venue) return venue.id;
  }

  const normalizedName = normalizeVenueName(venueName);
  if (!normalizedName) return null;

  const venue = await db('artists')
    .select('id')
    .where({ profile_type: 'venue' })
    .whereNull('deleted_at')
    .whereRaw('LOWER(TRIM(display_name)) = ?', [normalizedName])
    .orderBy('is_approved', 'desc')
    .orderBy('updated_at', 'desc')
    .first();

  return venue?.id || null;
};

module.exports = {
  findVenueProfileIdByInput,
  normalizeVenueName,
  parseVenueProfileId,
};
