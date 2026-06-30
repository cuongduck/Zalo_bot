'use strict';

const express = require('express');
const config = require('../config');
const Bot = require('../models/bot');
const Log = require('../models/log');
const Webhook = require('../models/webhook');
const Datasource = require('../models/datasource');
const ZaloBotApi = require('../services/zaloApi');
const { apiFor, sendAndLog } = require('../services/botManager');
const poller = require('../services/poller');
const { requireApproved } = require('../middleware/auth');

const router = express.Router();
router.use(requireApproved);

const isAdmin = (req) => req.user.role === 'admin';

const DEFAULT_CODE = `// Ví dụ: trả lời tin nhắn, gọi AI và truy vấn database
const text = (ctx.message.text || '').trim();

if (text.toLowerCase() === 'ping') {
  return 'pong 🏓';
}

// Truy vấn dữ liệu từ kết nối tên "main" (cấu hình ở mục Dữ liệu)
// const rows = await ctx.db('main', 'SELECT name FROM products WHERE id = ?', [1]);
// if (rows.length) return 'Sản phẩm: ' + rows[0].name;

// Mặc định: nhờ AI Gemini trả lời
return await ctx.ai(text);`;

async function loadBot(req, res, next) {
  const bot = await Bot.findByIdForUser(parseInt(req.params.id, 10), req.user.id, isAdmin(req));
  if (!bot) {
    req.flash('error', 'Không tìm thấy bot.');
    return res.redirect('/bots');
  }
  req.bot = bot;
  next();
}

// --- List & create ---
router.get('/bots', async (req, res) => {
  const bots = await Bot.listForUser(req.user.id);
  res.render('bots/list', { title: 'Bot của tôi', bots });
});

router.post('/bots', async (req, res) => {
  const { name, token, mode } = req.body;
  try {
    if (!name || !token) throw new Error('Cần nhập tên và token bot.');
    const bot = await Bot.create({
      user_id: req.user.id,
      name: name.trim(),
      token: token.trim(),
      mode: ['webhook', 'polling', 'off'].includes(mode) ? mode : 'webhook',
    });
    // Try to verify token via getMe.
    try {
      const me = await apiFor(bot).getMe();
      await Bot.updateMeta(bot.id, {
        zalo_bot_id: me.id || me.bot_id,
        zalo_bot_name: me.display_name || me.name || me.username,
      });
    } catch (e) {
      req.flash('error', 'Bot đã tạo nhưng không xác thực được token: ' + e.message);
    }
    if (bot.mode === 'polling') poller.startBot(bot.id);
    req.flash('success', 'Đã thêm bot.');
    res.redirect('/bots/' + bot.id);
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
    res.redirect('/bots');
  }
});

// --- Detail ---
router.get('/bots/:id', loadBot, async (req, res) => {
  const logs = await Log.listForBot(req.bot.id, { limit: 50 });
  const webhooks = await Webhook.listForBot(req.bot.id);
  const stats = await Log.stats(req.bot.id);
  const datasources = await Datasource.listForUser(req.bot.user_id);
  const webhookUrl = `${config.appBaseUrl}/webhook/${req.bot.id}`;
  res.render('bots/detail', {
    title: req.bot.name,
    bot: req.bot,
    logs,
    webhooks,
    stats,
    datasources,
    webhookUrl,
    defaultCode: DEFAULT_CODE,
  });
});

