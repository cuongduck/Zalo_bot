'use strict';

const express = require('express');
const config = require('../config');
const Bot = require('../models/bot');
const Log = require('../models/log');
const Webhook = require('../models/webhook');
const Trigger = require('../models/trigger');
const MessageRule = require('../models/messageRule');
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

const DEFAULT_TEMPLATE = `🔔 BÁO CÁO MỚI: {{body.id}}
👤 {{body.ho_ten}} ({{body.ma_nv}}) - {{body.bo_phan}}
📍 {{body.xuong}} / {{body.vi_tri}}
⚠️ {{body.severity}} - {{body.category}}
📝 {{body.noi_dung}}
👷 Khắc phục: {{body.nguoi_kp}} | Hạn: {{body.deadline}}
🔗 {{body.link}}`;

const DEFAULT_RULE_CODE = `// Quy tắc này khớp -> code chạy. ctx.message có { text, chatId, chatType, fromId, fromName }
// Có thể dùng: ctx.reply, ctx.send, ctx.ai, ctx.db, ctx.sendPhoto, ctx.fetch, ctx.log
return 'Bạn vừa gửi: ' + (ctx.message.text || '');`;

const DEFAULT_TRIGGER_CODE = `// Nhận webhook ngoài -> xử lý -> gửi Zalo.
// n8n thường gửi mảng, nên lấy phần tử đầu; dữ liệu thật nằm trong .body
const item = Array.isArray(ctx.payload) ? ctx.payload[0] : ctx.payload;
const r = (item && item.body) ? item.body : item;

// ID nhóm/người nhận (lấy bằng cách gõ /id trong nhóm)
const CHAT_ID = 'DIEN_CHAT_ID_VAO_DAY';

const msg =
  '🔔 BÁO CÁO MỚI: ' + (r.id || '') + '\\n' +
  '👤 ' + (r.ho_ten || '') + ' (' + (r.ma_nv || '') + ') - ' + (r.bo_phan || '') + '\\n' +
  '📍 ' + (r.xuong || '') + ' / ' + (r.vi_tri || '') + '\\n' +
  '⚠️ ' + (r.severity || '') + ' - ' + (r.category || '') + '\\n' +
  '📝 ' + (r.noi_dung || '') + '\\n' +
  '👷 Khắc phục: ' + (r.nguoi_kp || '') + ' | Hạn: ' + (r.deadline || '') + '\\n' +
  '🔗 ' + (r.link || '');

if (r.hinh_anh) {
  await ctx.sendPhoto(CHAT_ID, r.hinh_anh, msg);
} else {
  await ctx.send(CHAT_ID, msg);
}
return 'sent';`;

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
  const triggers = await Trigger.listForBot(req.bot.id);
  const rules = await MessageRule.listForBot(req.bot.id);
  const stats = await Log.stats(req.bot.id);
  const datasources = await Datasource.listForUser(req.bot.user_id);
  const webhookUrl = `${config.appBaseUrl}/webhook/${req.bot.id}`;
  res.render('bots/detail', {
    title: req.bot.name,
    bot: req.bot,
    logs,
    webhooks,
    triggers,
    rules,
    stats,
    datasources,
    webhookUrl,
    defaultCode: DEFAULT_CODE,
    defaultTriggerCode: DEFAULT_TRIGGER_CODE,
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

// --- External webhook trigger code ---
router.post('/bots/:id/trigger-code', loadBot, async (req, res) => {
  await Bot.updateSettings(req.bot.id, {
    trigger_enabled: req.body.trigger_enabled ? 1 : 0,
    trigger_code: req.body.trigger_code || '',
  });
  req.flash('success', 'Đã lưu code xử lý webhook ngoài.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Low-code message rules ---
router.post('/bots/:id/rules', loadBot, async (req, res) => {
  const { name, match_type, match_value, chat_filter, action_type } = req.body;
  try {
    if (!name) throw new Error('Cần nhập tên quy tắc.');
    await MessageRule.create({
      bot_id: req.bot.id,
      name: name.trim(),
      match_type,
      match_value: (match_value || '').trim(),
      chat_filter,
      action_type: action_type || 'text',
      reply_text: action_type === 'text' || !action_type ? 'Xin chào! Cảm ơn bạn đã liên hệ.' : '',
      code: action_type === 'code' ? DEFAULT_RULE_CODE : '',
    });
    req.flash('success', 'Đã tạo quy tắc.');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/rules/:rid/save', loadBot, async (req, res) => {
  const r = await MessageRule.findById(parseInt(req.params.rid, 10));
  if (r && r.bot_id === req.bot.id) {
    await MessageRule.update(r.id, {
      name: (req.body.name || r.name).trim(),
      match_type: req.body.match_type,
      match_value: (req.body.match_value || '').trim() || null,
      chat_filter: req.body.chat_filter,
      action_type: req.body.action_type || 'text',
      reply_text: req.body.reply_text || null,
      data_mode: ['none', 'db', 'sheet'].includes(req.body.data_mode) ? req.body.data_mode : 'none',
      data_datasource: (req.body.data_datasource || '').trim() || null,
      data_query: req.body.data_query || null,
      data_sheet_url: (req.body.data_sheet_url || '').trim() || null,
      sort_order: parseInt(req.body.sort_order, 10) || 0,
      code: req.body.code || null,
      enabled: req.body.enabled ? 1 : 0,
    });
    req.flash('success', `Đã lưu quy tắc "${r.name}".`);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/rules/:rid/delete', loadBot, async (req, res) => {
  const r = await MessageRule.findById(parseInt(req.params.rid, 10));
  if (r && r.bot_id === req.bot.id) await MessageRule.delete(r.id);
  req.flash('success', 'Đã xoá quy tắc.');
  res.redirect('/bots/' + req.bot.id);
});

// --- Named triggers (multiple external webhooks) ---
router.post('/bots/:id/triggers', loadBot, async (req, res) => {
  const { name, slug } = req.body;
  try {
    if (!name) throw new Error('Cần nhập tên webhook.');
    const finalSlug = Trigger.slugify(slug || name) || 'webhook';
    if (await Trigger.findBySlug(req.bot.id, finalSlug)) {
      throw new Error(`Slug "${finalSlug}" đã tồn tại, chọn tên/slug khác.`);
    }
    const mode = req.body.mode === 'code' ? 'code' : 'template';
    await Trigger.create({
      bot_id: req.bot.id, name: name.trim(), slug: finalSlug, mode,
      template: mode === 'template' ? DEFAULT_TEMPLATE : '',
      code: mode === 'code' ? DEFAULT_TRIGGER_CODE : '',
    });
    req.flash('success', 'Đã tạo webhook riêng.');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/bots/' + req.bot.id);
});

router.post('/bots/:id/triggers/:tid/save', loadBot, async (req, res) => {
  const t = await Trigger.findById(parseInt(req.params.tid, 10));
  if (t && t.bot_id === req.bot.id) {
    await Trigger.update(t.id, {
      name: (req.body.name || t.name).trim(),
      mode: req.body.mode === 'code' ? 'code' : 'template',
      target_chat_id: (req.body.target_chat_id || '').trim() || null,
      template: req.body.template || null,
      photo_field: (req.body.photo_field || '').trim() || null,
      code: req.body.code || null,
      require_secret: req.body.require_secret ? 1 : 0,
      enabled: req.body.enabled ? 1 : 0,
    });
    req.flash('success', `Đã lưu webhook "${t.name}".`);
  }
  res.redirect('/bots/' + req.bot.id);
});

// Latest raw payload a named webhook received — powers the no-code field picker.
router.get('/bots/:id/triggers/:tid/last-payload', loadBot, async (req, res) => {
  const t = await Trigger.findById(parseInt(req.params.tid, 10));
  if (!t || t.bot_id !== req.bot.id) return res.status(404).json({ ok: false });
  const payload = await Log.lastRawByEvent(req.bot.id, 'trigger:' + t.slug);
  res.json({ ok: true, payload });
});

router.post('/bots/:id/triggers/:tid/delete', loadBot, async (req, res) => {
  const t = await Trigger.findById(parseInt(req.params.tid, 10));
  if (t && t.bot_id === req.bot.id) await Trigger.delete(t.id);
  req.flash('success', 'Đã xoá webhook.');
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
