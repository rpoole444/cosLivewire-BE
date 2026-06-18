const REGION_ALL = 'all-front-range';
const DEFAULT_REGION = 'colorado-springs';

const REGIONS = [
  { label: 'Colorado Springs', slug: 'colorado-springs' },
  { label: 'Pueblo Area', slug: 'pueblo-area' },
  { label: 'Trinidad / Walsenburg / Cañon City', slug: 'southern-colorado' },
  { label: 'Castle Rock', slug: 'castle-rock' },
  { label: 'Denver', slug: 'denver' },
  { label: 'Boulder', slug: 'boulder' },
  { label: 'Fort Collins', slug: 'fort-collins' },
  { label: 'Greeley', slug: 'greeley' },
  { label: 'Other Front Range', slug: 'other-front-range' },
];

const REGION_SLUGS = new Set(REGIONS.map((region) => region.slug));

const normalizeRegion = (value, fallback = DEFAULT_REGION) => {
  const slug = String(value || '').trim().toLowerCase();
  if (REGION_SLUGS.has(slug)) return slug;
  return fallback;
};

const getRegionLabel = (slug) => (
  REGIONS.find((region) => region.slug === slug)?.label || ''
);

const inferRegionFromText = (...values) => {
  const text = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!text.trim()) return DEFAULT_REGION;
  if (text.includes('pueblo')) return 'pueblo-area';
  if (
    text.includes('trinidad') ||
    text.includes('walsenburg') ||
    text.includes('canon city') ||
    text.includes('cañon city')
  ) {
    return 'southern-colorado';
  }
  if (text.includes('castle rock')) return 'castle-rock';
  if (text.includes('denver')) return 'denver';
  if (text.includes('boulder')) return 'boulder';
  if (text.includes('fort collins')) return 'fort-collins';
  if (text.includes('greeley')) return 'greeley';
  if (
    text.includes('colorado springs') ||
    text.includes('manitou') ||
    text.includes('monument') ||
    text.includes('fountain') ||
    text.includes('woodland park')
  ) {
    return 'colorado-springs';
  }

  return 'other-front-range';
};

module.exports = {
  REGION_ALL,
  DEFAULT_REGION,
  REGIONS,
  REGION_SLUGS,
  normalizeRegion,
  getRegionLabel,
  inferRegionFromText,
};
