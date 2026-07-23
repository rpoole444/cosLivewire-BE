const shouldUseLegacyOwnerFallback = ({ profileType, activeArtistProfileCount }) => {
  const normalizedType = profileType || 'artist';
  return normalizedType === 'artist' && Number(activeArtistProfileCount) === 1;
};

module.exports = { shouldUseLegacyOwnerFallback };
