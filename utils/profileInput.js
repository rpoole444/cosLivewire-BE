const parseGenreSelection = (value, maxItems = 3) => {
  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  if (parsed == null || parsed === '') return [];
  if (!Array.isArray(parsed)) return null;

  return parsed
    .filter((genre) => typeof genre === 'string')
    .map((genre) => genre.trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

module.exports = { parseGenreSelection };
