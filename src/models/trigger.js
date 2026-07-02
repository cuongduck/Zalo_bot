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

  async create({ bot_id, name, slug, mode = 'template', target_chat_id = '', template = '', photo_field = '', code = '' }) {
    const finalSlug = slugify(slug || name) || 'webhook';
    const res = await query(
      `INSERT INTO triggers (bot_id, slug, name, mode, target_chat_id, template, photo_field, code, enabled)
       VALUES (:bot_id, :slug, :name, :mode, :target_chat_id, :template, :photo_field, :code, 1)`,
      {
        bot_id, slug: finalSlug, name,
        mode: ['template', 'code'].includes(mode) ? mode : 'template',
        target_chat_id: target_chat_id || null,
        template: template || null,
        photo_field: photo_field || null,
        code: code || null,
      }
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

  async update(id, fields) {
    const allowed = ['name', 'mode', 'target_chat_id', 'template', 'photo_field', 'code', 'require_secret', 'enabled'];
    const sets = [];
    const params = { id };
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = :${k}`);
        params[k] = (k === 'enabled' || k === 'require_secret')
          ? (fields[k] ? 1 : 0)
          : (fields[k] || null);
      }
    }
    if (sets.length) await query(`UPDATE triggers SET ${sets.join(', ')} WHERE id = :id`, params);
    return this.findById(id);
  },

  async delete(id) {
    await query('DELETE FROM triggers WHERE id = :id', { id });
  },
};

module.exports = Trigger;
