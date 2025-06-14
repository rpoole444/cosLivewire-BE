const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);

const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');
const isInTrial = require('../utils/isInTrial');
const isAdmin = require('../utils/isAdmin');
const artistRouter = express.Router();
const Artist = require('../models/Artist');

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
    const artists = await Artist.findAllPublic();
    res.json(artists);
  } catch (err) {
    console.error('Error fetching public artist list:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
artistRouter.get('/pending', async (req, res) => {
  try {
    const pendingArtists = await knex('artists')
      .where({ is_approved: false })
      .whereNull('deleted_at');

    console.log('Pending artists fetched:', pendingArtists.length, pendingArtists.map(a => a.slug));

    res.json(pendingArtists);
  } catch (err) {
    console.error('Error fetching pending artists:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// GET artist by slug (public-facing profile)
artistRouter.get('/:slug', async (req, res) => {
  try {
    const artist = await Artist.findBySlugWithEvents(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    // Only show unapproved profiles to owners or admins
    const isOwnerOrAdmin =
      req.isAuthenticated?.() &&
      (req.user?.id === artist.user_id || req.user?.is_admin);
    if (!artist.is_approved && !isOwnerOrAdmin) {
      return res.status(403).json({ message: 'Artist pending approval' });
    }

    res.json(artist);
  } catch (err) {
    console.error('Error fetching artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST create artist profile
artistRouter.post('/', upload.fields([
  { name: 'profile_image' },
  { name: 'promo_photo' },
  { name: 'stage_plot' },
  { name: 'press_kit' },
]), async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const {
    display_name, bio, contact_email, genres, slug: customSlug,
    embed_youtube, embed_soundcloud, embed_bandcamp,tip_jar_url,
    website, is_pro
  } = req.body;

  const user_id = req.user?.id;
  const slug = customSlug ? customSlug.toLowerCase().replace(/\s+/g, '-') : display_name.toLowerCase().replace(/\s+/g, '-');

  try {
    const exists = await Artist.slugExists(slug);
    if (exists) {
      return res.status(409).json({ message: 'An artist with that slug already exists' });
    }

    const files = req.files;

    const newArtist = await Artist.create({
      user_id,
      display_name: display_name.trim(),
      bio,
      contact_email,
      genres: Array.isArray(genres) ? genres : JSON.parse(genres),
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
      is_pro: true, // Always start as pro during trial
      trial_active: true,
      trial_start_date: new Date()
    });
    
const existingUser = await knex('users').where({ id: user_id }).first();

if (!existingUser.trial_ends_at) {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30); // 30-day trial

  await knex('users')
    .where({ id: user_id })
    .update({ trial_ends_at: trialEndsAt });
}
    res.status(201).json(newArtist);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'An artist with that slug already exists' });
    }
    console.error('Create artist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


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

  if (!isInTrial(req.user.trial_ends_at, req.user.is_pro)) {
    return res.status(403).json({ message: 'Trial expired. Upgrade to edit your profile.' });
  }

  try {
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
      genres: Array.isArray(req.body.genres) ? req.body.genres : JSON.parse(req.body.genres),
    };
    
    // Optional file updates
    if (req.file) {
      updatedFields.profile_image = req.file.location;
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
    

    const updated = await Artist.update(slug, updatedFields);
    res.json(updated);
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
    await knex('artists')
      .where({ slug })
      .update({ deleted_at: new Date() });

    res.status(200).json({ message: 'Artist soft-deleted' });
  } catch (err) {
    console.error('Soft delete error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
artistRouter.put('/by-user/:userId/restore', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const { userId } = req.params;

  try {
    const artist = await knex('artists')
      .where({ user_id: userId })
      .andWhere('deleted_at', 'is not', null)
      .first();

    if (!artist) return res.status(404).json({ message: 'No deleted artist profile found for user.' });

    const [restored] = await knex('artists')
      .where({ id: artist.id })
      .update({ deleted_at: null })
      .returning('*');

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
    const restored = await Artist.restore(id);
    if (!restored) {
      return res.status(404).json({ message: 'Artist not found' });
    }
    res.json(restored);
  } catch (err) {
    console.error('Restore artist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

artistRouter.put('/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [updated] = await knex('artists')
      .where({ id })
      .update({ is_approved: true })
      .returning('*');

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to approve artist.' });
  }
});

artistRouter.put('/:id/decline', isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [updated] = await knex('artists')
      .where({ id })
      .update({ is_approved: false })
      .returning('*');

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to decline artist.' });
  }
});


module.exports = artistRouter;
