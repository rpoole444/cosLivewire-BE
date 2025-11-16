function computeProActive(user, now = new Date()) {
  if (!user || !user.is_pro) {
    return false;
  }

  if (!user.pro_cancelled_at) {
    return true;
  }

  const cancelAt = new Date(user.pro_cancelled_at);
  if (isNaN(cancelAt.getTime())) {
    return false;
  }

  return cancelAt.getTime() > now.getTime();
}

module.exports = {
  computeProActive,
};
