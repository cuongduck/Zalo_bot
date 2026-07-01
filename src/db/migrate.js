'use strict';

/**
 * Creates the database (if missing), applies schema.sql and seeds the admin user.
 * Usage:  node src/db/migrate.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');

async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await conn.end();
}

async function applySchema() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);
  await conn.end();
}

// Add columns introduced after the initial release (portable across MySQL/MariaDB).
async function ensureColumns() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });
  const cols = [
    ['bots', 'trigger_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['bots', 'trigger_code', 'MEDIUMTEXT NULL'],
  ];
  for (const [table, name, def] of cols) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
      [config.db.database, table, name]
    );
    if (rows[0].c === 0) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${def}`);
      console.log(`[migrate] added column ${table}.${name}`);
    }
  }
  await conn.end();
}

async function seedAdmin() {
  const { query, queryOne } = require('../config/database');
  const existing = await queryOne('SELECT id FROM users WHERE email = :email', {
    email: config.admin.email,
  });
  if (existing) {
    console.log(`[migrate] Admin ${config.admin.email} already exists (id=${existing.id}).`);
    return;
  }
  const hash = await bcrypt.hash(config.admin.password, 10);
  await query(
    `INSERT INTO users (name, email, password_hash, role, status, approved_at)
     VALUES (:name, :email, :hash, 'admin', 'approved', NOW())`,
    { name: config.admin.name, email: config.admin.email, hash }
  );
  console.log(`[migrate] Created admin account: ${config.admin.email}`);
}

(async () => {
  try {
    console.log('[migrate] Ensuring database exists...');
    await ensureDatabase();
    console.log('[migrate] Applying schema...');
    await applySchema();
    console.log('[migrate] Ensuring columns...');
    await ensureColumns();
    console.log('[migrate] Seeding admin...');
    await seedAdmin();
    console.log('[migrate] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[migrate] FAILED:', err.message);
    process.exit(1);
  }
})();
