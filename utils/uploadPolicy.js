const path = require('path');

const IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const PDF_MIME_TYPES = new Set(['application/pdf']);

const safeFileName = (originalName = 'upload') => {
  const extension = path.extname(String(originalName)).toLowerCase().slice(0, 12);
  const baseName = path.basename(String(originalName), path.extname(String(originalName)))
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'upload';
  return `${baseName}${extension}`;
};

const uploadError = (message) => {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_UPLOAD_TYPE';
  return error;
};

const imageFileFilter = (req, file, callback) => {
  if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
    return callback(uploadError('Upload a JPG, PNG, WebP, AVIF, or GIF image.'));
  }
  return callback(null, true);
};

const profileFileFilter = (req, file, callback) => {
  const acceptsDocument = file.fieldname === 'stage_plot' || file.fieldname === 'press_kit';
  if (IMAGE_MIME_TYPES.has(file.mimetype) || (acceptsDocument && PDF_MIME_TYPES.has(file.mimetype))) {
    return callback(null, true);
  }
  return callback(uploadError(
    acceptsDocument
      ? 'Stage plots and press kits must be a supported image or PDF.'
      : 'Profile and promo photos must be JPG, PNG, WebP, AVIF, or GIF images.'
  ));
};

const extractS3Key = (url) => {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return String(url).replace(/^\/+/, '') || null;
  }
};

module.exports = {
  extractS3Key,
  imageFileFilter,
  profileFileFilter,
  safeFileName,
};
