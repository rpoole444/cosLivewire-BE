const sameId = (left, right) => {
  if (left == null || right == null) return false;
  return Number(left) === Number(right);
};

const canEditEvent = (event, user) => {
  if (!event || !user) return false;
  if (user.is_admin) return true;
  if (sameId(event.user_id, user.id)) return true;
  if (sameId(event.venue_profile_user_id, user.id)) return true;
  return sameId(event.claimed_artist_user_id, user.id)
    || sameId(event.claimed_artist?.user_id, user.id);
};

const isApprovedEvent = (event) => event?.is_approved === true;

const PRIVATE_EVENT_FIELDS = [
  'user',
  'user_id',
  'user_email',
  'user_first_name',
  'user_last_name',
  'claimed_by_user_id',
  'claimed_by_user_email',
  'claimed_artist_user_id',
  'venue_profile_user_id',
  'last_edited_by_user_id',
  'venue_matched_by',
  'data_quality_reviewed_by',
];

const eventResponseForUser = (event, user, extra = {}) => {
  if (!event) return event;

  const canManage = canEditEvent(event, user);
  const response = {
    ...event,
    claimed_artist: event.claimed_artist ? { ...event.claimed_artist } : null,
    can_edit_event: canManage,
    can_delete_event: canManage,
    ...extra,
  };

  if (!canManage) {
    PRIVATE_EVENT_FIELDS.forEach((field) => delete response[field]);
    if (response.claimed_artist) {
      delete response.claimed_artist.user_id;
    }
  }

  return response;
};

module.exports = {
  canEditEvent,
  eventResponseForUser,
  isApprovedEvent,
  sameId,
};
