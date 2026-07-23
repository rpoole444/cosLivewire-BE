const PUBLIC_USER_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'display_name',
  'email',
  'is_admin',
  'is_pro',
  'trial_active',
  'trial_ends_at',
  'pro_cancelled_at',
  'profile_picture',
  'created_at',
];

const userResponse = (user) => {
  if (!user) return user;
  return PUBLIC_USER_FIELDS.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(user, field)) result[field] = user[field];
    return result;
  }, {});
};

module.exports = { PUBLIC_USER_FIELDS, userResponse };
