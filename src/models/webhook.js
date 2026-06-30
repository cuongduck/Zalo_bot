'use strict';

const { query, queryOne } = require('../config/database');

const Webhook = {
  async create({ bot_id, name, target_url, secret, events = '*' }) {
    const res = await query(
      `INSERT INTO webhooks (bot_id, name, target_url, secret, events)
       VALUES (:bot_id, :name, :target_url, :secret, :events)`,
      { bot_id, name, target_url, secret: secret || null, events: events || '*' }
    );
    return this.findById(res.insertId);
  },

  async findById(id) {
    return queryOne('SELECT * FROM webhooks WHERE id = :id', { id });
  },

  async listForBot(botId) {
    return query('SELECT * FROM webhooks WHERE bot_id = :bid ORDER BY created_at DESC', {
      bid: botId,
    });
  },

  async listEnabledForBot(botId) {
    return query('SELECT * FROM webhooks WHERE bot_id = :bid AND enabled = 1', { bid: botId });
  },

  async toggle(id, enabled) {
    await query('UPDATE webhooks SET enabled = :e WHERE id = :id', { e: enabled ? 1 : 0, id });
  },

  async delete(id) {
    await query('DELETE FROM webhooks WHERE id = :id', { id });
  },
};

module.exports = Webhook;
