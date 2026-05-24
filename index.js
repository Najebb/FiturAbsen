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

  // Kredensial & Security Hardening untuk login dashboard mandiri
  const crypto = require('crypto');
  const tokens = new Map(); // token -> { createdAt: timestamp, lastActivity: timestamp }
  
  const DASHBOARD_USER = process.env.ABSEN_DASHBOARD_USER || 'admin';
  const DASHBOARD_PASS = process.env.ABSEN_DASHBOARD_PASS || 'admin';
  const DASHBOARD_SALT = process.env.ABSEN_DASHBOARD_SALT || 'absensi_salt_123';
  
  // Hash PBKDF2 aman (Timing-safe) untuk verifikasi password admin
  const storedHash = process.env.ABSEN_DASHBOARD_PASS_HASH || 
    crypto.pbkdf2Sync(DASHBOARD_PASS, DASHBOARD_SALT, 1000, 64, 'sha512').toString('hex');

  // Rate Limiting Ringan In-Memory untuk Brute-Force Protection
  const loginAttempts = new Map(); // ip -> { count: number, resetAt: timestamp }
  
  function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const record = loginAttempts.get(ip) || { count: 0, resetAt: now + 60 * 1000 };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + 60 * 1000;
    }

    if (record.count >= 5) {
      const waitSecs = Math.round((record.resetAt - now) / 1000);
      return res.status(429).json({
        success: false,
        error: `Terlalu banyak percobaan login gagal. Silakan coba lagi dalam ${waitSecs} detik.`
      });
    }

    record.count++;
    loginAttempts.set(ip, record);
    next();
  }

  // API Otentikasi
  app.post('/api/auth/login', loginRateLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi!' });
    }

    // Hitung hash PBKDF2 dari password masukan
    const inputHash = crypto.pbkdf2Sync(password, DASHBOARD_SALT, 1000, 64, 'sha512').toString('hex');
    
    const inputUsernameBuffer = Buffer.from(username);
    const expectedUsernameBuffer = Buffer.from(DASHBOARD_USER);
    const inputHashBuffer = Buffer.from(inputHash);
    const expectedHashBuffer = Buffer.from(storedHash);

    // Timing-safe cryptographic comparison
    const isUsernameMatch = inputUsernameBuffer.length === expectedUsernameBuffer.length &&
      crypto.timingSafeEqual(inputUsernameBuffer, expectedUsernameBuffer);
    const isPasswordMatch = inputHashBuffer.length === expectedHashBuffer.length &&
      crypto.timingSafeEqual(inputHashBuffer, expectedHashBuffer);

    if (isUsernameMatch && isPasswordMatch) {
      const token = crypto.randomBytes(32).toString('hex');
      tokens.set(token, {
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      
      // Clear rate limiting attempts on successful login
      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      loginAttempts.delete(ip);

      return res.json({ success: true, token });
    }

    return res.status(401).json({ success: false, error: 'Username atau password salah!' });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token && tokens.has(token)) {
      const tokenMeta = tokens.get(token);
      tokenMeta.lastActivity = Date.now();
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

  // Middleware proteksi API pada port 3001 dengan Session Expiration
  function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token || !tokens.has(token)) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Harap login terlebih dahulu.' });
    }

    const tokenMeta = tokens.get(token);
    const now = Date.now();
    
    const maxSessionAge = 12 * 60 * 60 * 1000; // 12 Jam Maksimal
    const maxIdleTime = 30 * 60 * 1000;        // 30 Menit Tidak Aktif

    const sessionAge = now - tokenMeta.createdAt;
    const idleTime = now - tokenMeta.lastActivity;

    if (sessionAge > maxSessionAge || idleTime > maxIdleTime) {
      tokens.delete(token);
      return res.status(401).json({ success: false, message: 'Sesi Anda telah kedaluwarsa karena tidak ada aktivitas. Silakan login kembali.' });
    }

    // Perbarui aktivitas terakhir
    tokenMeta.lastActivity = now;
    next();
  }

  // Mount API endpoints
  app.use('/api', (req, res, next) => {
    // Health check dibiarkan publik agar termonitor
    if (req.path === '/health') return next();
    return requireAuth(req, res, next);
  }, moduleExports.router);

  // Inisialisasi dan jalankan scheduler
  const scheduler = require('./scheduler/manager');
  scheduler.start();

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('====================================================');
    logger.info(`🚀 Standalone Absensi Dashboard: http://localhost:${PORT}`);
    logger.info('====================================================');
  });

  // Graceful shutdown handling
  const gracefulShutdown = async () => {
    logger.info('[Standalone Server] Shutdown signal diterima. Mematikan layanan...');
    scheduler.stop();
    
    // Shut down shared browser pool gracefully
    try {
      const browserManager = require('./utils/browser-manager');
      await browserManager.gracefulShutdown();
    } catch (e) {
      logger.warn('[Standalone Server] Gagal menutup instansi browser pool:', e.message);
    }

    server.close(() => {
      logger.info('[Standalone Server] Koneksi Express ditutup. Selesai.');
      process.exit(0);
    });
    // Fallback force shutdown setelah 10 detik
    setTimeout(() => {
      logger.warn('[Standalone Server] Force shutdown dipicu.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

module.exports = moduleExports;
