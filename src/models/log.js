'use strict';

const { query, queryOne } = require('../config/database');

const Log = {
  async add(botId, { direction, event_type, chat_id, chat_type, from_id, from_name, content, raw }) {
    try {
      await query(
        `INSERT INTO bot_logs (bot_id, direction, event_type, chat_id, chat_type, from_id, from_name, content, raw)
         VALUES (:bot_id, :direction, :event_type, :chat_id, :chat_type, :from_id, :from_name, :content, :raw)`,
        {
          bot_id: botId,
          direction,
          event_type: event_type || null,
          chat_id: chat_id != null ? String(chat_id) : null,
          chat_type: chat_type || null,
          from_id: from_id != null ? String(from_id) : null,
          from_name: from_name || null,
          content: content != null ? String(content).slice(0, 4000) : null,
          raw: raw ? JSON.stringify(raw).slice(0, 60000) : null,
        }
      );
    } catch (err) {
      // Never let logging break message flow.
      console.error('[log] failed to write log:', err.message);
    }
  },

  async listForBot(botId, { limit = 100, beforeId } = {}) {
    limit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    if (beforeId) {
      return query(
        'SELECT * FROM bot_logs WHERE bot_id = :bid AND id < :before ORDER BY id DESC LIMIT ' + limit,
        { bid: botId, before: beforeId }
      );
    }
    return query('SELECT * FROM bot_logs WHERE bot_id = :bid ORDER BY id DESC LIMIT ' + limit, {
      bid: botId,
    });
  },

  async clearForBot(botId) {
    await query('DELETE FROM bot_logs WHERE bot_id = :bid', { bid: botId });
  },

  async stats(botId) {
    return queryOne(
      `SELECT
         COUNT(*) AS total,
         SUM(direction='in') AS incoming,
         SUM(direction='out') AS outgoing,
         SUM(direction='error') AS errors
       FROM bot_logs WHERE bot_id = :bid`,
      { bid: botId }
    );
  },
};

module.exports = Log;
