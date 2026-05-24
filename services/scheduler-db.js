// services/scheduler-db.js
// ─────────────────────────────────────────────────────────────────────────────
// Service database untuk modul Auto Attendance Scheduler
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const logger = require('../utils/logger');

// Lazy require to avoid circular dependencies during initialization
let dbInstance = null;
function getDB() {
  if (!dbInstance) {
    const proxy = require('../routes/absen-proxy');
    dbInstance = proxy.db;
  }
  return dbInstance;
}

const SchedulerDB = {
  // ── Configs ──
  getConfigs: () => {
    try {
      const db = getDB();
      return db.prepare(`
        SELECT c.*, a.nama, a.npm 
        FROM scheduler_configs c
        JOIN accounts a ON c.account_id = a.id
        ORDER BY c.created_at DESC
      `).all();
    } catch (e) {
      logger.error('DB Error: SchedulerDB.getConfigs gagal', e);
      return [];
    }
  },

  getConfigById: (id) => {
    try {
      const db = getDB();
      return db.prepare('SELECT * FROM scheduler_configs WHERE id = ?').get(id);
    } catch (e) {
      logger.error(`DB Error: SchedulerDB.getConfigById gagal untuk ID ${id}`, e);
      return null;
    }
  },

  createConfig: ({ account_id, cron_pattern, timezone = 'Asia/Jakarta', is_enabled = 1 }) => {
    try {
      const db = getDB();
      const r = db.prepare(`
        INSERT INTO scheduler_configs (account_id, cron_pattern, timezone, is_enabled)
        VALUES (?, ?, ?, ?)
      `).run(account_id, cron_pattern, timezone, is_enabled);
      return { id: r.lastInsertRowid, account_id, cron_pattern, timezone, is_enabled };
    } catch (e) {
      logger.error('DB Error: SchedulerDB.createConfig gagal', e);
      throw e;
    }
  },

  updateConfig: (id, { cron_pattern, timezone, is_enabled }) => {
    try {
      const db = getDB();
      // Dapatkan config saat ini untuk mempertahankan nilai jika tidak dikirim
      const current = SchedulerDB.getConfigById(id);
      if (!current) throw new Error('Konfigurasi scheduler tidak ditemukan.');

      const newCron = cron_pattern !== undefined ? cron_pattern : current.cron_pattern;
      const newTz = timezone !== undefined ? timezone : current.timezone;
      const newEnabled = is_enabled !== undefined ? is_enabled : current.is_enabled;

      db.prepare(`
        UPDATE scheduler_configs 
        SET cron_pattern = ?, timezone = ?, is_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newCron, newTz, newEnabled, id);
      return { id, cron_pattern: newCron, timezone: newTz, is_enabled: newEnabled };
    } catch (e) {
      logger.error(`DB Error: SchedulerDB.updateConfig gagal untuk ID ${id}`, e);
      throw e;
    }
  },

  deleteConfig: (id) => {
    try {
      const db = getDB();
      const r = db.prepare('DELETE FROM scheduler_configs WHERE id = ?').run(id);
      // Bersihkan juga riwayat failed jobs jika ada
      db.prepare('DELETE FROM scheduler_failed_jobs WHERE scheduler_id = ?').run(id);
      return r.changes > 0;
    } catch (e) {
      logger.error(`DB Error: SchedulerDB.deleteConfig gagal untuk ID ${id}`, e);
      throw e;
    }
  },

  // ── History ──
  getHistory: (limit = 100) => {
    try {
      const db = getDB();
      return db.prepare(`
        SELECT h.*, a.nama, a.npm, c.cron_pattern
        FROM scheduler_history h
        JOIN accounts a ON h.account_id = a.id
        LEFT JOIN scheduler_configs c ON h.scheduler_id = c.id
        ORDER BY h.executed_at DESC 
        LIMIT ?
      `).all(limit);
    } catch (e) {
      logger.error('DB Error: SchedulerDB.getHistory gagal', e);
      return [];
    }
  },

  insertHistory: ({ scheduler_id, account_id, status, message }) => {
    try {
      const db = getDB();
      const r = db.prepare(`
        INSERT INTO scheduler_history (scheduler_id, account_id, status, message)
        VALUES (?, ?, ?, ?)
      `).run(scheduler_id, account_id, status, message);
      return { id: r.lastInsertRowid, scheduler_id, account_id, status, message };
    } catch (e) {
      logger.error('DB Error: SchedulerDB.insertHistory gagal', e);
      return null;
    }
  },

  // ── Failed Jobs (Retry Mechanism) ──
  getFailedJobs: () => {
    try {
      const db = getDB();
      return db.prepare('SELECT * FROM scheduler_failed_jobs ORDER BY created_at ASC').all();
    } catch (e) {
      logger.error('DB Error: SchedulerDB.getFailedJobs gagal', e);
      return [];
    }
  },

  getFailedJobByScheduler: (scheduler_id) => {
    try {
      const db = getDB();
      return db.prepare('SELECT * FROM scheduler_failed_jobs WHERE scheduler_id = ?').get(scheduler_id);
    } catch (e) {
      logger.error(`DB Error: SchedulerDB.getFailedJobByScheduler gagal untuk ID ${scheduler_id}`, e);
      return null;
    }
  },

  insertOrUpdateFailedJob: ({ scheduler_id, account_id, retry_count, last_error, next_retry_at }) => {
    try {
      const db = getDB();
      const existing = SchedulerDB.getFailedJobByScheduler(scheduler_id);
      if (existing) {
        db.prepare(`
          UPDATE scheduler_failed_jobs 
          SET retry_count = ?, last_error = ?, next_retry_at = ?, created_at = CURRENT_TIMESTAMP
          WHERE scheduler_id = ?
        `).run(retry_count, last_error, next_retry_at, scheduler_id);
      } else {
        db.prepare(`
          INSERT INTO scheduler_failed_jobs (scheduler_id, account_id, retry_count, last_error, next_retry_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(scheduler_id, account_id, retry_count, last_error, next_retry_at);
      }
      return { scheduler_id, account_id, retry_count, last_error, next_retry_at };
    } catch (e) {
      logger.error('DB Error: SchedulerDB.insertOrUpdateFailedJob gagal', e);
      throw e;
    }
  },

  deleteFailedJobByScheduler: (scheduler_id) => {
    try {
      const db = getDB();
      db.prepare('DELETE FROM scheduler_failed_jobs WHERE scheduler_id = ?').run(scheduler_id);
      return true;
    } catch (e) {
      logger.error(`DB Error: SchedulerDB.deleteFailedJobByScheduler gagal`, e);
      return false;
    }
  }
};

module.exports = SchedulerDB;
