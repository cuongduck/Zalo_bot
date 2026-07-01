'use strict';

const { query, queryOne } = require('../config/database');
const { encrypt, decrypt, randomToken } = require('../utils/crypto');

function decryptBot(row) {
  if (!row) return row;
  row.token = row.token_enc ? decrypt(row.token_enc) : null;
  row.ai_api_key = row.ai_api_key_enc ? decrypt(row.ai_api_key_enc) : null;
  return row;
}

const Bot = {
  async create({ user_id, name, token, mode = 'webhook' }) {
    const webhook_secret = randomToken(18);
    const res = await query(
      `INSERT INTO bots (user_id, name, token_enc, mode, webhook_secret)
       VALUES (:user_id, :name, :token_enc, :mode, :secret)`,
      { user_id, name, token_enc: encrypt(token), mode, secret: webhook_secret }
    );
    return this.findById(res.insertId);
  },

  async findById(id) {
    return decryptBot(await queryOne('SELECT * FROM bots WHERE id = :id', { id }));
  },

  async findByIdForUser(id, userId, isAdmin = false) {
    const row = await this.findById(id);
    if (!row) return null;
    if (!isAdmin && row.user_id !== userId) return null;
    return row;
  },

  async listForUser(userId) {
    const rows = await query('SELECT * FROM bots WHERE user_id = :uid ORDER BY created_at DESC', {
      uid: userId,
    });
    return rows.map(decryptBot);
  },

  async listAll() {
    const rows = await query('SELECT * FROM bots ORDER BY created_at DESC');
    return rows.map(decryptBot);
  },

  async listActive() {
    const rows = await query("SELECT * FROM bots WHERE status = 'active'");
    return rows.map(decryptBot);
  },

  async updateMeta(id, { zalo_bot_id, zalo_bot_name }) {
    await query('UPDATE bots SET zalo_bot_id = :z, zalo_bot_name = :n WHERE id = :id', {
      z: zalo_bot_id || null,
      n: zalo_bot_name || null,
      id,
    });
  },

  async updateToken(id, token) {
    await query('UPDATE bots SET token_enc = :t WHERE id = :id', { t: encrypt(token), id });
  },

  async updateSettings(id, fields) {
    const allowed = [
      'name', 'mode', 'status', 'ai_enabled', 'ai_provider', 'ai_model',
      'ai_system_prompt', 'custom_code_enabled', 'custom_code',
      'trigger_enabled', 'trigger_code',
    ];
    const sets = [];
    const params = { id };
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = :${key}`);
        params[key] = fields[key];
      }
    }
    if (fields.ai_api_key !== undefined) {
      sets.push('ai_api_key_enc = :ai_api_key_enc');
      params.ai_api_key_enc = fields.ai_api_key ? encrypt(fields.ai_api_key) : null;
    }
    if (!sets.length) return this.findById(id);
    await query(`UPDATE bots SET ${sets.join(', ')} WHERE id = :id`, params);
    return this.findById(id);
  },

  async setLastUpdateId(id, updateId) {
    await query('UPDATE bots SET last_update_id = :u WHERE id = :id', { u: updateId, id });
  },

  async rotateSecret(id) {
    const secret = randomToken(18);
    await query('UPDATE bots SET webhook_secret = :s WHERE id = :id', { s: secret, id });
    return secret;
  },

  async delete(id) {
    await query('DELETE FROM bots WHERE id = :id', { id });
  },
};

module.exports = Bot;
