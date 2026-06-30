'use strict';

const express = require('express');
const User = require('../models/user');
const Bot = require('../models/bot');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
  const users = await User.list();
  const counts = await User.countByStatus();
  res.render('admin/users', { title: 'Quản lý thành viên', users, counts });
});

router.post('/users/:id/approve', async (req, res) => {
  await User.setStatus(parseInt(req.params.id, 10), 'approved', req.user.id);
  req.flash('success', 'Đã phê duyệt thành viên.');
  res.redirect('/admin/users');
});

router.post('/users/:id/reject', async (req, res) => {
  await User.setStatus(parseInt(req.params.id, 10), 'rejected', req.user.id);
  req.flash('success', 'Đã từ chối thành viên.');
  res.redirect('/admin/users');
});

router.post('/users/:id/suspend', async (req, res) => {
  await User.setStatus(parseInt(req.params.id, 10), 'suspended', req.user.id);
  req.flash('success', 'Đã khoá tài khoản.');
  res.redirect('/admin/users');
});

router.post('/users/:id/role', async (req, res) => {
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  await User.setRole(parseInt(req.params.id, 10), role);
  req.flash('success', 'Đã cập nhật vai trò.');
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    req.flash('error', 'Không thể xoá chính bạn.');
    return res.redirect('/admin/users');
  }
  await User.delete(id);
  req.flash('success', 'Đã xoá thành viên.');
  res.redirect('/admin/users');
});

router.get('/bots', async (req, res) => {
  const bots = await Bot.listAll();
  res.render('admin/bots', { title: 'Tất cả bot', bots });
});

module.exports = router;
