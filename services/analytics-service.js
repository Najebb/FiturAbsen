// services/analytics-service.js
// ─────────────────────────────────────────────────────────────────────────────
// Facade penghubung database, metrics engine, dan generator laporan
// ─────────────────────────────────────────────────────────────────────────────

const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config/config');
const MetricsEngine = require('./metrics-engine');
const ReportGenerator = require('./report-generator');
const logger = require('../utils/logger');

const db = new Database(config.dbPath);

const AnalyticsService = {
  getOverview: () => {
    try {
      const logs = db.prepare('SELECT * FROM absen_log').all();
      const history = db.prepare('SELECT * FROM scheduler_history').all();
      const accounts = db.prepare('SELECT * FROM accounts').all();
      return {
        success: true,
        data: MetricsEngine.calculateOverview(logs, history, accounts)
      };
    } catch (e) {
      logger.error('[Analytics Service] Gagal mengambil data overview:', e);
      return { success: false, message: e.message };
    }
  },

  getTrends: (days = 7) => {
    try {
      const logs = db.prepare(`
        SELECT * FROM absen_log 
        WHERE datetime(absen_at) >= datetime('now', 'localtime', ?)
      `).all(`-${days} days`);
      
      const trends = MetricsEngine.calculateTrends(logs, days);
      return {
        success: true,
        data: trends
      };
    } catch (e) {
      logger.error('[Analytics Service] Gagal mengambil data tren:', e);
      return { success: false, message: e.message };
    }
  },

  getFailures: () => {
    try {
      const logs = db.prepare('SELECT * FROM absen_log').all();
      const history = db.prepare('SELECT * FROM scheduler_history').all();
      const accounts = db.prepare('SELECT * FROM accounts').all();
      
      const failures = MetricsEngine.calculateFailures(logs, history, accounts);
      return {
        success: true,
        data: failures
      };
    } catch (e) {
      logger.error('[Analytics Service] Gagal mengambil data failures:', e);
      return { success: false, message: e.message };
    }
  },

  getScheduler: () => {
    try {
      const activeJobsCount = db.prepare('SELECT COUNT(*) as count FROM scheduler_configs WHERE is_enabled = 1').get().count;
      const history = db.prepare('SELECT * FROM scheduler_history ORDER BY executed_at DESC LIMIT 100').all();
      
      const totalExecs = history.length;
      const successCount = history.filter(h => h.status === 'berhasil').length;
      const failedCount = history.filter(h => h.status === 'failed').length;
      const skippedCount = history.filter(h => h.status === 'skipped').length;
      
      const successRate = totalExecs > 0 ? Math.round((successCount / (successCount + failedCount)) * 100) : 100;

      return {
        success: true,
        data: {
          activeJobsCount,
          totalExecs,
          successCount,
          failedCount,
          skippedCount,
          successRate,
          recentHistory: history
        }
      };
    } catch (e) {
      logger.error('[Analytics Service] Gagal mengambil data scheduler:', e);
      return { success: false, message: e.message };
    }
  },

  exportReport: async (format, days = 30) => {
    try {
      const logs = db.prepare(`
        SELECT l.*, a.nama, a.npm FROM absen_log l
        JOIN accounts a ON a.id = l.account_id
        WHERE datetime(l.absen_at) >= datetime('now', 'localtime', ?)
        ORDER BY l.absen_at DESC
      `).all(`-${days} days`);

      const history = db.prepare(`
        SELECT * FROM scheduler_history 
        WHERE datetime(executed_at) >= datetime('now', 'localtime', ?)
      `).all(`-${days} days`);

      const accounts = db.prepare('SELECT * FROM accounts').all();
      
      const overview = MetricsEngine.calculateOverview(logs, history, accounts);
      const failures = MetricsEngine.calculateFailures(logs, history, accounts);
      const trends = MetricsEngine.calculateTrends(logs, days);

      if (format === 'csv' || format === 'excel') {
        const headers = ['ID Log', 'Nama Mahasiswa', 'NPM', 'Kelas Kuliah', 'Status', 'Pesan Hambatan', 'Waktu Absen'];
        const rows = logs.map(l => [
          l.id,
          l.nama,
          l.npm,
          l.kelas || 'Massal',
          l.status.toUpperCase(),
          l.pesan || '',
          l.absen_at
        ]);
        
        const buffer = ReportGenerator.generateCSV(headers, rows);
        const filename = `Laporan_Absensi_Last_${days}_Hari.csv`;
        return {
          success: true,
          buffer,
          contentType: 'text/csv; charset=utf-8',
          filename
        };
      } else if (format === 'pdf') {
        const buffer = await ReportGenerator.generatePDF(overview, failures, trends, days, logs);
        const filename = `Laporan_Absensi_Last_${days}_Hari.pdf`;
        return {
          success: true,
          buffer,
          contentType: 'application/pdf',
          filename
        };
      } else {
        return { success: false, message: 'Format laporan tidak didukung.' };
      }
    } catch (e) {
      logger.error('[Analytics Service] Gagal mengekspor laporan:', e);
      return { success: false, message: e.message };
    }
  }
};

module.exports = AnalyticsService;
