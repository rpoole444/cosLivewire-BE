// utils/slugify.js
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace spaces/special chars with dashes
    .replace(/(^-|-$)+/g, '');   // Remove starting/ending dashes
}

module.exports = slugify;

