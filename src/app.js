const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const db = require('./db/connection');
const { errorHandler } = require('./middleware/errorHandler');
const { AppError } = require('./utils/response');

const authRoutes = require('./routes/auth.routes');
const passwordResetRoutes = require('./routes/passwordReset.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const casesRoutes = require('./routes/cases.routes');
const clientsRoutes = require('./routes/clients.routes');
const tasksRoutes = require('./routes/tasks.routes');
const notesRoutes = require('./routes/notes.routes');
const documentsRoutes = require('./routes/documents.routes');
const eventsRoutes = require('./routes/events.routes');
const communicationsRoutes = require('./routes/communications.routes');
const adminRoutes = require('./routes/admin.routes');
const pushRoutes = require('./routes/push.routes');
const remindersRoutes = require('./routes/reminders.routes');
const aiRoutes = require('./routes/ai.routes');
const portalRoutes = require('./routes/portal.routes');
const notificationRoutes = require('./routes/notification.routes');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    // Inline scripts/styles and onclick handlers live in index.html + admin.html.
    // Removing 'unsafe-inline' from script-src requires extracting all inline JS to
    // external files and replacing onclick=* with addEventListener — see CSP notes
    // in production hardening report. style-src similarly needs class-based CSS.
    contentSecurityPolicy: config.isProd ? {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': []
      }
    } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
    frameguard: { action: 'deny' },
    noSniff: true
  }));

  // Permissions-Policy (not all covered by helmet defaults)
  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    );
    next();
  });

  app.use(cors({
    origin(origin, cb) {
      // Allow same-origin / non-browser tools (no Origin header)
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new AppError('CORS مجاز نیست', 403));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  const root = path.join(__dirname, '..');

  // Never expose internals, uploads, DB, backups, or audit dumps
  app.use([
    '/storage', '/database', '/src', '/.env', '/scripts', '/backups',
    '/node_modules', '/npm-audit.json', '/npm-outdated.json', '/.git'
  ], (req, res) => {
    res.status(404).json({ error: 'یافت نشد' });
  });

  const publicFiles = new Set([
    'index.html', 'admin.html', 'logout.html', 'offline.html', 'manifest.json', 'sw.js',
    'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'
  ]);

  // Service Worker must be served from root scope with no long-lived cache
  app.get('/sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('application/javascript');
    return res.sendFile(path.join(root, 'sw.js'));
  });

  app.get('/manifest.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/manifest+json');
    return res.sendFile(path.join(root, 'manifest.json'));
  });

  app.get(/^\/([^/]+\.(?:html|js|json|svg|png|ico|webmanifest))$/i, (req, res, next) => {
    const name = req.params[0] || path.basename(req.path);
    if (name === 'sw.js' || name === 'manifest.json') return next();
    if (!publicFiles.has(name) && !/\.(png|svg|ico)$/i.test(name)) return next();
    const filePath = path.join(root, name);
    if (!filePath.startsWith(root)) return next();
    return res.sendFile(filePath, (err) => { if (err) next(); });
  });

  app.get('/api/health', async (req, res) => {
    let dbStatus = 'down';
    try {
      await db.raw('select 1 as ok');
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }
    const ok = dbStatus === 'up';
    res.status(ok ? 200 : 503).json({
      ok,
      status: ok ? 'healthy' : 'degraded',
      db: dbStatus,
      time: new Date().toISOString()
    });
  });

  const mfaRoutes = require('./routes/mfa.routes');

  app.use('/api', authRoutes);
  app.use('/api/auth', passwordResetRoutes);
  app.use('/api/mfa', mfaRoutes);
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/cases', casesRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/documents', documentsRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/communications', communicationsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/reminders', remindersRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(root, 'admin.html'));
  });

  app.get('/portal/invite/:token', (req, res) => {
    res.sendFile(path.join(root, 'portal-invite.html'));
  });

  app.get('/portal', (req, res) => {
    res.sendFile(path.join(root, 'client-portal.html'));
  });

  app.get('/login', (req, res) => {
    res.sendFile(path.join(root, 'login.html'));
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next(new AppError('مسیر API یافت نشد', 404));
    }
    return res.sendFile(path.join(root, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
