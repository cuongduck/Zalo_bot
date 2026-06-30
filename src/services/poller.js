'use strict';

const Bot = require('../models/bot');
const Log = require('../models/log');
const { handleUpdate, apiFor } = require('./botManager');

/**
 * Background long-polling manager for bots whose mode === 'polling'.
 * Webhook-mode bots are driven by the inbound HTTP route instead.
 */
const active = new Map(); // botId -> { stop }

async function pollLoop(botId) {
  const state = active.get(botId);
  while (state && !state.stopped) {
    let bot;
    try {
      bot = await Bot.findById(botId);
      if (!bot || bot.mode !== 'polling' || bot.status !== 'active') break;
      const api = apiFor(bot);
      const updates = await api.getUpdates({
        offset: bot.last_update_id ? Number(bot.last_update_id) + 1 : undefined,
        timeout: 25,
        limit: 50,
      });
      const list = Array.isArray(updates) ? updates : updates?.result || [];
      for (const u of list) {
        await handleUpdate(bot, u);
        const uid = u.update_id ?? u.id;
        if (uid != null) await Bot.setLastUpdateId(botId, uid);
      }
    } catch (err) {
      await Log.add(botId, { direction: 'error', event_type: 'polling', content: err.message });
      await sleep(5000); // back off on errors
    }
  }
  active.delete(botId);
}

function startBot(botId) {
  if (active.has(botId)) return;
  const state = { stopped: false };
  active.set(botId, state);
  pollLoop(botId);
}

function stopBot(botId) {
  const state = active.get(botId);
  if (state) state.stopped = true;
}

/** Reconcile running pollers with DB state; call on boot and after changes. */
async function syncAll() {
  const bots = await Bot.listActive();
  const shouldPoll = new Set(bots.filter((b) => b.mode === 'polling').map((b) => b.id));
  for (const b of bots) if (shouldPoll.has(b.id)) startBot(b.id);
  for (const id of active.keys()) if (!shouldPoll.has(id)) stopBot(id);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { startBot, stopBot, syncAll, active };
