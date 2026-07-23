const ALWAYS_PRIVATE_PROFILE_FIELDS = [
  'stripe_customer_id',
  'shell_created_by_user_id',
];

const LOGGED_OUT_PRIVATE_VENUE_FIELDS = [
  'venue_load_in',
  'venue_parking',
  'venue_green_room',
  'venue_booking_policy',
];

const profileResponseForUser = (profile, user) => {
  if (!profile) return profile;
  const response = { ...profile };
  ALWAYS_PRIVATE_PROFILE_FIELDS.forEach((field) => delete response[field]);

  if (!user) {
    LOGGED_OUT_PRIVATE_VENUE_FIELDS.forEach((field) => delete response[field]);
  }

  return response;
};

module.exports = { profileResponseForUser };
