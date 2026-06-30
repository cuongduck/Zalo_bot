'use strict';

const express = require('express');
const Bot = require('../models/bot');
const Log = require('../models/log');
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

  // Verify secret token. Accept any of the header names Zalo / clients may use,
  // plus a ?secret= query fallback.
  const provided =
    req.get('X-Bot-Api-Secret-Token') ||
    req.get('X-Zalo-Bot-Api-Secret-Token') ||
    req.get('X-Secret-Token') ||
    req.get('X-Webhook-Secret') ||
    req.query.secret;

  if (!provided || provided !== bot.webhook_secret) {
    // Log rejected attempts so they are visible in the Logs tab. This is the
    // key diagnostic: if you see these, Zalo IS reaching the app but the secret
    // header name/value differs from what we expect. The header list tells us
    // exactly which header Zalo used so the check can be adjusted.
    Log.add(botId, {
      direction: 'error',
      event_type: 'webhook_rejected',
      content:
        `POST nhận được nhưng secret không khớp/thiếu. ` +
        `secret_received=${provided ? 'có' : 'không'}. ` +
        `Headers gửi tới: ${Object.keys(req.headers).join(', ')}`,
      raw: req.headers,
    }).catch(() => {});
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
