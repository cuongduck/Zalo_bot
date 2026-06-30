'use strict';

const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../config/database');

const User = {
  async findByEmail(email) {
    return queryOne('SELECT * FROM users WHERE email = :email', { email });
  },

  async findById(id) {
    return queryOne('SELECT * FROM users WHERE id = :id', { id });
  },

  async create({ name, email, password, role = 'user', status = 'pending' }) {
    const password_hash = await bcrypt.hash(password, 10);
    const res = await query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES (:name, :email, :password_hash, :role, :status)`,
      { name, email, password_hash, role, status }
    );
    return this.findById(res.insertId);
  },

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  },

  async list({ status } = {}) {
    if (status) {
      return query('SELECT * FROM users WHERE status = :status ORDER BY created_at DESC', { status });
    }
    return query('SELECT * FROM users ORDER BY created_at DESC');
  },

  async countByStatus() {
    const rows = await query('SELECT status, COUNT(*) AS c FROM users GROUP BY status');
    return rows.reduce((acc, r) => ((acc[r.status] = r.c), acc), {});
  },

  async setStatus(id, status, approvedBy = null) {
    await query(
      `UPDATE users SET status = :status,
         approved_by = :approvedBy,
         approved_at = CASE WHEN :status2 = 'approved' THEN NOW() ELSE approved_at END
       WHERE id = :id`,
      { status, approvedBy, status2: status, id }
    );
    return this.findById(id);
  },

  async setRole(id, role) {
    await query('UPDATE users SET role = :role WHERE id = :id', { role, id });
    return this.findById(id);
  },

  async updatePassword(id, password) {
    const password_hash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password_hash = :h WHERE id = :id', { h: password_hash, id });
  },

  async delete(id) {
    await query('DELETE FROM users WHERE id = :id', { id });
  },
};

module.exports = User;
