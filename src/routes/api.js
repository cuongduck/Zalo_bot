'use strict';

const express = require('express');
const Bot = require('../models/bot');
const Log = require('../models/log');
const { apiFor } = require('../services/botManager');

const router = express.Router();

/**
 * Public outbound send API.
 *
 * External systems (n8n, your app, alerting, etc.) call this to make a bot send
 * a Zalo message to a user/group. Authenticated with the bot's secret token
 * (same value shown on the bot's Webhook tab) via header
 * `X-Bot-Api-Secret-Token` or `?secret=` query.
 *
 *   POST {APP_BASE_URL}/api/bots/:id/send
 *   Body (JSON): { "chat_id": "...", "text": "...", "photo": "https://...", "caption": "..." }
 *
 * - `text`  -> sendMessage
 * - `photo` -> sendPhoto (URL of a public image), optional `caption`
 * - both    -> sends text, then the photo
 */
async function authBot(req, res) {
  const botId = parseInt(req.params.id, 10);
  if (!botId) {
    res.status(404).json({ ok: false, error: 'bot not found' });
    return null;
  }
  let bot;
  try {
    bot = await Bot.findById(botId);
  } catch {
    res.status(500).json({ ok: false, error: 'server error' });
    return null;
  }
  if (!bot) {
    res.status(404).json({ ok: false, error: 'bot not found' });
    return null;
  }
  const provided =
    req.get('X-Bot-Api-Secret-Token') ||
    req.get('X-Webhook-Secret') ||
    (req.get('Authorization') || '').replace(/^Bearer\s+/i, '') ||
    req.query.secret;
  if (!provided || provided !== bot.webhook_secret) {
    res.status(401).json({ ok: false, error: 'invalid secret token' });
    return null;
  }
  if (bot.status !== 'active') {
    res.status(409).json({ ok: false, error: 'bot is not active' });
    return null;
  }
  return bot;
}

async function handleSend(req, res) {
  const bot = await authBot(req, res);
  if (!bot) return;

  const { chat_id, text, photo, caption } = req.body || {};
  if (!chat_id) return res.status(400).json({ ok: false, error: 'chat_id is required' });
  if (!text && !photo) return res.status(400).json({ ok: false, error: 'text or photo is required' });

  const api = apiFor(bot);
  const results = {};
  try {
    if (text) {
      results.message = await api.sendMessage(chat_id, text);
      await Log.add(bot.id, { direction: 'out', event_type: 'api:text', chat_id, content: text, raw: results.message });
    }
    if (photo) {
      results.photo = await api.sendPhoto(chat_id, photo, { caption });
      await Log.add(bot.id, { direction: 'out', event_type: 'api:photo', chat_id, content: photo + (caption ? ' | ' + caption : ''), raw: results.photo });
    }
    res.json({ ok: true, result: results });
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: 'api:send', chat_id, content: err.message });
    res.status(502).json({ ok: false, error: err.message });
  }
}

// `/send` and the Zalo-style `/sendMessage` alias share one handler.
router.post('/api/bots/:id/send', express.json({ limit: '2mb' }), handleSend);
router.post('/api/bots/:id/sendMessage', express.json({ limit: '2mb' }), handleSend);

module.exports = router;
