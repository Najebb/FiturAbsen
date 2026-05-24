const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

const BACKUP_DIR = path.join(path.dirname(config.dbPath), 'backups');
const MAX_BACKUPS = 10;

const BackupService = {
  /**
   * Menjalankan proses backup SQLite instan secara aman
   */
  backupNow: async () => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      // Check if primary database exists
      if (!fs.existsSync(config.dbPath)) {
        logger.warn(`[Backup Service] Database primer ${config.dbPath} tidak ditemukan. Membatalkan backup.`);
        return null;
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const backupFileName = `absen_backup_${timestamp}.db`;
      const backupFilePath = path.join(BACKUP_DIR, backupFileName);

      // Perform safe file copy
      fs.copyFileSync(config.dbPath, backupFilePath);
      logger.info(`[Backup Service] Cadangan database SQLite berhasil dibuat: ${backupFileName}`);

      // Rotate backups to keep only the last MAX_BACKUPS (10) copies
      await BackupService.rotateBackups();

      return backupFileName;
    } catch (e) {
      logger.error('[Backup Service] Gagal membuat cadangan database SQLite:', e);
      throw e;
    }
  },

  /**
   * Mengembalikan database utama dari berkas cadangan tertentu
   */
  restoreBackup: async (backupFileName) => {
    try {
      const backupFilePath = path.join(BACKUP_DIR, backupFileName);
      if (!fs.existsSync(backupFilePath)) {
        throw new Error('Berkas cadangan database tidak ditemukan.');
      }

      logger.warn(`[Backup Service] Memulai proses pemulihan database dari berkas: ${backupFileName}`);

      // Lazy require proxy to obtain database instance and close it temporarily
      const proxy = require('../routes/absen-proxy');
      
      if (proxy.db) {
        try {
          logger.info('[Backup Service] Menutup koneksi database aktif untuk pemulihan...');
          proxy.db.close();
        } catch (e) {
          logger.warn('[Backup Service] Warning saat menutup koneksi database:', e.message);
        }
      }

      // Copy backup file over primary DB file
      fs.copyFileSync(backupFilePath, config.dbPath);
      logger.info('[Backup Service] Salinan berkas cadangan berhasil ditulis ke berkas database utama.');

      // Re-initialize database connection in proxy router
      try {
        const Database = require('better-sqlite3');
        proxy.db = new Database(config.dbPath);
        
        // Ensure circular reference DB updates too
        proxy.db = proxy.db; 
        logger.info('[Backup Service] Koneksi database SQLite primer berhasil dibuka kembali.');
      } catch (err) {
        logger.error('[Backup Service] Gagal membuka kembali koneksi database SQLite setelah restore!', err);
        throw err;
      }

      return true;
    } catch (e) {
      logger.error('[Backup Service] Gagal melakukan pemulihan database:', e);
      throw e;
    }
  },

  /**
   * Menampilkan seluruh berkas cadangan database yang tersedia
   */
  listBackups: () => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return [];

      return fs.readdirSync(BACKUP_DIR)
        .filter(file => file.startsWith('absen_backup_') && file.endsWith('.db'))
        .map(file => {
          const filePath = path.join(BACKUP_DIR, file);
          const stat = fs.statSync(filePath);
          return {
            filename: file,
            sizeBytes: stat.size,
            createdAt: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
      logger.error('[Backup Service] Gagal memuat daftar cadangan database:', e);
      return [];
    }
  },

  /**
   * Rotasi berkas backup untuk menjaga jumlah file tetap hemat (maksimal 10)
   */
  rotateBackups: async () => {
    try {
      const backups = BackupService.listBackups();
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const file of toDelete) {
          const filePath = path.join(BACKUP_DIR, file.filename);
          fs.unlinkSync(filePath);
          logger.info(`[Backup Service] Rotasi: Menghapus cadangan lama: ${file.filename}`);
        }
      }
    } catch (e) {
      logger.error('[Backup Service] Gagal melakukan rotasi cadangan database:', e);
    }
  }
};

module.exports = BackupService;
