function isInTrial(trialEndsAt) {
  if (!trialEndsAt) return true;
  return new Date() <= new Date(trialEndsAt);
}
module.exports = isInTrial;
