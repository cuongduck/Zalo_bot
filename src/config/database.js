'use strict';

const mysql = require('mysql2/promise');
const config = require('./index');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: 'utf8mb4_general_ci',
      timezone: 'Z',
      dateStrings: false,
      namedPlaceholders: true,
    });
  }
  return pool;
}

/**
 * Run a query and return rows.
 * @param {string} sql
 * @param {object|Array} params
 */
async function query(sql, params = {}) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** Return the first row or null. */
async function queryOne(sql, params = {}) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { getPool, query, queryOne };
