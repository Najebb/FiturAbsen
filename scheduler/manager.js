// scheduler/manager.js
// ─────────────────────────────────────────────────────────────────────────────
// Core Scheduler Manager untuk Absensi SIMKULIAH menggunakan node-cron
// ─────────────────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const logger = require('../utils/logger');
const SchedulerDB = require('../services/scheduler-db');
const AbsensiWorker = require('../workers/absensi-worker');

class SchedulerManager {
  constructor() {
    // Menyimpan cron task instance aktif (key: schedulerId)
    this.activeTasks = new Map();
    // Tracker untuk recovery/failed queue processor
    this.failedQueueInterval = null;
    // Scheduler status metadata
    this.startTime = Date.now();
    this.status = 'initialized'; // initialized, running, stopped
  }

  /**
   * Menyalakan scheduler manager dan mendaftarkan cron jobs dari database
   */
  start() {
    if (this.status === 'running') {
      logger.warn('[Scheduler Manager] Scheduler sudah berjalan.');
      return;
    }

    logger.info('[Scheduler Manager] Memulai inisialisasi cron scheduler...');
    this.status = 'running';

    // 1. Daftarkan cron jobs aktif dari DB
    this.loadAllActiveJobs();

    // 2. Jalankan Failed Queue Processor (Recovery & Retry)
    // Berjalan berkala setiap 5 menit untuk mencari jadwal gagal yang siap diretry
    this.startFailedQueueInterval();

    logger.info('[Scheduler Manager] Scheduler system berjalan aktif.');
  }

  /**
   * Menghentikan semua cron task secara total (Graceful Shutdown)
   */
  stop() {
    logger.info('[Scheduler Manager] Mematikan sistem scheduler...');
    this.status = 'stopped';

    // Bersihkan interval failed queue
    if (this.failedQueueInterval) {
      clearInterval(this.failedQueueInterval);
      this.failedQueueInterval = null;
    }

    // Stop all cron tasks
    for (const [id, task] of this.activeTasks.entries()) {
      task.stop();
      logger.info(`[Scheduler Manager] Menghentikan task scheduler ID: ${id}`);
    }
    this.activeTasks.clear();
    logger.info('[Scheduler Manager] Sistem scheduler berhasil dimatikan secara bersih.');
  }

  /**
   * Memuat dan mendaftarkan seluruh jadwal aktif dari database
   */
  loadAllActiveJobs() {
    try {
      const configs = SchedulerDB.getConfigs();
      const activeConfigs = configs.filter(c => c.is_enabled === 1);
      
      logger.info(`[Scheduler Manager] Ditemukan ${activeConfigs.length} jadwal aktif untuk didaftarkan.`);

      for (const config of activeConfigs) {
        this.registerJob(config);
      }
    } catch (e) {
      logger.error('[Scheduler Manager] Gagal memuat jadwal aktif dari database:', e);
    }
  }

  /**
   * Mendaftarkan satu job scheduler baru ke node-cron
   */
  registerJob(config) {
    const { id, cron_pattern, timezone, nama, npm } = config;

    // Bersihkan job lama jika sudah terdaftar sebelumnya
    if (this.activeTasks.has(id)) {
      this.unregisterJob(id);
    }

    // Validasi cron pattern
    if (!cron.validate(cron_pattern)) {
      logger.error(`[Scheduler Manager] Cron pattern "${cron_pattern}" tidak valid untuk Scheduler ID ${id}!`);
      return false;
    }

    try {
      const task = cron.schedule(cron_pattern, async () => {
        logger.info(`[Scheduler Manager] Trigger jadwal otomatis Scheduler ID ${id} (${nama} - ${npm})`);
        await AbsensiWorker.execute(config);
      }, {
        scheduled: true,
        timezone: timezone || 'Asia/Jakarta'
      });

      this.activeTasks.set(id, task);
      logger.info(`[Scheduler Manager] Job terdaftar: ID ${id} | NPM ${npm} | Cron [${cron_pattern}] | TZ: ${timezone}`);
      return true;
    } catch (e) {
      logger.error(`[Scheduler Manager] Gagal mendaftarkan job ID ${id}:`, e);
      return false;
    }
  }

  /**
   * Menghapus registrasi job dari node-cron
   */
  unregisterJob(id) {
    const task = this.activeTasks.get(id);
    if (task) {
      task.stop();
      this.activeTasks.delete(id);
      logger.info(`[Scheduler Manager] Job dihentikan & dilepas: ID ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Memuat ulang job scheduler tertentu (misalnya setelah edit atau aktif/nonaktifkan)
   */
  reloadJob(id) {
    try {
      const config = SchedulerDB.getConfigById(id);
      if (!config) {
        this.unregisterJob(id);
        return;
      }

      if (config.is_enabled === 1) {
        // Ambil data detail akun untuk log
        const proxy = require('../routes/absen-proxy');
        const acc = proxy.Accounts.getById(config.account_id);
        const detailedConfig = {
          ...config,
          nama: acc ? acc.nama : 'Unknown',
          npm: acc ? acc.npm : '0'
        };
        this.registerJob(detailedConfig);
      } else {
        this.unregisterJob(id);
      }
    } catch (e) {
      logger.error(`[Scheduler Manager] Gagal reload job ID ${id}:`, e);
    }
  }

  /**
   * Loop interval untuk recovery/failed queue. Mencari failed_jobs yang waktu retry-nya sudah lewat.
   */
  startFailedQueueInterval() {
    if (this.failedQueueInterval) clearInterval(this.failedQueueInterval);

    // Jalankan setiap 5 menit
    this.failedQueueInterval = setInterval(async () => {
      if (this.status !== 'running') return;

      try {
        const failedJobs = SchedulerDB.getFailedJobs();
        if (failedJobs.length === 0) return;

        const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const readyJobs = failedJobs.filter(job => job.next_retry_at && job.next_retry_at <= nowStr);

        if (readyJobs.length > 0) {
          logger.info(`[Scheduler Manager] Ditemukan ${readyJobs.length} retry job yang siap diproses ulang.`);
          for (const job of readyJobs) {
            const config = SchedulerDB.getConfigById(job.scheduler_id);
            if (config && config.is_enabled === 1) {
              // Jalankan secara asinkron agar tidak memblokir interval loop
              AbsensiWorker.execute(config, true);
            } else {
              // Jika scheduler sudah dimatikan/dihapus, buang dari antrean gagal
              SchedulerDB.deleteFailedJobByScheduler(job.scheduler_id);
            }
          }
        }
      } catch (err) {
        logger.error('[Scheduler Manager] Error pada Failed Queue Processor:', err);
      }
    }, 5 * 60 * 1000); // 5 Menit
  }

  /**
   * Mendapatkan status kesehatan scheduler manager secara realtime
   */
  getHealthStatus() {
    return {
      status: this.status,
      uptime: Math.floor((Date.now() - this.startTime) / 1000), // detik
      activeTasksCount: this.activeTasks.size,
      activeTaskIds: Array.from(this.activeTasks.keys()),
      memoryUsage: process.memoryUsage()
    };
  }
}

// Singleton pattern
module.exports = new SchedulerManager();
