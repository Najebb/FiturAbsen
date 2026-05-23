// =============================================================================
// Absensi SIMKULIAH — Module Entry Point
// =============================================================================

const path = require('path');
const express = require('express');

const moduleExports = {
  // Express router untuk API endpoints absensi
  router: require('./routes/absen-proxy'),

  // Path ke folder frontend (HTML, CSS, JS)
  frontendDir: path.join(__dirname, 'frontend'),

  // Path ke folder data
  dataDir: path.join(__dirname, 'data'),

  // Metadata module
  name: 'absensi-simkuliah',
  version: '1.0.0',
  description: 'Modul absensi otomatis SIMKULIAH dengan Playwright + OCR captcha',
};

// Menjalankan Express server mandiri pada port 3001 jika file dipanggil langsung
if (require.main === module) {
  const config = require('./config/config');
  const logger = require('./utils/logger');

  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(express.json());

  // Serve folder dashboard statis
  const dashboardDir = path.join(__dirname, 'dashboard');
  app.use('/', express.static(dashboardDir));

  // Serve static assets modul absensi
  app.use('/absen-assets', express.static(moduleExports.frontendDir));

  // Kredensial untuk login dashboard mandiri
  const tokens = new Set();
  const DASHBOARD_USER = process.env.ABSEN_DASHBOARD_USER || 'admin';
  const DASHBOARD_PASS = process.env.ABSEN_DASHBOARD_PASS || 'admin';

  // API Otentikasi
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === DASHBOARD_USER && password === DASHBOARD_PASS) {
      const token = require('crypto').randomBytes(32).toString('hex');
      tokens.add(token);
      return res.json({ success: true, token });
    }
    return res.status(401).json({ success: false, error: 'Username atau password salah!' });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token && tokens.has(token)) {
      return res.json({ success: true, username: DASHBOARD_USER });
    }
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) {
      tokens.delete(token);
    }
    res.json({ success: true });
  });

  // Middleware proteksi API pada port 3001
  function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token || !tokens.has(token)) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Harap login terlebih dahulu.' });
    }
    next();
  }

  // Mount API endpoints
  app.use('/api', (req, res, next) => {
    // Health check dibiarkan publik agar termonitor
    if (req.path === '/health') return next();
    return requireAuth(req, res, next);
  }, moduleExports.router);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('====================================================');
    logger.info(`🚀 Standalone Absensi Dashboard: http://localhost:${PORT}`);
    logger.info('====================================================');
  });
}

module.exports = moduleExports;
