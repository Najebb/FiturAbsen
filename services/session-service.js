// services/session-service.js
// ─────────────────────────────────────────────────────────────────────────────
// Session Management Service with DB backing & In-Memory Cache
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const logger = require('../utils/logger');

const sessionCache = new Map(); // token -> sessionObj
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 Menit inactivity timeout
const DEFAULT_SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 Jam default
const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Hari

// Jalankan session cleanup otomatis setiap 10 menit
setInterval(() => {
  SessionService.cleanupExpiredSessions().catch(err => {
    logger.error('[Session Service] Gagal membersihkan sesi kedaluwarsa:', err);
  });
}, 10 * 60 * 1000);

const SessionService = {
  /**
   * Membuat sesi baru untuk user
   */
  createSession: async (userId, ip, userAgent, rememberMe = false) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const duration = rememberMe ? REMEMBER_ME_DURATION_MS : DEFAULT_SESSION_DURATION_MS;
    const expiresAt = new Date(now + duration).toISOString();

    const sessionData = {
      id: token,
      user_id: userId,
      ip_address: ip || '127.0.0.1',
      user_agent: userAgent || 'Unknown',
      created_at: new Date(now).toISOString(),
      last_activity: new Date(now).toISOString(),
      expires_at: expiresAt,
      remember_me: rememberMe ? 1 : 0
    };

    // Simpan ke database
    const stmt = proxy.db.prepare(`
      INSERT INTO sessions (id, user_id, ip_address, user_agent, created_at, last_activity, expires_at, remember_me)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      sessionData.id,
      sessionData.user_id,
      sessionData.ip_address,
      sessionData.user_agent,
      sessionData.created_at,
      sessionData.last_activity,
      sessionData.expires_at,
      sessionData.remember_me
    );

    // Simpan ke in-memory cache untuk performa
    sessionCache.set(token, sessionData);

    return token;
  },

  /**
   * Validasi token sesi, periksa kedaluwarsa & inactivity timeout
   */
  validateSession: async (token) => {
    if (!token) return null;

    let session = sessionCache.get(token);
    const proxy = require('../routes/absen-proxy');

    // Jika tidak ada di cache, coba cari di DB
    if (!session && proxy.db) {
      try {
        const row = proxy.db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
        if (row) {
          session = row;
          sessionCache.set(token, session);
        }
      } catch (e) {
        logger.error('[Session Service] Gagal query sesi dari DB:', e);
      }
    }

    if (!session) return null;

    const now = Date.now();
    const expiresAtMs = new Date(session.expires_at).getTime();
    const lastActivityMs = new Date(session.last_activity).getTime();

    // 1. Cek Hard Expiration
    if (now > expiresAtMs) {
      await SessionService.destroySession(token);
      return null;
    }

    // 2. Cek Idle Timeout (Hanya jika remember_me tidak dicentang)
    if (session.remember_me === 0) {
      if (now - lastActivityMs > IDLE_TIMEOUT_MS) {
        await SessionService.destroySession(token);
        return null;
      }
    }

    // 3. Update Last Activity (Debounce DB write agar hemat write IO)
    session.last_activity = new Date(now).toISOString();
    sessionCache.set(token, session);

    // Update DB asinkron
    setImmediate(() => {
      try {
        if (proxy.db) {
          proxy.db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?')
            .run(session.last_activity, token);
        }
      } catch (e) {
        logger.error('[Session Service] Gagal memperbarui aktivitas sesi di DB:', e);
      }
    });

    return session;
  },

  /**
   * Menghapus sesi tertentu
   */
  destroySession: async (token) => {
    if (!token) return;
    sessionCache.delete(token);

    const proxy = require('../routes/absen-proxy');
    if (proxy.db) {
      try {
        proxy.db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
      } catch (e) {
        logger.error('[Session Service] Gagal menghapus sesi dari DB:', e);
      }
    }
  },

  /**
   * Menghapus seluruh sesi milik seorang user
   */
  destroyAllUserSessions: async (userId) => {
    if (!userId) return;

    // Hapus dari in-memory cache
    for (const [token, session] of sessionCache.entries()) {
      if (session.user_id === userId) {
        sessionCache.delete(token);
      }
    }

    const proxy = require('../routes/absen-proxy');
    if (proxy.db) {
      try {
        proxy.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      } catch (e) {
        logger.error('[Session Service] Gagal menghapus seluruh sesi user dari DB:', e);
      }
    }
  },

  /**
   * Mendapatkan seluruh sesi aktif dengan informasi user terhubung
   */
  getActiveSessions: () => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) return [];

    try {
      // Ambil langsung dari DB untuk konsistensi
      return proxy.db.prepare(`
        SELECT s.*, u.username, u.role, u.email
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.last_activity DESC
      `).all();
    } catch (e) {
      logger.error('[Session Service] Gagal mengambil daftar sesi aktif:', e);
      return [];
    }
  },

  /**
   * Membersihkan sesi kedaluwarsa secara berkala
   */
  cleanupExpiredSessions: async () => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) return;

    const now = new Date().toISOString();
    try {
      // Hapus yang melewati expires_at
      proxy.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
      
      // Hapus yang inactivity timeout (remember_me = 0 dan idle > 30 menit)
      const idleLimit = new Date(Date.now() - IDLE_TIMEOUT_MS).toISOString();
      proxy.db.prepare('DELETE FROM sessions WHERE remember_me = 0 AND last_activity < ?').run(idleLimit);

      // Bersihkan in-memory cache
      for (const [token, session] of sessionCache.entries()) {
        const expiresAtMs = new Date(session.expires_at).getTime();
        const lastActivityMs = new Date(session.last_activity).getTime();
        const nowMs = Date.now();

        if (nowMs > expiresAtMs || (session.remember_me === 0 && (nowMs - lastActivityMs > IDLE_TIMEOUT_MS))) {
          sessionCache.delete(token);
        }
      }
    } catch (e) {
      logger.error('[Session Service] Gagal membersihkan sesi kedaluwarsa:', e);
    }
  }
};

module.exports = SessionService;
