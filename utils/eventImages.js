const DEFAULT_EVENT_IMAGE_URL = 'https://app.alpinegrooveguide.com/alpine-groove-social-cover.png';

const EMPTY_IMAGE_VALUES = new Set([
  '',
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
]);

const DEFAULT_IMAGE_MARKERS = [
  '/images/event-placeholder.png',
  'event-placeholder.png',
  'alpine-groove-social-cover.png',
  'alpine_groove_guide_icon.png',
  'alpine_groove_guide_favicon.png',
];

const DIRECT_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'svg',
]);

const NON_IMAGE_HOST_PATTERNS = [
  /(^|\.)eventbrite\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.me$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)ticketmaster\.com$/i,
  /(^|\.)ticketsauce\.com$/i,
  /(^|\.)bandsintown\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)docs\.google\.com$/i,
  /(^|\.)drive\.google\.com$/i,
];

const cleanImageUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (EMPTY_IMAGE_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
};

const isDefaultImage = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return DEFAULT_IMAGE_MARKERS.some((marker) => normalized.includes(marker));
};

const hasDirectImageExtension = (pathname) => {
  const extension = String(pathname || '')
    .split('/')
    .pop()
    ?.split('.')
    .pop()
    ?.toLowerCase();
  return Boolean(extension && DIRECT_IMAGE_EXTENSIONS.has(extension));
};

const isLikelyDirectImageUrl = (value) => {
  const cleaned = cleanImageUrl(value);
  if (!cleaned) return false;

  if (cleaned.startsWith('/')) {
    return hasDirectImageExtension(cleaned);
  }

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (NON_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) return false;
  return hasDirectImageExtension(parsed.pathname);
};

const isUsableImageValue = (value, { allowDefault = false } = {}) => {
  const cleaned = cleanImageUrl(value);
  if (!cleaned) return false;
  if (!allowDefault && isDefaultImage(cleaned)) return false;
  return isLikelyDirectImageUrl(cleaned);
};

const resolveEventImage = (event = {}) => {
  const poster = cleanImageUrl(event.poster);
  const venueImage = cleanImageUrl(
    event.venue_profile_image ||
    event.venue_profile_image_url ||
    event.venue_image ||
    event.profile_image
  );
  const sourceImage = cleanImageUrl(
    event.source_image_url ||
    event.source_image ||
    event.import_source_image ||
    event.source_profile_image
  );

  if (isUsableImageValue(poster)) {
    return {
      display_image_url: poster,
      display_image_source: 'event_poster',
      event_poster_status: 'valid',
    };
  }

  if (isUsableImageValue(venueImage)) {
    return {
      display_image_url: venueImage,
      display_image_source: 'venue_profile_image',
      event_poster_status: poster ? 'default_or_invalid' : 'missing',
    };
  }

  if (isUsableImageValue(sourceImage, { allowDefault: true })) {
    return {
      display_image_url: sourceImage,
      display_image_source: 'source_image',
      event_poster_status: poster ? 'default_or_invalid' : 'missing',
    };
  }

  return {
    display_image_url: DEFAULT_EVENT_IMAGE_URL,
    display_image_source: 'default',
    event_poster_status: poster ? 'default_or_invalid' : 'missing',
  };
};

const attachEventImageFields = (event) => {
  if (!event) return event;
  return {
    ...event,
    ...resolveEventImage(event),
  };
};

const attachEventImageFieldsToMany = (events = []) => events.map(attachEventImageFields);

module.exports = {
  DEFAULT_EVENT_IMAGE_URL,
  attachEventImageFields,
  attachEventImageFieldsToMany,
  cleanImageUrl,
  isDefaultImage,
  isLikelyDirectImageUrl,
  isUsableImageValue,
  resolveEventImage,
};
