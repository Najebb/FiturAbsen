const logger = require('../utils/logger');

const MonitoringService = {
  /**
   * Mengumpulkan metrik sistem, RAM, dan statistik penjadwalan
   */
  getStats: async () => {
    try {
      const proxy = require('../routes/absen-proxy');
      const scheduler = require('../scheduler/manager');

      // 1. Get system memory
      const mem = process.memoryUsage();
      const memoryUsageMB = {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024)
      };

      // 2. Count registered & active jobs
      const activeJobsCount = proxy.runningJobs ? proxy.runningJobs.size : 0;
      const schedulerHealth = scheduler.getHealthStatus ? scheduler.getHealthStatus() : {};

      // 3. Query DB metrics (Success/Failed job counts)
      let totalSuccess = 0;
      let totalFailed = 0;
      let totalRetries = 0;

      if (proxy.db) {
        try {
          const successRow = proxy.db.prepare("SELECT COUNT(*) as count FROM scheduler_history WHERE status = 'SUCCESS'").get();
          const failedRow = proxy.db.prepare("SELECT COUNT(*) as count FROM scheduler_history WHERE status = 'FAILED'").get();
          const retryRow = proxy.db.prepare("SELECT COUNT(*) as count FROM scheduler_history WHERE status LIKE 'RETRY%'").get();
          
          totalSuccess = successRow ? successRow.count : 0;
          totalFailed = failedRow ? failedRow.count : 0;
          totalRetries = retryRow ? retryRow.count : 0;
        } catch (e) {
          logger.warn('[Monitoring Service] Gagal mengambil metrik riwayat dari database:', e.message);
        }
      }

      return {
        uptimeSeconds: process.uptime(),
        memoryUsageMB,
        jobs: {
          activeCount: activeJobsCount,
          registeredCount: schedulerHealth.activeTasksCount || 0
        },
        metrics: {
          totalSuccess,
          totalFailed,
          totalRetries
        },
        schedulerStatus: schedulerHealth.status || 'stopped'
      };
    } catch (e) {
      logger.error('[Monitoring Service] Gagal mengumpulkan metrik:', e);
      return {
        error: e.message
      };
    }
  }
};

module.exports = MonitoringService;
