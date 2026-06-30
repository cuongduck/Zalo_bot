'use strict';

const express = require('express');
const Bot = require('../models/bot');
const { handleUpdate } = require('../services/botManager');

const router = express.Router();

/**
 * Public inbound webhook receiver.
 * Zalo is configured to POST updates to:
 *   {APP_BASE_URL}/webhook/:botId
 * with header X-Bot-Api-Secret-Token = bot.webhook_secret
 *
 * We respond 200 immediately and process asynchronously so Zalo does not retry.
 */
// Health/diagnostic for opening the webhook URL in a browser (GET).
// Useful to confirm the domain/reverse-proxy actually reaches this app.
// It does NOT process anything and never reveals the secret.
router.get('/webhook/:botId', (req, res) => {
  res.json({
    ok: true,
    message: 'Zalo webhook endpoint is alive. This endpoint only accepts POST requests from Zalo.',
    bot_id: parseInt(req.params.botId, 10) || null,
  });
});

router.post('/webhook/:botId', express.json({ limit: '2mb' }), async (req, res) => {
  const botId = parseInt(req.params.botId, 10);
  if (!botId) return res.status(404).json({ ok: false });

  let bot;
  try {
    bot = await Bot.findById(botId);
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
  if (!bot) return res.status(404).json({ ok: false });

  // Verify secret token (header or query param fallback).
  const provided = req.get('X-Bot-Api-Secret-Token') || req.query.secret;
  if (!provided || provided !== bot.webhook_secret) {
    return res.status(401).json({ ok: false, error: 'invalid secret token' });
  }

  // Acknowledge immediately, then process.
  res.json({ ok: true });

  const body = req.body || {};
  const updates = Array.isArray(body) ? body : body.updates && Array.isArray(body.updates) ? body.updates : [body];
  for (const u of updates) {
    handleUpdate(bot, u).catch((err) => console.error('[inbound] handleUpdate error:', err.message));
  }
});

module.exports = router;
