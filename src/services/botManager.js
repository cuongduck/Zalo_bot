'use strict';

const fetch = require('node-fetch');
const ZaloBotApi = require('./zaloApi');
const gemini = require('./gemini');
const externalDb = require('./externalDb');
const { runHandler } = require('./customHandler');
const tpl = require('../utils/template');
const Bot = require('../models/bot');
const Log = require('../models/log');
const Webhook = require('../models/webhook');
const Datasource = require('../models/datasource');
const MessageRule = require('../models/messageRule');

/**
 * Normalize a raw Zalo update into a flat message object.
 * Defensive about field naming differences across Zalo Bot API versions.
 */
function normalizeUpdate(update) {
  const msg = update.message || update.edited_message || update.callback_query?.message || {};
  const chat = msg.chat || {};
  const from = msg.from || msg.sender || {};
  const chatId = chat.id ?? msg.chat_id ?? from.id ?? null;
  const chatType = chat.chat_type || chat.type || (update.message ? 'user' : null);
  return {
    updateId: update.update_id ?? update.id ?? null,
    eventName: update.event_name || update.event || (msg.text ? 'message.text' : 'message'),
    messageId: msg.message_id ?? msg.id ?? null,
    text: msg.text ?? msg.caption ?? '',
    chatId: chatId != null ? String(chatId) : null,
    chatType,
    fromId: from.id != null ? String(from.id) : null,
    fromName: from.display_name || from.name || from.username || null,
    date: msg.date || null,
    raw: update,
  };
}

/** Build the api client for a bot. */
function apiFor(bot) {
  return new ZaloBotApi(bot.token);
}

/**
 * Process a single normalized update for a bot: log, forward, run custom
 * handler / AI, and reply. Safe to call from webhook receiver or poller.
 */
async function handleUpdate(bot, update) {
  const m = normalizeUpdate(update);
  const api = apiFor(bot);

  await Log.add(bot.id, {
    direction: 'in',
    event_type: m.eventName,
    chat_id: m.chatId,
    chat_type: m.chatType,
    from_id: m.fromId,
    from_name: m.fromName,
    content: m.text,
    raw: update,
  });

  // Forward to outbound integration webhooks (fire-and-forget).
  forwardToWebhooks(bot, m).catch((e) => console.error('[forward]', e.message));

  if (bot.status !== 'active') return;

  // Built-in helper command: reply with chat & user IDs.
  if (m.text && /^\/(id|getid|chatid)\b/i.test(m.text.trim())) {
    const info =
      `🆔 Thông tin ID\n` +
      `• Chat ID: ${m.chatId}\n` +
      `• Loại chat: ${m.chatType || 'unknown'}\n` +
      `• User ID: ${m.fromId}\n` +
      `• Tên: ${m.fromName || 'N/A'}`;
    await sendAndLog(bot, api, m.chatId, info, 'command:id');
    return;
  }

  // 1) Low-code message rules: first matching enabled rule wins.
  const rules = await MessageRule.listEnabledForBot(bot.id);
  for (const rule of rules) {
    if (ruleMatches(rule, m)) {
      await executeRule(bot, api, m, rule);
      return; // matched rule is authoritative
    }
  }

  // 2) Catch-all custom code handler.
  if (bot.custom_code_enabled && bot.custom_code && bot.custom_code.trim()) {
    await runMessageCode(bot, api, m, bot.custom_code, 'custom_code');
    return;
  }

  // 3) AI auto-reply.
  if (bot.ai_enabled && m.text && m.text.trim()) {
    try {
      await api.sendChatAction(m.chatId, 'typing').catch(() => {});
      const reply = await gemini.generateReply({
        apiKey: bot.ai_api_key,
        model: bot.ai_model,
        systemPrompt: bot.ai_system_prompt,
        message: m.text,
      });
      await sendAndLog(bot, api, m.chatId, reply, 'ai');
    } catch (err) {
      await Log.add(bot.id, { direction: 'error', event_type: 'ai',
        chat_id: m.chatId, content: err.message });
    }
  }
}

