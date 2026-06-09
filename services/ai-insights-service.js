// services/ai-insights-service.js
// ─────────────────────────────────────────────────────────────────────────────
// Service untuk mengelola kueri metrik, caching 15-menit, dan ekspor laporan AI
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../utils/logger');
const CalendarService = require('./calendar');
const MonitoringService = require('./monitoring');
const RecommendationEngine = require('./recommendation-engine');
const InsightGenerator = require('./insight-generator');

let dbInstance = null;
function getDB() {
  if (!dbInstance) {
    try {
      const proxy = require('../routes/absen-proxy');
      dbInstance = proxy.db;
    } catch (e) {
      // Safe catch jika diimport saat boot awal
    }
  }
  return dbInstance;
}

// In-memory cache
let insightsCache = {
  insights: [],
  riskAssessment: {
    score: 0,
    level: 'MEMULAI SISTEM',
    statusClass: 'text-muted',
    description: 'Sistem sedang menganalisis performa awal...',
    counts: { critical: 0, high: 0, medium: 0, low: 0 }
  },
  executiveSummary: 'Menganalisis sistem absensi...',
  lastUpdated: null
};

/**
 * Fungsi pembantu untuk mengambil data secara aman dari SQLite
 */
function safeQuery(sql, params = [], all = true) {
  const db = getDB();
  if (!db) return all ? [] : null;
  try {
    const stmt = db.prepare(sql);
    return all ? stmt.all(...params) : stmt.get(...params);
  } catch (e) {
    logger.warn(`[AI Insights Service] Gagal mengeksekusi kueri: ${sql}. Error:`, e.message);
    return all ? [] : null;
  }
}

const AIInsightsService = {
  /**
   * Mengambil data mentah dari DB & Services, lalu menyusun cache baru
   */
  updateCache: async () => {
    logger.info('[AI Insights Service] Memulai kalkulasi analisis otomatis...');
    try {
      const db = getDB();
      if (!db) {
        logger.warn('[AI Insights Service] Database belum siap. Menunda kalkulasi.');
        return false;
      }

      // 1. Ambil data mentah secara aman
      const absenLogs = safeQuery("SELECT * FROM absen_log ORDER BY absen_at DESC");
      const schedulerConfigs = safeQuery("SELECT * FROM scheduler_configs");
      const schedulerHistory = safeQuery("SELECT * FROM scheduler_history ORDER BY executed_at DESC");
      const schedulerFailedJobs = safeQuery("SELECT * FROM scheduler_failed_jobs");
      const accounts = safeQuery("SELECT * FROM accounts");

      // 2. Ambil Health stats
      const monitoringStats = await MonitoringService.getStats();

      // 3. Evaluasi metrik & rekomendasi via engine
      const { insights, riskAssessment } = RecommendationEngine.generateInsights(
        absenLogs,
        schedulerConfigs,
        schedulerHistory,
        schedulerFailedJobs,
        accounts,
        monitoringStats
      );

      // 4. Buat Executive Summary
      const executiveSummary = InsightGenerator.generateExecutiveSummary(insights, riskAssessment);

      // 5. Simpan ke Cache
      insightsCache = {
        insights,
        riskAssessment,
        executiveSummary,
        lastUpdated: new Date().toISOString()
      };

      logger.info('[AI Insights Service] Cache berhasil diperbarui.');
      return true;
    } catch (err) {
      logger.error('[AI Insights Service] Error saat memproses cache:', err);
      return false;
    }
  },

  /**
   * Mengembalikan data ringkasan analitik utama (Overview)
   */
  getOverview: () => {
    // Jika cache belum pernah diupdate, lakukan secara sinkron/instan sekali
    if (!insightsCache.lastUpdated) {
      AIInsightsService.updateCacheSync();
    }
    return {
      success: true,
      data: {
        riskAssessment: insightsCache.riskAssessment,
        executiveSummary: insightsCache.executiveSummary,
        lastUpdated: insightsCache.lastUpdated,
        topIssues: insightsCache.insights.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')
      }
    };
  },

  /**
   * Mengambil rekomendasi berdasarkan kategori tertentu
   */
  getInsightsByCategory: (category) => {
    if (!insightsCache.lastUpdated) {
      AIInsightsService.updateCacheSync();
    }
    const filtered = insightsCache.insights.filter(i => i.category === category);
    return {
      success: true,
      data: {
        category,
        insights: filtered,
        lastUpdated: insightsCache.lastUpdated
      }
    };
  },

  /**
   * Ekspor dokumen Laporan (Daily, Weekly, Monthly) dalam format Markdown
   */
  exportReport: (period) => {
    if (!insightsCache.lastUpdated) {
      AIInsightsService.updateCacheSync();
    }
    
    const validPeriods = ['daily', 'weekly', 'monthly'];
    const selectedPeriod = validPeriods.includes(period.toLowerCase()) ? period.toLowerCase() : 'daily';

    const markdownContent = InsightGenerator.generateReport(
      selectedPeriod,
      insightsCache.insights,
      insightsCache.riskAssessment
    );

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `AI_Insights_Report_${selectedPeriod.toUpperCase()}_${dateStr}.md`;

    return {
      success: true,
      filename,
      contentType: 'text/markdown; charset=utf-8',
      content: markdownContent
    };
  },

  /**
   * Update cache secara sinkronous (untuk inisialisasi awal yang cepat)
   */
  updateCacheSync: () => {
    const db = getDB();
    if (!db) return;
    try {
      const absenLogs = safeQuery("SELECT * FROM absen_log ORDER BY absen_at DESC");
      const schedulerConfigs = safeQuery("SELECT * FROM scheduler_configs");
      const schedulerHistory = safeQuery("SELECT * FROM scheduler_history ORDER BY executed_at DESC");
      const schedulerFailedJobs = safeQuery("SELECT * FROM scheduler_failed_jobs");
      const accounts = safeQuery("SELECT * FROM accounts");
      const mem = process.memoryUsage();
      const monitoringStats = {
        memoryUsageMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024)
        }
      };

      const { insights, riskAssessment } = RecommendationEngine.generateInsights(
        absenLogs,
        schedulerConfigs,
        schedulerHistory,
        schedulerFailedJobs,
        accounts,
        monitoringStats
      );

      const executiveSummary = InsightGenerator.generateExecutiveSummary(insights, riskAssessment);

      insightsCache = {
        insights,
        riskAssessment,
        executiveSummary,
        lastUpdated: new Date().toISOString()
      };
    } catch (e) {
      logger.error('[AI Insights Service] Gagal inisialisasi sinkron cache:', e);
    }
  },

  /**
   * Inisialisasi thread interval
   */
  init: () => {
    // Jalankan sekali saat server booting setelah delay kecil
    setTimeout(() => {
      AIInsightsService.updateCache();
    }, 5000);

    // Setup interval 15 menit
    setInterval(() => {
      AIInsightsService.updateCache();
    }, 15 * 60 * 1000);
  }
};

// Mulai inisialisasi otomatis
AIInsightsService.init();

module.exports = AIInsightsService;
