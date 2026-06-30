'use strict';

const { query, queryOne } = require('../config/database');
const { encrypt, decrypt } = require('../utils/crypto');

function decryptDs(row) {
  if (!row) return row;
  row.password = row.password_enc ? decrypt(row.password_enc) : null;
  return row;
}

const Datasource = {
  async create({ user_id, name, type, host, port, username, password, db_name, options_json }) {
    const res = await query(
      `INSERT INTO datasources (user_id, name, type, host, port, username, password_enc, db_name, options_json)
       VALUES (:user_id, :name, :type, :host, :port, :username, :pwd, :db_name, :options_json)`,
      {
        user_id, name, type, host,
        port: parseInt(port, 10) || (type === 'mssql' ? 1433 : 3306),
        username, pwd: password ? encrypt(password) : null, db_name,
        options_json: options_json || null,
      }
    );
    return this.findById(res.insertId);
  },

  async findById(id) {
    return decryptDs(await queryOne('SELECT * FROM datasources WHERE id = :id', { id }));
  },

  async findForUser(id, userId, isAdmin = false) {
    const row = await this.findById(id);
    if (!row) return null;
    if (!isAdmin && row.user_id !== userId) return null;
    return row;
  },

  async listForUser(userId) {
    const rows = await query('SELECT * FROM datasources WHERE user_id = :uid ORDER BY created_at DESC', {
      uid: userId,
    });
    return rows.map(decryptDs);
  },

  async findByNameForUser(name, userId) {
    return decryptDs(
      await queryOne('SELECT * FROM datasources WHERE name = :name AND user_id = :uid', {
        name, uid: userId,
      })
    );
  },

  async delete(id) {
    await query('DELETE FROM datasources WHERE id = :id', { id });
  },
};

module.exports = Datasource;