/** Does an incoming message match a low-code rule? */
function ruleMatches(rule, m) {
  const wantChat = rule.chat_filter || 'any';
  if (wantChat !== 'any') {
    const actual = m.chatType === 'group' ? 'group' : 'user';
    if (wantChat !== actual) return false;
  }
  const text = (m.text || '').trim();
  const val = rule.match_value || '';
  switch (rule.match_type) {
    case 'any':
      return true;
    case 'equals':
      return text.toLowerCase() === val.toLowerCase();
    case 'prefix':
      return text.toLowerCase().startsWith(val.toLowerCase());
    case 'contains':
      return text.toLowerCase().includes(val.toLowerCase());
    case 'regex':
      try {
        return new RegExp(val, 'i').test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Execute a matched rule according to its action type (text / ai / code). */
async function executeRule(bot, api, m, rule) {
  const label = 'rule:' + rule.name;
  const vars = {
    ten: m.fromName || '',
    ten_nguoi_gui: m.fromName || '',
    noi_dung: m.text || '',
    text: m.text || '',
    chat_id: m.chatId || '',
    user_id: m.fromId || '',
    message: { text: m.text, chatId: m.chatId, chatType: m.chatType, fromId: m.fromId, fromName: m.fromName },
  };
  try {
    if (rule.action_type === 'ai') {
      await api.sendChatAction(m.chatId, 'typing').catch(() => {});
      const prompt = (rule.reply_text ? rule.reply_text.trim() + '\n\n' : '') + (m.text || '');
      const reply = await gemini.generateReply({
        apiKey: bot.ai_api_key, model: bot.ai_model, systemPrompt: bot.ai_system_prompt, message: prompt,
      });
      await sendAndLog(bot, api, m.chatId, reply, label);
    } else if (rule.action_type === 'code') {
      await runMessageCode(bot, api, m, rule.code, label);
    } else {
      // 'text' — send the fixed reply, rendering {{placeholders}}.
      const text = tpl.render(rule.reply_text || '', vars);
      if (text.trim()) await sendAndLog(bot, api, m.chatId, text, label);
    }
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: label, chat_id: m.chatId, content: err.message });
  }
}

/** Run a message-handler code block (rule or catch-all) and send its reply. */
async function runMessageCode(bot, api, m, code, label) {
  if (!code || !code.trim()) return;
  try {
    const ctx = buildHandlerContext(bot, api, m);
    const { returned, logs } = await runHandler(code, ctx, { timeoutMs: 8000 });
    if (logs.length) {
      await Log.add(bot.id, { direction: 'system', event_type: label, chat_id: m.chatId, content: logs.join('\n') });
    }
    if (typeof returned === 'string' && returned.trim()) {
      await sendAndLog(bot, api, m.chatId, returned, label);
    } else if (returned && typeof returned === 'object' && returned.text) {
      await sendAndLog(bot, api, returned.chat_id || m.chatId, returned.text, label);
    }
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: label, chat_id: m.chatId, content: err.message });
  }
}

/** Helpers exposed to user custom code. */
function buildHandlerContext(bot, api, m) {
  return {
    message: {
      text: m.text,
      chatId: m.chatId,
      chatType: m.chatType,
      fromId: m.fromId,
      fromName: m.fromName,
      messageId: m.messageId,
      date: m.date,
      raw: m.raw,
    },
    bot: { id: bot.id, name: bot.name, zaloId: bot.zalo_bot_id },
    async reply(text) {
      return sendAndLog(bot, api, m.chatId, text, 'custom_code');
    },
    async send(chatId, text) {
      return sendAndLog(bot, api, chatId, text, 'custom_code');
    },
    async sendPhoto(chatId, photo, caption) {
      const r = await api.sendPhoto(chatId, photo, { caption });
      await Log.add(bot.id, { direction: 'out', event_type: 'custom_code:photo',
        chat_id: chatId, content: photo });
      return r;
    },
    async ai(prompt, opts = {}) {
      return gemini.generateReply({
        apiKey: bot.ai_api_key,
        model: opts.model || bot.ai_model,
        systemPrompt: opts.systemPrompt || bot.ai_system_prompt,
        message: prompt,
      });
    },
    async db(datasourceName, sql, params = []) {
      const ds = await Datasource.findByNameForUser(datasourceName, bot.user_id);
      if (!ds) throw new Error(`Datasource "${datasourceName}" not found for this user`);
      return externalDb.runQuery(ds, sql, params);
    },
    fetch,
  };
}

/**
 * Build the ctx exposed to external-webhook trigger code. Unlike message
 * handlers there is no incoming chat to reply to; the code reads ctx.payload
 * and explicitly calls ctx.send / ctx.sendPhoto to a chat_id it decides.
 */
