
function isInTrial(trialEndsAt, isPro = false) {
  if (isPro) return true;
  if (!trialEndsAt) return true;
  return new Date() <= new Date(trialEndsAt);
}

module.exports = isInTrial;

