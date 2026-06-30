'use strict';

const express = require('express');
const Datasource = require('../models/datasource');
const externalDb = require('../services/externalDb');
const { requireApproved } = require('../middleware/auth');

const router = express.Router();
router.use(requireApproved);

router.get('/datasources', async (req, res) => {
  const datasources = await Datasource.listForUser(req.user.id);
  res.render('datasources', { title: 'Kết nối dữ liệu', datasources });
});

router.post('/datasources', async (req, res) => {
  const { name, type, host, port, username, password, db_name, options_json } = req.body;
  try {
    if (!name || !host || !db_name) throw new Error('Thiếu tên, host hoặc database.');
    await Datasource.create({
      user_id: req.user.id,
      name: name.trim(),
      type: ['mysql', 'mariadb', 'mssql'].includes(type) ? type : 'mysql',
      host: host.trim(),
      port,
      username: (username || '').trim(),
      password: password || '',
      db_name: db_name.trim(),
      options_json: options_json || null,
    });
    req.flash('success', 'Đã thêm kết nối dữ liệu.');
  } catch (err) {
    req.flash('error', 'Lỗi: ' + err.message);
  }
  res.redirect('/datasources');
});

router.post('/datasources/:id/test', async (req, res) => {
  const ds = await Datasource.findForUser(parseInt(req.params.id, 10), req.user.id, req.user.role === 'admin');
  if (!ds) return res.status(404).json({ ok: false, message: 'Not found' });
  const result = await externalDb.testConnection(ds);
  res.json(result);
});

router.post('/datasources/:id/query', async (req, res) => {
  const ds = await Datasource.findForUser(parseInt(req.params.id, 10), req.user.id, req.user.role === 'admin');
  if (!ds) return res.status(404).json({ ok: false, message: 'Not found' });
  try {
    const rows = await externalDb.runQuery(ds, req.body.sql, []);
    res.json({ ok: true, rows: Array.isArray(rows) ? rows.slice(0, 100) : rows });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.post('/datasources/:id/delete', async (req, res) => {
  const ds = await Datasource.findForUser(parseInt(req.params.id, 10), req.user.id, req.user.role === 'admin');
  if (ds) await Datasource.delete(ds.id);
  req.flash('success', 'Đã xoá kết nối.');
  res.redirect('/datasources');
});

module.exports = router;
