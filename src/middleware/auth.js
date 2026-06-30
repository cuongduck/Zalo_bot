'use strict';

const User = require('../models/user');

/** Load the current user (if any) from the session onto req.user / res.locals. */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.flash = req.flash ? { success: req.flash('success'), error: req.flash('error') } : { success: [], error: [] };
  if (req.session && req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (user) {
        req.user = user;
        res.locals.currentUser = user;
      } else {
        req.session.destroy(() => {});
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.flash) req.flash('error', 'Vui lòng đăng nhập để tiếp tục.');
    return res.redirect('/login');
  }
  next();
}

function requireApproved(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.status !== 'approved') {
    return res.status(403).render('pending', { title: 'Chờ phê duyệt' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Bạn không có quyền truy cập trang này.' });
  }
  next();
}

module.exports = { loadUser, requireAuth, requireApproved, requireAdmin };
