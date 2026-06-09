// services/audit-service.js
// ─────────────────────────────────────────────────────────────────────────────
// Audit Trail Service
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../utils/logger');

const AuditService = {
  /**
   * Mencatat log audit secara asinkron ke database
   */
  log: (userId, username, role, action, resource, details, ip) => {
    // Jalankan secara asinkron menggunakan setImmediate agar tidak memblokir respon HTTP
    setImmediate(() => {
      try {
        const proxy = require('../routes/absen-proxy');
        if (!proxy.db) {
          logger.warn('[Audit Service] Gagal menyimpan log audit: Database tidak tersedia.');
          return;
        }

        const stmt = proxy.db.prepare(`
          INSERT INTO audit_logs (user_id, username, role, action, resource, details, ip_address)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          userId || null,
          username || 'SYSTEM',
          role || 'SYSTEM',
          action,
          resource || null,
          details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : null,
          ip || '127.0.0.1'
        );
      } catch (err) {
        logger.error('[Audit Service] Gagal menulis ke tabel audit_logs:', err);
      }
    });
  },

  /**
   * Helper untuk log aktivitas dari request Express
   */
  logRequest: (req, action, resource, details) => {
    const user = req.user || {};
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    AuditService.log(user.id, user.username, user.role, action, resource, details, ip);
  }
};

module.exports = AuditService;
