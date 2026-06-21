const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const crypto = require('crypto');
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');
const { ensureAuth } = require('../middleware/auth')
const isAdmin = require('../utils/isAdmin');
const artistRouter = express.Router();
const Artist = require('../models/Artist');
const {
  recalcListingForUser,
  getArtistAccessState,
  hasProAccess,
  communityArtistAccessIsActive,
} = require('../utils/access');
const { computeProActive } = require('../utils/proState');
const { normalizeRegion } = require('../utils/regions');
const { sendBookingInquiryEmail, sendVenueBookingRequestEmail } = require('../models/mailer');

const MAX_EMBED_URL_LENGTH = 2000;
const EMBED_FIELDS = ['embed_youtube', 'embed_soundcloud', 'embed_bandcamp'];
const PROFILE_TYPES = new Set(['artist', 'venue', 'promoter']);
const ANALYTICS_EVENT_TYPES = new Set([
  'profile_view',
  'embed_view',
  'website_click',
  'tip_click',
  'ticket_click',
  'contact_click',
  'booking_inquiry',
]);

const normalizeProfileType = (value) =>
  PROFILE_TYPES.has(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'artist';

const canManageProfile = (profile, user) => (
  !!profile && !!user && (profile.user_id === user.id || user.is_admin)
);

const parseOptionalCapacity = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const cleanOptionalText = (value, maxLength = 3000) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const venuePacketFieldsFromBody = (body, isVenue) => ({
  venue_stage_size: isVenue ? cleanOptionalText(body.venue_stage_size, 160) : null,
  venue_pa_details: isVenue ? cleanOptionalText(body.venue_pa_details) : null,
  venue_backline: isVenue ? cleanOptionalText(body.venue_backline) : null,
  venue_load_in: isVenue ? cleanOptionalText(body.venue_load_in) : null,
  venue_parking: isVenue ? cleanOptionalText(body.venue_parking) : null,
  venue_green_room: isVenue ? cleanOptionalText(body.venue_green_room) : null,
  venue_sound_contact: isVenue ? cleanOptionalText(body.venue_sound_contact, 255) : null,
  venue_booking_policy: isVenue ? cleanOptionalText(body.venue_booking_policy) : null,
});

const hashIp = (ip = '') => {
  const salt = process.env.ANALYTICS_SALT || process.env.SESSION_SECRET || 'dev-analytics-salt';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
};

const isValidEmail = (value = '') =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => cb(null, `artists/${uuidv4()}-${file.originalname}`),
  }),
});

