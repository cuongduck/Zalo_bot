'use strict';

const { query, queryOne } = require('../config/database');

const MATCH_TYPES = ['prefix', 'contains', 'equals', 'regex', 'any'];
const CHAT_FILTERS = ['any', 'user', 'group'];

const MessageRule = {
  MATCH_TYPES,
  CHAT_FILTERS,

  async create({ bot_id, name, match_type = 'prefix', match_value = '', chat_filter = 'any', code = '' }) {
    const [{ mx }] = await query(
      'SELECT COALESCE(MAX(sort_order), 0) AS mx FROM message_rules WHERE bot_id = :bid',
      { bid: bot_id }
    );
    const res = await query(
      `INSERT INTO message_rules (bot_id, name, match_type, match_value, chat_filter, code, sort_order, enabled)
       VALUES (:bot_id, :name, :match_type, :match_value, :chat_filter, :code, :sort_order, 1)`,
      {
        bot_id, name,
        match_type: MATCH_TYPES.includes(match_type) ? match_type : 'prefix',
        match_value: match_value || null,
        chat_filter: CHAT_FILTERS.includes(chat_filter) ? chat_filter : 'any',
        code,
        sort_order: (mx || 0) + 1,
      }
    );
    return this.findById(res.insertId);
  },

  async findById(id) {
    return queryOne('SELECT * FROM message_rules WHERE id = :id', { id });
  },

  async listForBot(botId) {
    return query('SELECT * FROM message_rules WHERE bot_id = :bid ORDER BY sort_order ASC, id ASC', {
      bid: botId,
    });
  },

  async listEnabledForBot(botId) {
    return query(
      'SELECT * FROM message_rules WHERE bot_id = :bid AND enabled = 1 ORDER BY sort_order ASC, id ASC',
      { bid: botId }
    );
  },

  async update(id, fields) {
    const allowed = ['name', 'match_type', 'match_value', 'chat_filter', 'code', 'sort_order', 'enabled'];
    const sets = [];
    const params = { id };
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = :${k}`);
        params[k] = fields[k];
      }
    }
    if (sets.length) await query(`UPDATE message_rules SET ${sets.join(', ')} WHERE id = :id`, params);
    return this.findById(id);
  },

  async delete(id) {
    await query('DELETE FROM message_rules WHERE id = :id', { id });
  },
};

module.exports = MessageRule;
