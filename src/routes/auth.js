'use strict';

const express = require('express');
const User = require('../models/user');

const router = express.Router();

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Đăng nhập' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findByEmail((email || '').trim().toLowerCase());
    if (!user || !(await User.verifyPassword(user, password || ''))) {
      req.flash('error', 'Email hoặc mật khẩu không đúng.');
      return res.redirect('/login');
    }
    if (user.status === 'rejected' || user.status === 'suspended') {
      req.flash('error', 'Tài khoản của bạn đã bị từ chối hoặc khoá.');
      return res.redirect('/login');
    }
    req.session.userId = user.id;
    req.flash('success', `Chào mừng, ${user.name}!`);
    res.redirect('/dashboard');
  } catch (err) {
    req.flash('error', 'Lỗi đăng nhập: ' + err.message);
    res.redirect('/login');
  }
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Đăng ký' });
});

router.post('/register', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';

  if (!name || !emailRe.test(email) || password.length < 6) {
    req.flash('error', 'Vui lòng nhập tên, email hợp lệ và mật khẩu tối thiểu 6 ký tự.');
    return res.redirect('/register');
  }
  if (password !== confirm) {
    req.flash('error', 'Mật khẩu xác nhận không khớp.');
    return res.redirect('/register');
  }
  try {
    if (await User.findByEmail(email)) {
      req.flash('error', 'Email đã được đăng ký.');
      return res.redirect('/register');
    }
    await User.create({ name, email, password, role: 'user', status: 'pending' });
    req.flash('success', 'Đăng ký thành công! Tài khoản của bạn đang chờ admin phê duyệt.');
    res.redirect('/login');
  } catch (err) {
    req.flash('error', 'Lỗi đăng ký: ' + err.message);
    res.redirect('/register');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
