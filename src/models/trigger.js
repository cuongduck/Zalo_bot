'use strict';

const { query, queryOne } = require('../config/database');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const Trigger = {
  slugify,

  async create({ bot_id, name, slug, code = '' }) {
    const finalSlug = slugify(slug || name) || 'webhook';
    const res = await query(
      `INSERT INTO triggers (bot_id, slug, name, code, enabled)
       VALUES (:bot_id, :slug, :name, :code, 1)`,
      { bot_id, slug: finalSlug, name, code }
    );
    return this.findById(res.insertId);
  },

  async findById(id) {
    return queryOne('SELECT * FROM triggers WHERE id = :id', { id });
  },

  async findBySlug(botId, slug) {
    return queryOne('SELECT * FROM triggers WHERE bot_id = :bid AND slug = :slug', {
      bid: botId,
      slug,
    });
  },

  async listForBot(botId) {
    return query('SELECT * FROM triggers WHERE bot_id = :bid ORDER BY created_at DESC', {
      bid: botId,
    });
  },

  async update(id, { code, enabled, name }) {
    const sets = [];
    const params = { id };
    if (code !== undefined) { sets.push('code = :code'); params.code = code; }
    if (enabled !== undefined) { sets.push('enabled = :enabled'); params.enabled = enabled ? 1 : 0; }
    if (name !== undefined) { sets.push('name = :name'); params.name = name; }
    if (sets.length) await query(`UPDATE triggers SET ${sets.join(', ')} WHERE id = :id`, params);
    return this.findById(id);
  },

  async delete(id) {
    await query('DELETE FROM triggers WHERE id = :id', { id });
  },
};

module.exports = Trigger;