function buildTriggerContext(bot, payload) {
  const api = apiFor(bot);
  return {
    payload,
    bot: { id: bot.id, name: bot.name, zaloId: bot.zalo_bot_id },
    async send(chatId, text) {
      return sendAndLog(bot, api, chatId, text, 'trigger');
    },
    async sendPhoto(chatId, photo, caption) {
      const r = await api.sendPhoto(chatId, photo, { caption });
      await Log.add(bot.id, { direction: 'out', event_type: 'trigger:photo', chat_id: chatId, content: photo });
      return r;
    },
    async ai(prompt, opts = {}) {
      return gemini.generateReply({
        apiKey: bot.ai_api_key,
        model: opts.model || bot.ai_model,
        systemPrompt: opts.systemPrompt || bot.ai_system_prompt,
        message: prompt,
      });
    },
    async db(datasourceName, sql, params = []) {
      const ds = await Datasource.findByNameForUser(datasourceName, bot.user_id);
      if (!ds) throw new Error(`Datasource "${datasourceName}" not found for this user`);
      return externalDb.runQuery(ds, sql, params);
    },
    fetch,
  };
}

/**
 * Run the bot's trigger_code against an arbitrary external webhook payload.
 * Returns { returned, logs }. Throws on handler error (caller logs it).
 */
async function runTrigger(bot, payload, code) {
  // The inbound webhook itself is logged by the caller (routes/api.js) so it
  // is recorded even when trigger handling is disabled; here we only run code.
  const ctx = buildTriggerContext(bot, payload);
  const { returned, logs } = await runHandler(code || bot.trigger_code, ctx, { timeoutMs: 12000 });
  if (logs.length) {
    await Log.add(bot.id, { direction: 'system', event_type: 'trigger', content: logs.join('\n') });
  }
  return { returned, logs };
}

/**
 * Execute a named trigger by mode: 'template' (no-code, {{placeholders}} -> a
 * fixed target chat) or 'code' (sandboxed JS). Returns { returned, logs }.
 */
async function executeTrigger(bot, payload, trigger) {
  if (trigger.mode === 'template') {
    const api = apiFor(bot);
    const label = 'trigger:' + trigger.slug;
    const chatId = trigger.target_chat_id;
    if (!chatId) throw new Error('Chưa đặt "Gửi tới Chat ID" cho webhook này.');
    const text = tpl.render(trigger.template || '', payload);
    const photo = trigger.photo_field ? tpl.getPath(payload, trigger.photo_field) : null;
    if (photo) {
      await api.sendPhoto(chatId, photo, { caption: text });
      await Log.add(bot.id, { direction: 'out', event_type: label + ':photo', chat_id: chatId, content: String(photo) });
    } else {
      await sendAndLog(bot, api, chatId, text, label);
    }
    return { returned: 'sent', logs: [] };
  }
  return runTrigger(bot, payload, trigger.code);
}

/** Send a message and record the outgoing log entry. */
async function sendAndLog(bot, api, chatId, text, eventType = 'message') {
  if (!chatId) throw new Error('chatId is required to send a message');
  try {
    const res = await api.sendMessage(chatId, text);
    await Log.add(bot.id, { direction: 'out', event_type: eventType,
      chat_id: chatId, content: text, raw: res });
    return res;
  } catch (err) {
    await Log.add(bot.id, { direction: 'error', event_type: eventType,
      chat_id: chatId, content: `Send failed: ${err.message}` });
    throw err;
  }
}

/** Forward a normalized event to all enabled outbound webhooks of the bot. */
async function forwardToWebhooks(bot, m) {
  const hooks = await Webhook.listEnabledForBot(bot.id);
  if (!hooks.length) return;
  const payload = {
    bot_id: bot.id,
    bot_name: bot.name,
    event: m.eventName,
    message: {
      text: m.text,
      chat_id: m.chatId,
      chat_type: m.chatType,
      from_id: m.fromId,
      from_name: m.fromName,
      message_id: m.messageId,
      date: m.date,
    },
    raw: m.raw,
  };
  await Promise.allSettled(
    hooks
      .filter((h) => h.events === '*' || h.events.split(',').map((s) => s.trim()).includes(m.eventName))
      .map(async (h) => {
        try {
          await fetch(h.target_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(h.secret ? { 'X-Webhook-Secret': h.secret } : {}),
            },
            body: JSON.stringify(payload),
            timeout: 10000,
          });
        } catch (err) {
          await Log.add(bot.id, { direction: 'error', event_type: 'webhook_forward',
            content: `Forward to ${h.target_url} failed: ${err.message}` });
        }
      })
  );
}

module.exports = { handleUpdate, normalizeUpdate, apiFor, sendAndLog, runTrigger, executeTrigger };
