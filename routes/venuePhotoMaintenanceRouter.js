const express = require('express');
const { S3Client } = require('@aws-sdk/client-s3');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const environment = process.env.NODE_ENV || 'development';
const config = require('../knexfile')[environment];
const knex = require('knex')(config);
const {
  applyVenuePhotoMaintenancePlan,
  buildVenuePhotoDryRunReport,
} = require('../utils/venuePhotoMaintenance');

const venuePhotoMaintenanceRouter = express.Router();
const s3 = new S3Client({
  credentials: fromEnv(),
  region: process.env.AWS_REGION,
});

const parseFilePaths = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(parseFilePaths);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

venuePhotoMaintenanceRouter.get('/dry-run', async (req, res) => {
  try {
    const filePaths = parseFilePaths(req.query.files || req.query.file);
    const eventLimit = Math.min(Math.max(Number(req.query.eventLimit) || 250, 1), 1000);
    const report = await buildVenuePhotoDryRunReport(knex, { filePaths, eventLimit });
    return res.json(report);
  } catch (error) {
    console.error('Venue photo dry-run failed:', error);
    return res.status(500).json({ message: 'Unable to generate venue photo dry-run report.' });
  }
});

venuePhotoMaintenanceRouter.post('/apply', async (req, res) => {
  try {
    const execute = req.body?.execute === true;
    const approvals = req.body?.approvals || {};
    const result = await applyVenuePhotoMaintenancePlan(knex, {
      approvals,
      execute,
      s3,
      actorUserId: req.user?.id || null,
    });
    return res.json(result);
  } catch (error) {
    console.error('Venue photo apply failed:', error);
    return res.status(500).json({ message: 'Unable to apply venue photo maintenance plan.' });
  }
});

module.exports = venuePhotoMaintenanceRouter;
