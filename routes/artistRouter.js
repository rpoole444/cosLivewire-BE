const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { v4: uuidv4 } = require('uuid');
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

// GET artist by slug (public-facing profile)
artistRouter.get('/:slug', async (req, res) => {
  try {
    const artist = await Artist.findBySlugWithEvents(req.params.slug);
    if (!artist) return res.status(404).json({ message: 'Artist not found' });
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
    embed_youtube, embed_soundcloud, embed_bandcamp, website, is_pro
  } = req.body;

  const user_id = req.user?.id;
  const slug = customSlug ? customSlug.toLowerCase().replace(/\s+/g, '-') : display_name.toLowerCase().replace(/\s+/g, '-');

  try {
    const exists = await Artist.findBySlug(slug);
    if (exists) return res.status(409).json({ message: 'Slug is taken' });

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
      website,
      is_pro: is_pro === 'true'
    });

    res.status(201).json(newArtist);
  } catch (err) {
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


module.exports = artistRouter;
