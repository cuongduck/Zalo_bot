'use strict';

const express = require('express');
const Bot = require('../models/bot');
const Datasource = require('../models/datasource');
const User = require('../models/user');
const { requireApproved } = require('../middleware/auth');

const router = express.Router();
router.use(requireApproved);

router.get('/dashboard', async (req, res) => {
  const bots = await Bot.listForUser(req.user.id);
  const datasources = await Datasource.listForUser(req.user.id);
  let pendingCount = 0;
  if (req.user.role === 'admin') {
    const counts = await User.countByStatus();
    pendingCount = counts.pending || 0;
  }
  res.render('dashboard', {
    title: 'Bảng điều khiển',
    bots,
    datasources,
    pendingCount,
  });
});

module.exports = router;
