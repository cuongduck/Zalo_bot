'use strict';

const express = require('express');
const Bot = require('../models/bot');
const Log = require('../models/log');
const Trigger = require('../models/trigger');
const { apiFor, runTrigger, executeTrigger } = require('../services/botManager');

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
    // Make rejected calls visible in the Logs tab — otherwise a caller that
    // forgets the secret header looks like "nothing arrived" to the user.
    Log.add(bot.id, {
      direction: 'error',
      event_type: 'api:rejected',
      content:
        `POST ${req.originalUrl} bị từ chối (401): ` +
        (provided ? 'secret token KHÔNG khớp.' : 'THIẾU secret token.') +
        ` Gửi kèm header "X-Bot-Api-Secret-Token: <secret>" hoặc thêm "?secret=<secret>" vào URL.` +
        ` Headers nhận được: ${Object.keys(req.headers).join(', ')}`,
    }).catch(() => {});
    res.status(401).json({
      ok: false,
      error: 'invalid secret token',
      hint: 'Gửi header X-Bot-Api-Secret-Token hoặc thêm ?secret=<secret> vào URL.',
    });
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

/**
 * External webhook trigger. Accepts an arbitrary JSON payload and runs the
 * bot's trigger_code (sandboxed) so you can transform it and send Zalo
 * messages. The code reads `ctx.payload` and calls ctx.send / ctx.sendPhoto.
 *
 *   POST {APP_BASE_URL}/api/bots/:id/trigger
 *   Header: X-Bot-Api-Secret-Token: <bot secret>
 *   Body:   any JSON (object or array)
 */
router.post('/api/bots/:id/trigger', express.json({ limit: '4mb' }), async (req, res) => {
  const bot = await authBot(req, res);
  if (!bot) return;

  // Always record the incoming webhook first, so it is visible in the Logs tab
  // even if trigger handling is disabled or the code later errors.
  let bodyStr;
  try {
    bodyStr = JSON.stringify(req.body);
  } catch {
    bodyStr = String(req.body);
  }
  await Log.add(bot.id, {
    direction: 'in',
    event_type: 'trigger:received',
    content: bodyStr ? bodyStr.slice(0, 3000) : '(empty body)',
    raw: req.body,
  });

  if (!bot.trigger_enabled || !bot.trigger_code || !bot.trigger_code.trim()) {
    await Log.add(bot.id, {
      direction: 'system',
      event_type: 'trigger',
      content: 'Đã nhận webhook nhưng Trigger code chưa bật/đang trống — không xử lý.',
    });
    return res
      .status(200)
      .json({ ok: true, processed: false, message: 'Webhook nhận được nhưng trigger code chưa bật.' });
  }

  try {
    const out = await runTrigger(bot, req.body, bot.trigger_code);
    res.json({ ok: true, processed: true, logs: out.logs, result: out.returned ?? null });
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: 'trigger', chat_id: null, content: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Named trigger endpoint — one URL & handler per external source.
 *   POST {APP_BASE_URL}/api/bots/:id/trigger/:slug
 */
router.post('/api/bots/:id/trigger/:slug', express.json({ limit: '4mb' }), async (req, res) => {
  // Load bot + trigger first: the secret check is per-trigger (require_secret).
  const botId = parseInt(req.params.id, 10);
  const bot = botId ? await Bot.findById(botId).catch(() => null) : null;
  if (!bot) return res.status(404).json({ ok: false, error: 'bot not found' });
  if (bot.status !== 'active') return res.status(409).json({ ok: false, error: 'bot is not active' });

  const trigger = await Trigger.findBySlug(bot.id, req.params.slug);

  if (!trigger || trigger.require_secret !== 0) {
    const provided =
      req.get('X-Bot-Api-Secret-Token') ||
      req.get('X-Webhook-Secret') ||
      (req.get('Authorization') || '').replace(/^Bearer\s+/i, '') ||
      req.query.secret;
    if (!provided || provided !== bot.webhook_secret) {
      Log.add(bot.id, {
        direction: 'error',
        event_type: 'api:rejected',
        content:
          `POST ${req.originalUrl} bị từ chối (401): ` +
          (provided ? 'secret token KHÔNG khớp.' : 'THIẾU secret token.') +
          ` Gửi header "X-Bot-Api-Secret-Token" / thêm "?secret=..." vào URL,` +
          ` hoặc tắt "Yêu cầu secret" trong cấu hình webhook này.`,
      }).catch(() => {});
      return res.status(401).json({
        ok: false,
        error: 'invalid secret token',
        hint: 'Gửi header X-Bot-Api-Secret-Token, thêm ?secret=<secret> vào URL, hoặc tắt "Yêu cầu secret" cho webhook này.',
      });
    }
  }

  let bodyStr;
  try {
    bodyStr = JSON.stringify(req.body);
  } catch {
    bodyStr = String(req.body);
  }
  await Log.add(bot.id, {
    direction: 'in',
    event_type: 'trigger:' + req.params.slug,
    content: (bodyStr ? bodyStr.slice(0, 3000) : '(empty body)'),
    raw: req.body,
  });

  if (!trigger) {
    return res.status(404).json({ ok: false, error: `Không tìm thấy webhook "${req.params.slug}".` });
  }
  const hasHandler = trigger.mode === 'template'
    ? !!(trigger.template && trigger.template.trim() && trigger.target_chat_id)
    : !!(trigger.code && trigger.code.trim());
  if (!trigger.enabled || !hasHandler) {
    await Log.add(bot.id, { direction: 'system', event_type: 'trigger:' + req.params.slug,
      content: `Webhook "${trigger.name}" đã nhận nhưng đang tắt/chưa cấu hình — không xử lý.` });
    return res.status(200).json({ ok: true, processed: false, message: 'Webhook đang tắt hoặc chưa cấu hình.' });
  }
  try {
    const out = await executeTrigger(bot, req.body, trigger);
    res.json({ ok: true, processed: true, trigger: trigger.slug, logs: out.logs, result: out.returned ?? null });
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: 'trigger:' + req.params.slug, content: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
