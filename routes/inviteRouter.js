const express = require('express');
const knex = require('../db/knex');
const { ensureAuth } = require('../middleware/auth');
const { findInviteByCode, markInviteUsed } = require('../models/Invite');
const { findUserById } = require('../models/User');

const inviteRouter = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS) || 30;

inviteRouter.post('/claim', ensureAuth, async (req, res) => {
  try {
    const inviteCode = req.body?.inviteCode || req.body?.code;
    if (!inviteCode || typeof inviteCode !== 'string') {
      return res.status(400).json({ message: 'Invite code is required.' });
    }

    const normalizedCode = inviteCode.trim();
    if (!normalizedCode) {
      return res.status(400).json({ message: 'Invite code is required.' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }

    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const invite = await findInviteByCode(normalizedCode);
    if (!invite) {
      return res.status(404).json({ message: 'Invite not found or invalid.' });
    }
    if (invite.is_active === false) {
      return res.status(400).json({ message: 'This invite is no longer active.' });
    }
    if (
      invite.max_uses !== null &&
      typeof invite.max_uses !== 'undefined' &&
      invite.used_count >= invite.max_uses
    ) {
      return res.status(400).json({ message: 'This invite has already been used up.' });
    }

    if (user.is_pro) {
      return res.status(400).json({ message: 'You already have Pro access.' });
    }

    const now = new Date();
    const existingTrialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const baseDate = existingTrialEnd && existingTrialEnd > now ? existingTrialEnd : now;

    const trialDays = invite.trial_days || DEFAULT_TRIAL_DAYS;
    const newTrialEndsAt = new Date(baseDate.getTime() + trialDays * DAY_MS);

    await knex('users')
      .where({ id: user.id })
      .update({
        trial_active: true,
        trial_ends_at: newTrialEndsAt,
        pro_cancelled_at: null,
        updated_at: knex.fn.now(),
      });

    await markInviteUsed(invite.id);

    console.log('[invite.claim] user', user.id, 'claimed', invite.code);

    return res.status(200).json({
      success: true,
      trial_active: true,
      trial_ends_at: newTrialEndsAt.toISOString(),
      trial_days: trialDays,
    });
  } catch (error) {
    console.error('[invite.claim] error', error);
    return res.status(500).json({ message: 'Failed to claim invite.' });
  }
});

module.exports = inviteRouter;