// GET all public artist profiles
artistRouter.get('/public-list', async (req, res) => {
  try {
    const artists = await Artist.findAllPublic({
      includeUnlisted: communityArtistAccessIsActive(),
    });
    const shaped = artists.map((artist) => {
      const access_state = getArtistAccessState({
        is_pro: artist.user_is_pro,
        trial_ends_at: artist.user_trial_ends_at,
        pro_cancelled_at: artist.user_pro_cancelled_at,
        stripe_customer_id: artist.user_stripe_customer_id,
      });

      return {
        id: artist.id,
        display_name: artist.display_name,
        slug: artist.slug,
        profile_image: artist.profile_image,
        genres: artist.genres,
        bio: artist.bio,
        profile_type: artist.profile_type || 'artist',
        home_region: artist.home_region,
        venue_city: artist.venue_city,
        venue_state: artist.venue_state,
        is_pro: artist.user_is_pro,
        trial_ends_at: artist.user_trial_ends_at,
        pro_cancelled_at: artist.user_pro_cancelled_at,
        access_state,
      };
    });
    res.json(shaped);
  } catch (err) {
    console.error('Error fetching public artist list:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.get('/admin/options', isAdmin, async (req, res) => {
  try {
    const profiles = await knex('artists')
      .select('id', 'display_name', 'slug', 'profile_type', 'home_region', 'venue_city', 'venue_state')
      .where({ is_approved: true })
      .whereNull('deleted_at')
      .orderBy('profile_type')
      .orderBy('display_name');

    return res.json(profiles.map((profile) => ({
      ...profile,
      profile_type: profile.profile_type || 'artist',
    })));
  } catch (err) {
    console.error('Error fetching admin profile options:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/artists/pending
artistRouter.get('/pending', async (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?.is_admin) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    const pendingArtists = await knex('artists')
      .where({ is_approved: false })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');

    console.log('Pending artists fetched:', pendingArtists.length, pendingArtists.map(a => a.slug));

    res.json(pendingArtists);
  } catch (err) {
    console.error('Error fetching pending artists:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/artists/mine
artistRouter.get('/mine', ensureAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.passport?.user;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const activeArtists = await knex('artists')
      .where({ user_id: userId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');

    const deletedArtists = await knex('artists')
      .where({ user_id: userId })
      .whereNotNull('deleted_at')
      .orderBy('deleted_at', 'desc')
      .orderBy('id', 'desc');

    const activeArtist = activeArtists[0] || null;
    const deletedArtist = deletedArtists[0] || null;
    const canRestore = deletedArtists.length > 0;

    return res.json({
      artist: activeArtist,
      profiles: activeArtists,
      profileCount: activeArtists.length,
      deletedArtist,
      deletedProfiles: deletedArtists,
      canRestore,
    });
  } catch (e) {
    console.error('GET /api/artists/mine error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Get signed URL for private media files
artistRouter.get('/:slug/media/:field', async (req, res) => {
  const { slug, field } = req.params;
  const allowed = ['press_kit', 'promo_photo', 'stage_plot'];
  if (!allowed.includes(field)) {
    return res.status(400).json({ message: 'Invalid media type' });
  }

  try {
    const artist = await Artist.findBySlug(slug);
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const fileUrl = artist[field];
    if (!fileUrl) return res.status(404).json({ message: 'File not found' });

    const isOwnerOrAdmin =
      req.isAuthenticated?.() &&
      (req.user?.id === artist.user_id || req.user?.is_admin);

    if (!artist.is_approved && !isOwnerOrAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const key = fileUrl.split('.amazonaws.com/')[1];
    if (!key) {
      return res.status(500).json({ message: 'Invalid file location' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('Error fetching media file:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/artists/trial/start — start (or reuse) a user trial
artistRouter.post('/trial/start', ensureAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await knex('users').first('is_pro', 'trial_ends_at').where({ id: userId });
    const now = new Date();

    if (user?.is_pro) {
      return res.status(200).json({ ok: true, reason: 'already_pro' });
    }

    const hasActiveTrial = !!user?.trial_ends_at && new Date(user.trial_ends_at) > now;
    if (hasActiveTrial) {
      return res.status(200).json({ ok: true, reason: 'trial_active', trial_ends_at: user.trial_ends_at });
    }

    const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await knex.transaction(async trx => {
      await trx('users')
        .where({ id: userId })
        .update({ trial_ends_at: endsAt, updated_at: new Date() });

      await trx('artists')
        .where({ user_id: userId })
        .whereNull('deleted_at')
        .update({ trial_active: true, updated_at: new Date() });
    });

    // Recalc after commit so reads see committed state
    await recalcListingForUser(userId);

    return res.status(200).json({ ok: true, trial_ends_at: endsAt.toISOString() });
  } catch (e) {
    console.error('POST /api/artists/trial/start error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Public, minimal event feed for artist schedule embeds.
artistRouter.get('/:slug/schedule', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 12)
      : 5;
    const mode = req.query.mode === 'top-picks' ? 'top-picks' : 'upcoming';
    const schedule = await Artist.findPublicScheduleBySlug(req.params.slug, limit, { mode });

    if (!schedule) {
      return res.status(404).json({ message: 'Artist schedule not found' });
    }

    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    return res.json(schedule);
  } catch (err) {
    console.error('Error fetching public artist schedule:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.get('/:slug/top-picks', ensureAuth, async (req, res) => {
  try {
    const artist = await Artist.findBySlug(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Profile not found' });
    if (!canManageProfile(artist, req.user)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const manageList = await Artist.findTopPicksManageListBySlug(req.params.slug);
    if (!manageList) return res.status(404).json({ message: 'Profile not found' });

    return res.json(manageList);
  } catch (err) {
    console.error('Error fetching profile top picks:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.put('/:slug/top-picks', ensureAuth, async (req, res) => {
  try {
    const artist = await Artist.findBySlug(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Profile not found' });
    if (!canManageProfile(artist, req.user)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const eventIds = Array.isArray(req.body?.event_ids)
      ? req.body.event_ids
          .map((id) => Number.parseInt(id, 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];

    const uniqueEventIds = [...new Set(eventIds)].slice(0, 24);
    const manageList = await Artist.findTopPicksManageListBySlug(req.params.slug);
    if (!manageList) return res.status(404).json({ message: 'Profile not found' });

    const allowedIds = new Set(manageList.events.map((event) => Number(event.id)));
    const selectedIds = uniqueEventIds.filter((id) => allowedIds.has(id));

    await knex.transaction(async (trx) => {
      await trx('profile_featured_events')
        .where({ profile_id: artist.id })
        .del();

      if (selectedIds.length) {
        await trx('profile_featured_events').insert(
          selectedIds.map((eventId, index) => ({
            profile_id: artist.id,
            event_id: eventId,
            featured_order: index,
            updated_at: trx.fn.now(),
          }))
        );
      }
    });

    const updated = await Artist.findTopPicksManageListBySlug(req.params.slug);
    return res.json(updated);
  } catch (err) {
    console.error('Error saving profile top picks:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.post('/:slug/track', async (req, res) => {
  try {
    const artist = await Artist.findBySlug(req.params.slug);
    if (!artist || !artist.is_approved) {
      return res.status(404).json({ message: 'Artist profile not found' });
    }

    const eventType = String(req.body?.event_type || '').trim();
    if (!ANALYTICS_EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ message: 'Invalid analytics event type' });
    }

    const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
      ? req.body.metadata
      : null;
    const requestedEventId = Number.parseInt(req.body?.event_id, 10);

    await knex('artist_analytics_events').insert({
      artist_id: artist.id,
      event_type: eventType,
      event_id: Number.isFinite(requestedEventId) ? requestedEventId : null,
      source: req.body?.source ? String(req.body.source).slice(0, 64) : null,
      referrer: req.get('referer') ? String(req.get('referer')).slice(0, 512) : null,
      user_agent: req.get('user-agent') ? String(req.get('user-agent')).slice(0, 512) : null,
      ip_hash: hashIp(req.ip || req.headers['x-forwarded-for'] || ''),
      metadata,
    });

    return res.status(204).send();
  } catch (err) {
    console.error('Artist analytics tracking error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.get('/:slug/analytics', ensureAuth, async (req, res) => {
  try {
    const artist = await Artist.findBySlug(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const isOwner = artist.user_id === req.user?.id;
    if (!isOwner && !req.user?.is_admin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await knex('artist_analytics_events')
      .select('event_type')
      .count({ count: '*' })
      .where({ artist_id: artist.id })
      .where('created_at', '>=', since)
      .groupBy('event_type');

    const counts = Object.fromEntries(Array.from(ANALYTICS_EVENT_TYPES).map((type) => [type, 0]));
    rows.forEach((row) => {
      counts[row.event_type] = Number(row.count || 0);
    });

    return res.json({
      artist_id: artist.id,
      window_days: 30,
      counts,
    });
  } catch (err) {
    console.error('Artist analytics summary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.post('/:slug/inquiry', async (req, res) => {
  try {
    const artist = await Artist.findBySlug(req.params.slug);
    if (!artist || !artist.is_approved) {
      return res.status(404).json({ message: 'Artist profile not found' });
    }

    const inquiry = {
      name: String(req.body?.name || '').trim(),
      email: String(req.body?.email || '').trim(),
      date: String(req.body?.date || '').trim(),
      eventName: String(req.body?.eventName || '').trim(),
      budget: String(req.body?.budget || '').trim(),
      notes: String(req.body?.notes || '').trim(),
    };

    if (!inquiry.name || !isValidEmail(inquiry.email)) {
      return res.status(400).json({ message: 'Name and a valid email are required.' });
    }

    if (inquiry.notes.length > 3000 || inquiry.eventName.length > 500 || inquiry.budget.length > 120) {
      return res.status(400).json({ message: 'Inquiry is too long.' });
    }

    await sendBookingInquiryEmail({ artist, inquiry });
    await knex('artist_analytics_events').insert({
      artist_id: artist.id,
      event_type: 'booking_inquiry',
      source: 'profile',
      referrer: req.get('referer') ? String(req.get('referer')).slice(0, 512) : null,
      user_agent: req.get('user-agent') ? String(req.get('user-agent')).slice(0, 512) : null,
      ip_hash: hashIp(req.ip || req.headers['x-forwarded-for'] || ''),
      metadata: { has_date: Boolean(inquiry.date), has_budget: Boolean(inquiry.budget) },
    });

    return res.json({ message: 'Inquiry sent.' });
  } catch (err) {
    console.error('Booking inquiry error:', err);
    return res.status(500).json({ message: 'Unable to send inquiry right now.' });
  }
});

artistRouter.post('/:slug/venue-booking-request', async (req, res) => {
  try {
    const venue = await Artist.findBySlug(req.params.slug);
    if (!venue || !venue.is_approved || venue.profile_type !== 'venue') {
      return res.status(404).json({ message: 'Venue profile not found' });
    }

    const inquiry = {
      artistName: String(req.body?.artistName || '').trim(),
      email: String(req.body?.email || '').trim(),
      genre: String(req.body?.genre || '').trim(),
      drawEstimate: String(req.body?.drawEstimate || '').trim(),
      links: String(req.body?.links || '').trim(),
      preferredDates: String(req.body?.preferredDates || '').trim(),
      supportNeeds: String(req.body?.supportNeeds || '').trim(),
      notes: String(req.body?.notes || '').trim(),
    };

    if (!inquiry.artistName || !isValidEmail(inquiry.email)) {
      return res.status(400).json({ message: 'Artist name and a valid email are required.' });
    }

    const tooLong = [
      inquiry.genre,
      inquiry.drawEstimate,
      inquiry.links,
      inquiry.preferredDates,
      inquiry.supportNeeds,
      inquiry.notes,
    ].some((value) => value.length > 3000);

    if (tooLong) {
      return res.status(400).json({ message: 'Booking request is too long.' });
    }

    await sendVenueBookingRequestEmail({ venue, inquiry });
    await knex('artist_analytics_events').insert({
      artist_id: venue.id,
      event_type: 'booking_inquiry',
      source: 'venue_booking_request',
      referrer: req.get('referer') ? String(req.get('referer')).slice(0, 512) : null,
      user_agent: req.get('user-agent') ? String(req.get('user-agent')).slice(0, 512) : null,
      ip_hash: hashIp(req.ip || req.headers['x-forwarded-for'] || ''),
      metadata: {
        has_preferred_dates: Boolean(inquiry.preferredDates),
        has_draw_estimate: Boolean(inquiry.drawEstimate),
      },
    });

    return res.json({ message: 'Booking request sent.' });
  } catch (err) {
    console.error('Venue booking request error:', err);
    return res.status(500).json({ message: 'Unable to send booking request right now.' });
  }
});


// GET artist by slug (public-facing profile)
artistRouter.get('/:slug', async (req, res) => {
  try {
    const artist = await Artist.findBySlugWithEvents(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    // Fetch trial info from user table
    const user = await knex('users')
      .select('is_pro', 'trial_ends_at', 'pro_cancelled_at', 'stripe_customer_id')
      .where({ id: artist.user_id })
      .first();

    if (!user) {
      return res.status(500).json({ message: 'User associated with artist not found' });
    }

    // Only show unapproved profiles to owners or admins
    const isOwner =
      req.isAuthenticated?.() && req.user?.id === artist.user_id;
    const isOwnerOrAdmin = isOwner || (req.isAuthenticated?.() && req.user?.is_admin);
    if (!artist.is_approved && !isOwnerOrAdmin) {
      return res.status(403).json({ message: 'Artist pending approval' });
    }

    const access_state = getArtistAccessState({
      is_pro: user.is_pro,
      trial_ends_at: user.trial_ends_at,
      pro_cancelled_at: user.pro_cancelled_at,
      stripe_customer_id: user.stripe_customer_id,
    });

    const enrichedArtist = {
      ...artist,
      is_pro: user.is_pro,
      trial_ends_at: user.trial_ends_at,
      pro_cancelled_at: user.pro_cancelled_at,
      access_state,
      is_owner: !!isOwner,
    };

    res.json(enrichedArtist);
  } catch (err) {
    console.error('Error fetching artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// POST create artist profile
artistRouter.post(
  '/',
  upload.fields([
    { name: 'profile_image' },
    { name: 'promo_photo' },
    { name: 'stage_plot' },
    { name: 'press_kit' },
  ]),
  async (req, res) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

    const {
      display_name, bio, contact_email, genres, slug: customSlug,
      embed_youtube, embed_soundcloud, embed_bandcamp, tip_jar_url,
      website, profile_type, venue_address, venue_city, venue_state,
      venue_postal_code, venue_phone, booking_email, venue_capacity, age_policy,
      venue_stage_size, venue_pa_details, venue_backline, venue_load_in,
      venue_parking, venue_green_room, venue_sound_contact, venue_booking_policy,
      home_region
    } = req.body;

    const user_id = req.user?.id;
    const normalizedProfileType = normalizeProfileType(profile_type);
    const isVenueProfile = normalizedProfileType === 'venue';
    const slug = (customSlug || display_name || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-');

    const files = req.files;

     // 🔒 Minimal validation → return 400, not 500
      if (!display_name || !contact_email) {
        return res.status(400).json({ message: 'Display name and contact email are required.' });
      }
      if (!files?.profile_image?.[0]) {
        return res.status(400).json({ message: 'Please upload a profile image.' });
      }
      if (isVenueProfile && (!venue_address || !venue_city)) {
        return res.status(400).json({ message: 'Venue address and city are required.' });
      }

    try {
      const genresValue = Array.isArray(genres) ? genres : JSON.parse(genres || '[]');

      const profilePayload = {
        user_id,
        display_name: (display_name || '').trim(),
        bio,
        contact_email,
        genres: genresValue,
        slug,
        profile_image: files?.profile_image?.[0]?.location || null,
        promo_photo: files?.promo_photo?.[0]?.location || null,
        stage_plot: files?.stage_plot?.[0]?.location || null,
        press_kit: files?.press_kit?.[0]?.location || null,
        embed_youtube,
        embed_soundcloud,
        embed_bandcamp,
        tip_jar_url,
        website,
        profile_type: normalizedProfileType,
        home_region: normalizeRegion(home_region),
        venue_address: isVenueProfile ? venue_address : null,
        venue_city: isVenueProfile ? venue_city : null,
        venue_state: isVenueProfile ? venue_state : null,
        venue_postal_code: isVenueProfile ? venue_postal_code : null,
        venue_phone: isVenueProfile ? venue_phone : null,
        booking_email: isVenueProfile ? (booking_email || contact_email) : null,
        venue_capacity: isVenueProfile ? parseOptionalCapacity(venue_capacity) : null,
        age_policy: isVenueProfile ? age_policy : null,
        ...venuePacketFieldsFromBody({
          venue_stage_size,
          venue_pa_details,
          venue_backline,
          venue_load_in,
          venue_parking,
          venue_green_room,
          venue_sound_contact,
          venue_booking_policy,
        }, isVenueProfile),
        // Draft flags
        is_listed: false,
        is_approved: false,
        // keep whatever columns you already have; do NOT flip is_pro/trial here
      };

      // 1) Slug collision check. If this is the user's own hidden draft,
      // update it instead of forcing a fake URL like "venue-name-2".
      let newArtist;
      const existingWithSlug = await knex('artists').where({ slug }).first();
      if (existingWithSlug) {
        const reusableOwnDraft =
          existingWithSlug.user_id === user_id &&
          !existingWithSlug.is_approved &&
          !existingWithSlug.is_listed &&
          !existingWithSlug.deleted_at;

        if (!reusableOwnDraft) {
          return res.status(409).json({
            message: `${isVenueProfile ? 'A venue' : 'An artist'} with that slug already exists`,
          });
        }

        [newArtist] = await knex('artists')
          .where({ id: existingWithSlug.id })
          .update({
            ...profilePayload,
            updated_at: new Date(),
          })
          .returning('*');
      } else {
        // 2) Create NEW draft (no auto-pro, no auto-trial)
        newArtist = await Artist.create(profilePayload);
      }

      try {
        const user = await knex('users').where({ id: user_id }).first();
        if (user) {
          const proActive = computeProActive(user);
          await knex('artists')
            .where({ id: newArtist.id })
            .update({
              is_pro: proActive,
              trial_active: !proActive,
              updated_at: new Date(),
            });
          console.log(
            '[artist-signup] synced artist flags for user=',
            user.email,
            'artistId=',
            newArtist.id,
            'proActive=',
            proActive
          );
          newArtist.is_pro = proActive;
          newArtist.trial_active = !proActive;
        } else {
          console.warn('[artist-signup] No user found for session id', user_id);
        }
      } catch (syncErr) {
        console.error('[artist-signup] Failed to sync pro state', syncErr);
      }

      return res.status(201).json(newArtist);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          message: `${isVenueProfile ? 'A venue' : 'An artist'} with that slug already exists`,
        });
      }
      console.error('Create artist error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }
);


artistRouter.get('/user/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const artist = await Artist.findByUserId(id);
    if (!artist) {
      return res.status(404).json({ message: 'No artist profile found for user' });
    }
    res.json(artist);
  } catch (err) {
    console.error('Error fetching artist by user ID:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/artists/:slug — update artist profile
artistRouter.put('/:slug', upload.fields([
    { name: 'profile_image', maxCount: 1 },
    { name: 'promo_photo', maxCount: 1 },
    { name: 'stage_plot', maxCount: 1 },
    { name: 'press_kit', maxCount: 1 },
  ]),
  async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const { slug } = req.params;
  const artist = await Artist.findBySlug(slug);
  if (!artist) return res.status(404).json({ message: 'Artist not found' });

  // Ownership check
  if (artist.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const access = await hasProAccess(artist.user_id);
  if (!access) {
    return res.status(403).json({ message: 'Artist profile access required to edit this profile.' });
  }

  try {
    const normalizedProfileType = normalizeProfileType(req.body.profile_type || artist.profile_type);
    const isVenueProfile = normalizedProfileType === 'venue';
    const updatedFields = {
      display_name: req.body.display_name,
      bio: req.body.bio,
      contact_email: req.body.contact_email,
      website: req.body.website,
      is_pro: req.body.is_pro === 'true',
      embed_youtube: req.body.embed_youtube,
      embed_soundcloud: req.body.embed_soundcloud,
      embed_bandcamp: req.body.embed_bandcamp,
      tip_jar_url: req.body.tip_jar_url,
      profile_type: normalizedProfileType,
      home_region: normalizeRegion(req.body.home_region || artist.home_region),
      venue_address: isVenueProfile ? cleanOptionalText(req.body.venue_address, 255) : null,
      venue_city: isVenueProfile ? cleanOptionalText(req.body.venue_city, 255) : null,
      venue_state: isVenueProfile ? cleanOptionalText(req.body.venue_state, 64) : null,
      venue_postal_code: isVenueProfile ? cleanOptionalText(req.body.venue_postal_code, 20) : null,
      venue_phone: isVenueProfile ? cleanOptionalText(req.body.venue_phone, 40) : null,
      booking_email: isVenueProfile ? cleanOptionalText(req.body.booking_email || req.body.contact_email, 255) : null,
      venue_capacity: isVenueProfile ? parseOptionalCapacity(req.body.venue_capacity) : null,
      age_policy: isVenueProfile ? cleanOptionalText(req.body.age_policy, 80) : null,
      ...venuePacketFieldsFromBody(req.body, isVenueProfile),
      genres: (() => {
        const raw = req.body.genres;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw);
          } catch (e) {
            return raw.split(',').map(g => g.trim());
          }
        }
        return [];
      })(),
    };

    if (
      updatedFields.profile_type === 'venue' &&
      (!updatedFields.venue_address || !updatedFields.venue_city)
    ) {
      return res.status(400).json({ message: 'Venue address and city are required.' });
    }

    const tooLongField = EMBED_FIELDS.find((field) => {
      const value = updatedFields[field];
      return typeof value === 'string' && value.length > MAX_EMBED_URL_LENGTH;
    });

    if (tooLongField) {
      return res.status(400).json({
        message: 'Embed URLs must be 2000 characters or fewer.',
        field: tooLongField,
      });
    }
    
    
    // Optional file updates
    if (req.files?.profile_image?.[0]) {
      updatedFields.profile_image = req.files.profile_image[0].location;
    }
    if (req.files?.promo_photo?.[0]) {
      updatedFields.promo_photo = req.files.promo_photo[0].location;
    }
    if (req.files?.stage_plot?.[0]) {
      updatedFields.stage_plot = req.files.stage_plot[0].location;
    }
    if (req.files?.press_kit?.[0]) {
      updatedFields.press_kit = req.files.press_kit[0].location;
    }
    

    try {
      const updated = await Artist.update(slug, updatedFields);
      res.json(updated);
    } catch (err) {
      // Postgres 22001 => value too long for column; surface a helpful message.
      if (err?.code === '22001') {
        return res
          .status(400)
          .json({ message: 'One of the embed URLs is too long for the database.' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error updating artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.delete('/:slug', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const { slug } = req.params;
  const artist = await Artist.findBySlug(slug);

  if (!artist) return res.status(404).json({ message: 'Artist not found' });

  if (artist.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    const timestamp = new Date();
    await knex('artists')
      .where({ slug })
      .update({ 
        deleted_at: timestamp ,
        is_listed: false,
        is_approved: false,
        updated_at: timestamp
      });
      recalcListingForUser(artist.user_id)
    res.status(200).json({ message: 'Artist soft-deleted' });
  } catch (err) {
    console.error('Soft delete error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
artistRouter.put('/by-user/:userId/restore', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const { userId } = req.params;
const isOwner = Number(userId) === req.user?.id;
    if (!isOwner && !req.user?.is_admin) {
      return res.status(403).json({ message: 'Forbidden' });
    }
  try {
    const artist = await knex('artists')
      .where({ user_id: userId })
      .whereNotNull('deleted_at')
      .first();

    if (!artist) return res.status(404).json({ message: 'No deleted artist profile found for user.' });

    const timestamp = new Date();
    const [restored] = await knex('artists')
      .where({ id: artist.id })
      .update({ deleted_at: null, updated_at: timestamp })
      .returning('*');

   await recalcListingForUser(restored.user_id);

    res.json(restored);
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// PUT /api/artists/:id/restore — restore soft-deleted artist profile
artistRouter.put('/:id/restore', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const { id } = req.params;

  try {
 const artist = await knex('artists').where({ id }).first(); 
  if (!artist) return res.status(404).json({ message: 'Artist not found' });
    const isOwner = artist.user_id === req.user?.id;
    if (!isOwner && !req.user?.is_admin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const restored = await Artist.restore(id);
    if (!restored) {
      return res.status(404).json({ message: 'Artist not found' });
    }
    await recalcListingForUser(restored.user_id);
    res.json(restored);
  } catch (err) {
    console.error('Restore artist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/artists/:id/approve
artistRouter.put('/:id/approve', async (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?.is_admin) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const { id } = req.params;

  try {
    const artist = await knex('artists').where({ id }).first();
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const access = await hasProAccess(artist.user_id);

    const [updated] = await knex('artists')
      .where({ id })
      .update({
        is_approved: true,
        is_listed: access,
        updated_at: new Date(),
      })
      .returning('*');
    await recalcListingForUser(updated.user_id);

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to approve artist.' });
  }
});

// PUT /api/artists/:id/decline
artistRouter.put('/:id/decline', async (req, res) => {
  if (!req.isAuthenticated?.() || !req.user?.is_admin) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const { id } = req.params;

  try {
    const [updated] = await knex('artists')
      .where({ id })
      .update({
        is_approved: false,
        is_listed: false,               // ← unlist when declined
        updated_at: new Date(),
      })
      .returning('*');
    await recalcListingForUser(updated.user_id);

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to decline artist.' });
  }
});


// Admin-only toggle for listing status (explicit control)
artistRouter.put('/:id/listing', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_listed } = req.body;

  try {
    const [updated] = await knex('artists')
      .where({ id })
      .update({ is_listed: !!is_listed, updated_at: new Date() })
      .returning('*');

    if (!updated) return res.status(404).json({ message: 'Artist not found' });
    res.json(updated);
  } catch (err) {
    console.error('Admin listing toggle error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/artists/:id/publish
artistRouter.put('/:id/publish', ensureAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const artist = await knex('artists').where({ id }).first();
    if (!artist) return res.status(404).json({ message: 'Artist not found' });
    if (artist.user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const access = await hasProAccess(artist.user_id);
    if (!access) return res.status(402).json({ message: 'Artist profile access required' });

    const [updated] = await knex('artists')
      .where({ id })
      .update({ is_listed: true, updated_at: new Date() })
      .returning('*');

    res.json(updated);
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Owner/Admin: unpublish (sets is_listed = false)
artistRouter.put('/:id/unpublish', ensureAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const artist = await knex('artists').where({ id }).first();
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const isOwner = artist.user_id === req.user?.id;
    const canAdmin = !!req.user?.is_admin;
    if (!isOwner && !canAdmin) return res.status(403).json({ message: 'Forbidden' });

    const [updated] = await knex('artists')
      .where({ id })
      .update({ is_listed: false, updated_at: new Date() })
      .returning('*');

    res.json(updated);
  } catch (err) {
    console.error('Unpublish error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = artistRouter;
