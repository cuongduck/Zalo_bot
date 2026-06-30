'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { loadUser, requireAuth } = require('./middleware/auth');
const poller = require('./services/poller');

const app = express();
app.set('trust proxy', config.trustProxy ? 1 : 0);

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers (relaxed CSP so inline dashboard scripts/styles work).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://static.cloudflareinsights.com'],
        // Allow inline on* event handlers used by the dashboard buttons.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://cloudflareinsights.com'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      },
    },
  })
);

// Inbound webhook + public send API are mounted BEFORE body parsers/session so
// they use their own JSON parser and skip auth/session overhead. They are
// protected by the bot's secret token instead.
app.use('/', require('./routes/inbound'));
app.use('/', require('./routes/api'));

// Body parsers for the web app.
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sessions stored in MySQL so they survive restarts.
const sessionStore = new MySQLStore({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  createDatabaseTable: true,
});

app.use(
  session({
    key: 'zalobot.sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(flash());
app.use(loadUser);

// Rate limit auth endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

// Routes
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));
app.use('/', authLimiter, require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/bots'));
app.use('/', require('./routes/datasources'));
app.use('/admin', requireAuth, require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Không tìm thấy trang.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).render('error', { title: 'Lỗi', message: config.isProd ? 'Đã xảy ra lỗi máy chủ.' : err.message });
});

const server = app.listen(config.port, () => {
  console.log(`\n  Zalo Bot Platform listening on http://localhost:${config.port}`);
  console.log(`  Public base URL: ${config.appBaseUrl}`);
  console.log(`  Webhook receiver: ${config.appBaseUrl}/webhook/<botId>\n`);
  // Start pollers for polling-mode bots.
  poller.syncAll().catch((e) => console.error('[poller] sync failed:', e.message));
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
