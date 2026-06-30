'use strict';

const fetch = require('node-fetch');
const config = require('../config');

/**
 * Thin client over the Zalo Bot API.
 *
 * The Zalo Bot API mirrors the Telegram Bot API style:
 *   https://bot-api.zapps.me/bot<TOKEN>/<method>
 * The bot token is embedded in the URL; methods accept a JSON body and
 * return { ok: true, result: ... } or { ok: false, description: ... }.
 */
class ZaloBotApi {
  constructor(token, { apiBase } = {}) {
    if (!token) throw new Error('ZaloBotApi requires a bot token');
    this.token = token;
    this.apiBase = (apiBase || config.zalo.apiBase).replace(/\/+$/, '');
  }

  _url(method) {
    // base already ends with /bot
    return `${this.apiBase}${this.token}/${method}`;
  }

  async call(method, params = {}) {
    const url = this._url(method);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`Network error calling ${method}: ${err.message}`);
    }

    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Invalid JSON from ${method} (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok || data.ok === false) {
      const desc = data.description || data.message || `HTTP ${res.status}`;
      const e = new Error(`Zalo API ${method} failed: ${desc}`);
      e.response = data;
      e.status = res.status;
      throw e;
    }
    // Some endpoints return { ok, result }, others the bare object.
    return data.result !== undefined ? data.result : data;
  }

  // --- Identity ---
  getMe() {
    return this.call('getMe');
  }

  // --- Updates (long polling) ---
  getUpdates({ offset, limit = 100, timeout = 30 } = {}) {
    const params = { limit, timeout };
    if (offset !== undefined && offset !== null) params.offset = offset;
    return this.call('getUpdates', params);
  }

  // --- Webhook management ---
  setWebhook(url, { secret_token } = {}) {
    const params = { url };
    if (secret_token) params.secret_token = secret_token;
    return this.call('setWebhook', params);
  }

  deleteWebhook() {
    return this.call('deleteWebhook');
  }

  getWebhookInfo() {
    return this.call('getWebhookInfo');
  }

  // --- Sending ---
  sendMessage(chat_id, text, extra = {}) {
    return this.call('sendMessage', { chat_id, text, ...extra });
  }

  sendPhoto(chat_id, photo, { caption } = {}) {
    const params = { chat_id, photo };
    if (caption) params.caption = caption;
    return this.call('sendPhoto', params);
  }

  sendSticker(chat_id, sticker) {
    return this.call('sendSticker', { chat_id, sticker });
  }

  sendChatAction(chat_id, action = 'typing') {
    return this.call('sendChatAction', { chat_id, action });
  }
}

module.exports = ZaloBotApi;
