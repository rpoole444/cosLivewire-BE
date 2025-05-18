const express = require('express');
const router = express.Router();
const Artist = require('../models/Artist');

// GET /api/artists/:slug — get public artist profile
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const artistWithEvents = await Artist.findBySlugWithEvents(slug);
    if (!artistWithEvents) {
      return res.status(404).json({ message: 'Artist not found' });
    }

    res.json(artistWithEvents);
  } catch (err) {
    console.error('Error fetching artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/artists — create artist profile
router.post('/', async (req, res) => {
  const {
    display_name,
    bio,
    contact_email,
    profile_image,
    genres,
    slug: customSlug
  } = req.body;

  const user_id = req.user?.id; // use from session, not frontend

  if (!user_id || !display_name) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const slug = customSlug
    ? customSlug.toLowerCase().replace(/\s+/g, '-')
    : display_name.toLowerCase().replace(/\s+/g, '-');

  try {
    const existing = await Artist.findBySlug(slug);
    if (existing) {
      return res.status(409).json({ message: 'That slug is already taken' });
    }

    const newArtist = await Artist.create({
      user_id,
      display_name: display_name.trim(),
      bio,
      contact_email,
      profile_image,
      genres,
      slug
    });

    res.status(201).json(newArtist);
  } catch (err) {
    console.error('Error creating artist:', err);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;
