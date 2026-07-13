const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'at',
  'in',
  'of',
]);

const VENUE_SUFFIX_WORDS = new Set([
  'amphitheater',
  'amphitheatre',
  'auditorium',
  'bar',
  'ballroom',
  'cafe',
  'center',
  'centre',
  'club',
  'hall',
  'hotel',
  'lounge',
  'music',
  'pavilion',
  'piano',
  'room',
  'saloon',
  'stage',
  'theater',
  'theatre',
  'venue',
]);

const normalizeEntityName = (value, { removeVenueSuffixes = false } = {}) => {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/\bamphitheatre\b/g, 'amphitheater')
    .replace(/\btheatre\b/g, 'theater')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!removeVenueSuffixes) return normalized;

  return normalized
    .split(' ')
    .filter((token) => token && !VENUE_SUFFIX_WORDS.has(token))
    .join(' ')
    .trim();
};

const tokensFor = (value, options = {}) => (
  normalizeEntityName(value, options)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
);

const tokenSimilarity = (left, right, options = {}) => {
  const a = new Set(tokensFor(left, options));
  const b = new Set(tokensFor(right, options));
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });

  const jaccard = intersection / (a.size + b.size - intersection);
  const coverage = intersection / Math.min(a.size, b.size);
  return Math.max(jaccard, coverage >= 1 ? 0.94 : coverage);
};

const confidenceFromScore = (score) => {
  if (score >= 0.98) return 'exact';
  if (score >= 0.86) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
};

const sameRegionOrUnknown = (left, right) => {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  return !a || !b || a === b;
};

const sameCityOrUnknown = (left, right) => {
  const a = normalizeEntityName(left);
  const b = normalizeEntityName(right);
  return !a || !b || a === b;
};

module.exports = {
  confidenceFromScore,
  normalizeEntityName,
  sameCityOrUnknown,
  sameRegionOrUnknown,
  tokenSimilarity,
};
