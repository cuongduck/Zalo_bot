'use strict';

const mysql = require('mysql2/promise');

let mssql = null;
try {
  // mssql is optional at runtime; only required when an mssql datasource is used.
  mssql = require('mssql');
} catch {
  /* not installed */
}

/**
 * Run a read query against an external datasource (MySQL/MariaDB or SQL Server).
 * Connections are short-lived (opened and closed per call) to keep self-hosting simple.
 *
 * @param {object} ds   - decrypted datasource row
 * @param {string} sql  - query
 * @param {Array}  params - positional params
 * @returns {Promise<Array>} rows
 */
async function runQuery(ds, sql, params = []) {
  if (ds.type === 'mssql') {
    if (!mssql) throw new Error('mssql package is not installed on the server.');
    const pool = await mssql.connect({
      server: ds.host,
      port: parseInt(ds.port, 10) || 1433,
      user: ds.username,
      password: ds.password || '',
      database: ds.db_name,
      options: { encrypt: false, trustServerCertificate: true, ...(parseOptions(ds)) },
      connectionTimeout: 15000,
      requestTimeout: 20000,
    });
    try {
      const request = pool.request();
      (params || []).forEach((p, i) => request.input(`p${i}`, p));
      // Allow @p0.. placeholders for parameterized queries.
      const result = await request.query(sql);
      return result.recordset || [];
    } finally {
      await pool.close();
    }
  }

  // mysql / mariadb
  const conn = await mysql.createConnection({
    host: ds.host,
    port: parseInt(ds.port, 10) || 3306,
    user: ds.username,
    password: ds.password || '',
    database: ds.db_name,
    connectTimeout: 15000,
    ...parseOptions(ds),
  });
  try {
    const [rows] = await conn.execute(sql, params || []);
    return rows;
  } finally {
    await conn.end();
  }
}

function parseOptions(ds) {
  if (!ds.options_json) return {};
  try {
    return JSON.parse(ds.options_json);
  } catch {
    return {};
  }
}

/** Quick connectivity test. Returns { ok, message }. */
async function testConnection(ds) {
  try {
    const rows = await runQuery(ds, ds.type === 'mssql' ? 'SELECT 1 AS ok' : 'SELECT 1 AS ok');
    return { ok: true, message: 'Connected successfully', sample: rows };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { runQuery, testConnection };
