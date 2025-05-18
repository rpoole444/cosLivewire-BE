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
artistRouter.post('/', upload.single('profile_image'), async (req, res) => {
  if (!req.isAuthenticated?.()) return res.status(401).json({ message: 'Unauthorized' });

  const {
    display_name,
    bio,
    contact_email,
    genres,
    slug: customSlug
  } = req.body;

  const user_id = req.user?.id;
  if (!user_id || !display_name) return res.status(400).json({ message: 'Missing required fields' });

  const slug = customSlug ? customSlug.toLowerCase().replace(/\s+/g, '-') : display_name.toLowerCase().replace(/\s+/g, '-');

  try {
    const exists = await Artist.findBySlug(slug);
    if (exists) return res.status(409).json({ message: 'That slug is already taken' });

    const profileImageUrl = req.file ? req.file.location : null;
    const newArtist = await Artist.create({
      user_id,
      display_name: display_name.trim(),
      bio,
      contact_email,
      profile_image: profileImageUrl,
      genres: Array.isArray(genres) ? genres : JSON.parse(genres),
      slug,
    });

    res.status(201).json(newArtist);
  } catch (err) {
    console.error('Error creating artist:', err);
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
artistRouter.put('/:slug', upload.single('profile_image'), async (req, res) => {
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
      genres: Array.isArray(req.body.genres) ? req.body.genres : JSON.parse(req.body.genres),
    };

    // Optional new profile image
    if (req.file) {
      updatedFields.profile_image = req.file.location;
    }

    const updated = await Artist.update(slug, updatedFields);
    res.json(updated);
  } catch (err) {
    console.error('Error updating artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = artistRouter;
