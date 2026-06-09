// services/user-service.js
// ─────────────────────────────────────────────────────────────────────────────
// User Management & Security Governance Service (PBKDF2, Lockout, Policies)
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const logger = require('../utils/logger');

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 Menit

const UserService = {
  /**
   * Validasi kekuatan password (minimal 8 karakter, ada huruf besar, huruf kecil, dan angka)
   */
  validatePasswordStrength: (password) => {
    if (!password || password.length < 8) return false;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    return hasUpperCase && hasLowerCase && hasNumbers;
  },

  /**
   * Membuat hash password menggunakan PBKDF2 dengan salt acak
   */
  hashPassword: (password, customSalt = null) => {
    const salt = customSalt || crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
  },

  /**
   * Membuat pengguna baru di database
   */
  createUser: async (username, email, password, role, studentAccountId = null) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');

    if (!username || !role) {
      throw new Error('Username dan role wajib diisi.');
    }

    if (!UserService.validatePasswordStrength(password)) {
      throw new Error('Password tidak memenuhi kebijakan keamanan: Minimal 8 karakter, wajib memiliki huruf besar, huruf kecil, dan angka.');
    }

    const { salt, hash } = UserService.hashPassword(password);

    try {
      const stmt = proxy.db.prepare(`
        INSERT INTO users (username, email, password_hash, salt, role, status, student_account_id)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
      `);
      const res = stmt.run(username, email || null, hash, salt, role, studentAccountId);
      return { id: res.lastInsertRowid, username, email, role, status: 'active' };
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        throw new Error('Username sudah digunakan.');
      }
      throw e;
    }
  },

  /**
   * Memverifikasi login password & mengelola status account lockout
   */
  verifyPassword: async (username, password) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) return { success: false, error: 'Database tidak terhubung.' };

    try {
      const user = proxy.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) {
        return { success: false, error: 'Username atau password salah!' };
      }

      const now = Date.now();

      // 1. Periksa apakah akun dinonaktifkan
      if (user.status === 'disabled') {
        return { success: false, error: 'Akun Anda dinonaktifkan. Hubungi Administrator.' };
      }

      // 2. Periksa apakah akun sedang terkunci (locked)
      if (user.status === 'locked' && user.locked_until) {
        const lockedUntilMs = new Date(user.locked_until).getTime();
        if (now < lockedUntilMs) {
          const waitMins = Math.round((lockedUntilMs - now) / 60 / 1000);
          return { success: false, error: `Akun terkunci karena terlalu banyak percobaan masuk. Silakan coba lagi dalam ${waitMins} menit.` };
        } else {
          // Cooldown sudah lewat, buka kunci akun
          proxy.db.prepare("UPDATE users SET status = 'active', failed_logins = 0, locked_until = NULL WHERE id = ?").run(user.id);
          user.status = 'active';
          user.failed_logins = 0;
        }
      }

      // 3. Verifikasi hash password
      const inputHash = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
      const inputHashBuffer = Buffer.from(inputHash);
      const expectedHashBuffer = Buffer.from(user.password_hash);

      const isPasswordMatch = inputHashBuffer.length === expectedHashBuffer.length &&
        crypto.timingSafeEqual(inputHashBuffer, expectedHashBuffer);

      if (isPasswordMatch) {
        // Login Sukses: reset percobaan gagal
        if (user.failed_logins > 0) {
          proxy.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
        }
        return { success: true, user };
      } else {
        // Gagal Login: update status gagal
        const nextFailed = (user.failed_logins || 0) + 1;
        if (nextFailed >= LOCKOUT_ATTEMPTS) {
          const lockedUntilStr = new Date(now + LOCKOUT_DURATION_MS).toISOString();
          proxy.db.prepare("UPDATE users SET failed_logins = ?, status = 'locked', locked_until = ? WHERE id = ?")
            .run(nextFailed, lockedUntilStr, user.id);
          return { success: false, error: `Terlalu banyak kegagalan login. Akun Anda dikunci selama 15 menit.` };
        } else {
          proxy.db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(nextFailed, user.id);
          const remaining = LOCKOUT_ATTEMPTS - nextFailed;
          return { success: false, error: `Username atau password salah! (${remaining} percobaan tersisa sebelum terkunci)` };
        }
      }
    } catch (e) {
      logger.error('[User Service] Gagal verifikasi password:', e);
      return { success: false, error: 'Terjadi kesalahan sistem saat otentikasi.' };
    }
  },

  /**
   * Mengubah password pribadi
   */
  changePassword: async (userId, oldPassword, newPassword) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');

    if (!UserService.validatePasswordStrength(newPassword)) {
      throw new Error('Password baru tidak memenuhi kebijakan keamanan: Minimal 8 karakter, wajib memiliki huruf besar, huruf kecil, dan angka.');
    }

    const user = proxy.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('Pengguna tidak ditemukan.');

    // Verifikasi password lama
    const oldHash = crypto.pbkdf2Sync(oldPassword, user.salt, 1000, 64, 'sha512').toString('hex');
    if (oldHash !== user.password_hash) {
      throw new Error('Password lama yang Anda masukkan salah.');
    }

    // Buat hash baru
    const { salt, hash } = UserService.hashPassword(newPassword);
    proxy.db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hash, salt, userId);

    return true;
  },

  /**
   * Admin melakukan reset password user lain
   */
  resetPassword: async (userId, newPassword) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');

    if (!UserService.validatePasswordStrength(newPassword)) {
      throw new Error('Password tidak memenuhi kebijakan keamanan: Minimal 8 karakter, wajib memiliki huruf besar, huruf kecil, dan angka.');
    }

    const { salt, hash } = UserService.hashPassword(newPassword);
    proxy.db.prepare("UPDATE users SET password_hash = ?, salt = ?, failed_logins = 0, status = 'active', locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(hash, salt, userId);

    return true;
  },

  /**
   * Mengambil semua user (tanpa password hash)
   */
  getUsers: () => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) return [];
    try {
      return proxy.db.prepare('SELECT id, username, email, role, status, student_account_id, created_at, updated_at FROM users ORDER BY created_at DESC').all();
    } catch (e) {
      logger.error('[User Service] Gagal query daftar pengguna:', e);
      return [];
    }
  },

  /**
   * Mengubah profile/status user
   */
  updateUser: async (id, { username, email, role, status, studentAccountId }) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');

    try {
      const stmt = proxy.db.prepare(`
        UPDATE users 
        SET username = ?, email = ?, role = ?, status = ?, student_account_id = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run(username, email || null, role, status, studentAccountId || null, id);
      return true;
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        throw new Error('Username sudah digunakan.');
      }
      throw e;
    }
  },

  /**
   * Menghapus user
   */
  deleteUser: async (id) => {
    const proxy = require('../routes/absen-proxy');
    if (!proxy.db) throw new Error('Database tidak terhubung.');
    proxy.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return true;
  }
};

module.exports = UserService;