// --- Update basic settings ---
router.post('/bots/:id/settings', loadBot, async (req, res) => {
  const { name, mode, status } = req.body;
  await Bot.updateSettings(req.bot.id, {
    name: name?.trim() || req.bot.name,
    mode: ['webhook', 'polling', 'off'].includes(mode) ? mode : req.bot.mode,
    status: ['active', 'inactive'].includes(status) ? status : req.bot.status,
  });
  await poller.syncAll();
  req.flash('success', 'Đã lưu cấu hình bot.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Update token ---
router.post('/bots/:id/token', loadBot, async (req, res) => {
  const token = (req.body.token || '').trim();
  if (!token) {
    req.flash('error', 'Token không hợp lệ.');
    return res.redirect('/bots/' + req.bot.id);
  }
  await Bot.updateToken(req.bot.id, token);
  try {
    const fresh = await Bot.findById(req.bot.id);
    const me = await apiFor(fresh).getMe();
    await Bot.updateMeta(fresh.id, {
      zalo_bot_id: me.id || me.bot_id,
      zalo_bot_name: me.display_name || me.name || me.username,
    });
    req.flash('success', 'Đã cập nhật token và xác thực thành công.');
  } catch (e) {
    req.flash('error', 'Token đã lưu nhưng xác thực thất bại: ' + e.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

// --- AI config ---
router.post('/bots/:id/ai', loadBot, async (req, res) => {
  const { ai_enabled, ai_model, ai_system_prompt, ai_api_key } = req.body;
  const fields = {
    ai_enabled: ai_enabled ? 1 : 0,
    ai_provider: 'gemini',
    ai_model: (ai_model || '').trim() || config.gemini.model,
    ai_system_prompt: ai_system_prompt || null,
  };
  if (ai_api_key !== undefined && ai_api_key.trim() !== '') fields.ai_api_key = ai_api_key.trim();
  await Bot.updateSettings(req.bot.id, fields);
  req.flash('success', 'Đã lưu cấu hình AI.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Custom code ---
router.post('/bots/:id/code', loadBot, async (req, res) => {
  await Bot.updateSettings(req.bot.id, {
    custom_code_enabled: req.body.custom_code_enabled ? 1 : 0,
    custom_code: req.body.custom_code || '',
  });
  req.flash('success', 'Đã lưu code xử lý tuỳ biến.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Verify token (getMe) ---
router.post('/bots/:id/verify', loadBot, async (req, res) => {
  try {
    const me = await apiFor(req.bot).getMe();
    await Bot.updateMeta(req.bot.id, {
      zalo_bot_id: me.id || me.bot_id,
      zalo_bot_name: me.display_name || me.name || me.username,
    });
    res.json({ ok: true, me });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// --- Register webhook with Zalo ---
router.post('/bots/:id/register-webhook', loadBot, async (req, res) => {
  const url = `${config.appBaseUrl}/webhook/${req.bot.id}`;
  try {
    const result = await apiFor(req.bot).setWebhook(url, { secret_token: req.bot.webhook_secret });
    await Log.add(req.bot.id, { direction: 'system', event_type: 'setWebhook', content: `Registered ${url}` });
    req.flash('success', 'Đã đăng ký webhook với Zalo: ' + url);
  } catch (err) {
    req.flash('error', 'Đăng ký webhook thất bại: ' + err.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/delete-webhook', loadBot, async (req, res) => {
  try {
    await apiFor(req.bot).deleteWebhook();
    req.flash('success', 'Đã xoá webhook trên Zalo.');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.get('/bots/:id/webhook-info', loadBot, async (req, res) => {
  try {
    const info = await apiFor(req.bot).getWebhookInfo();
    res.json({ ok: true, info });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.post('/bots/:id/rotate-secret', loadBot, async (req, res) => {
  await Bot.rotateSecret(req.bot.id);
  req.flash('success', 'Đã tạo secret token mới. Hãy đăng ký lại webhook.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Test send message (text and/or photo) ---
router.post('/bots/:id/test-send', loadBot, async (req, res) => {
  const { chat_id, text, photo, caption } = req.body;
  if (!chat_id || (!text && !photo)) {
    return res.json({ ok: false, message: 'Cần chat_id và nội dung (text hoặc ảnh).' });
  }
  const api = apiFor(req.bot);
  const result = {};
  try {
    if (text) result.message = await sendAndLog(req.bot, api, chat_id.trim(), text, 'test');
    if (photo) {
      result.photo = await api.sendPhoto(chat_id.trim(), photo.trim(), { caption });
      await Log.add(req.bot.id, { direction: 'out', event_type: 'test:photo', chat_id: chat_id.trim(), content: photo });
    }
    res.json({ ok: true, result });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// --- Outbound webhooks (integration forwards) ---
router.post('/bots/:id/webhooks', loadBot, async (req, res) => {
  const { name, target_url, secret, events } = req.body;
  try {
    if (!name || !target_url) throw new Error('Cần tên và URL.');
    await Webhook.create({
      bot_id: req.bot.id,
      name: name.trim(),
      target_url: target_url.trim(),
      secret: (secret || '').trim() || null,
      events: (events || '*').trim() || '*',
    });
    req.flash('success', 'Đã thêm webhook chuyển tiếp.');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/webhooks/:wid/toggle', loadBot, async (req, res) => {
  const wh = await Webhook.findById(parseInt(req.params.wid, 10));
  if (wh && wh.bot_id === req.bot.id) await Webhook.toggle(wh.id, !wh.enabled);
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/webhooks/:wid/delete', loadBot, async (req, res) => {
  const wh = await Webhook.findById(parseInt(req.params.wid, 10));
  if (wh && wh.bot_id === req.bot.id) await Webhook.delete(wh.id);
  req.flash('success', 'Đã xoá webhook.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Logs ---
router.get('/bots/:id/logs', loadBot, async (req, res) => {
  const logs = await Log.listForBot(req.bot.id, { limit: req.query.limit || 100, beforeId: req.query.before });
  res.json({ ok: true, logs });
});

router.post('/bots/:id/logs/clear', loadBot, async (req, res) => {
  await Log.clearForBot(req.bot.id);
  req.flash('success', 'Đã xoá log.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Delete bot ---
router.post('/bots/:id/delete', loadBot, async (req, res) => {
  poller.stopBot(req.bot.id);
  try {
    await apiFor(req.bot).deleteWebhook().catch(() => {});
  } catch {}
  await Bot.delete(req.bot.id);
  req.flash('success', 'Đã xoá bot.');
  res.redirect('/bots');
});

module.exports = router;
