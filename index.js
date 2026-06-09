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
  app.use('/absen-assets', express.static(moduleExports.frontendDir));  // Load Security Services
  const UserService = require('./services/user-service');
  const SessionService = require('./services/session-service');
  const AuditService = require('./services/audit-service');

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

    if (record.count >= 10) { // Berikan toleransi sedikit lebih tinggi karena lockout ditangani username
      const waitSecs = Math.round((record.resetAt - now) / 1000);
      return res.status(429).json({
        success: false,
        error: `Terlalu banyak percobaan masuk dari IP ini. Silakan coba lagi dalam ${waitSecs} detik.`
      });
    }

    record.count++;
    loginAttempts.set(ip, record);
    next();
  }

  // API Otentikasi
  app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
    const { username, password, rememberMe } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi!' });
    }

    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    try {
      const authResult = await UserService.verifyPassword(username, password);
      
      if (!authResult.success) {
        // Catat audit kegagalan login
        AuditService.log(null, username, 'GUEST', 'LOGIN_FAILED', 'User Session', authResult.error, ip);
        return res.status(401).json({ success: false, error: authResult.error });
      }

      const user = authResult.user;
      
      // Buat session token baru
      const token = await SessionService.createSession(user.id, ip, userAgent, !!rememberMe);
      
      // Bersihkan login attempts IP
      loginAttempts.delete(ip);

      // Catat audit keberhasilan login
      AuditService.log(user.id, user.username, user.role, 'LOGIN', 'User Session', 'Login sukses ke dashboard', ip);

      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Terjadi kesalahan internal server.' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const token = req.headers['x-auth-token'];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const session = await SessionService.validateSession(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Ambil data user terbaru dari DB
    const proxy = require('./routes/absen-proxy');
    if (proxy.db) {
      const user = proxy.db.prepare('SELECT id, username, role, email, status, student_account_id FROM users WHERE id = ?').get(session.user_id);
      if (user && user.status === 'active') {
        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email,
            student_account_id: user.student_account_id
          }
        });
      }
    }
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) {
      const session = await SessionService.validateSession(token);
      if (session) {
        // Log audit logout
        const proxy = require('./routes/absen-proxy');
        if (proxy.db) {
          const user = proxy.db.prepare('SELECT username, role FROM users WHERE id = ?').get(session.user_id);
          const username = user ? user.username : 'Unknown';
          const role = user ? user.role : 'Unknown';
          const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
          AuditService.log(session.user_id, username, role, 'LOGOUT', 'User Session', 'Logout berhasil', ip);
        }
        await SessionService.destroySession(token);
      }
    }
    res.json({ success: true });
  });

  // Middleware proteksi API pada port 3001 dengan Session Expiration & Timeout
  async function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Harap login terlebih dahulu.' });
    }

    const session = await SessionService.validateSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Sesi Anda telah kedaluwarsa atau tidak aktif. Silakan login kembali.' });
    }

    const proxy = require('./routes/absen-proxy');
    if (!proxy.db) {
      return res.status(500).json({ success: false, message: 'Koneksi database terputus.' });
    }

    const user = proxy.db.prepare('SELECT id, username, role, email, status, student_account_id FROM users WHERE id = ?').get(session.user_id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Pengguna sesi ini tidak terdaftar.' });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({ success: false, message: 'Akun Anda dinonaktifkan oleh administrator.' });
    }

    if (user.status === 'locked') {
      return res.status(403).json({ success: false, message: 'Akun Anda sedang terkunci.' });
    }

    // Pasang metadata user ke request object agar middleware RBAC di route dapat membacanya
    req.user = user;
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
