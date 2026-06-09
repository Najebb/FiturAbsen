// services/recommendation-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Recommendation Engine untuk melakukan analisis otomatis & perumusan rekomendasi
// ─────────────────────────────────────────────────────────────────────────────

const CalendarService = require('./calendar');
const RuleEngine = require('./rule-engine');
const v8 = require('v8');

const RecommendationEngine = {
  /**
   * Menganalisis seluruh sumber data dan menyusun daftar rekomendasi & insights.
   */
  generateInsights: (absenLogs, schedulerConfigs, schedulerHistory, schedulerFailedJobs, accounts, monitoringStats) => {
    const insights = [];

    // 1. KATEGORI A: Analisis Akun (Account Analysis)
    RecommendationEngine.analyzeAccounts(insights, absenLogs, schedulerHistory, schedulerFailedJobs, accounts);

    // 2. KATEGORI B: Analisis Scheduler (Scheduler Analysis)
    RecommendationEngine.analyzeSchedulers(insights, schedulerConfigs, schedulerHistory, schedulerFailedJobs, accounts);

    // 3. KATEGORI C: Analisis Kesehatan Sistem (System Health Analysis)
    RecommendationEngine.analyzeSystemHealth(insights, absenLogs, monitoringStats);

    // 4. KATEGORI D: Analisis Kalender Akademik (Academic Calendar Analysis)
    RecommendationEngine.analyzeAcademicCalendar(insights, schedulerConfigs, accounts);

    // Hitung tingkat resiko keseluruhan
    const riskAssessment = RecommendationEngine.calculateRisk(insights);

    return {
      insights,
      riskAssessment
    };
  },

  /**
   * Kategori A: Analisis Performa & Kestabilan Akun Mahasiswa
   */
  analyzeAccounts: (insights, absenLogs, schedulerHistory, schedulerFailedJobs, accounts) => {
    accounts.forEach(acc => {
      const accLogs = absenLogs.filter(l => l.account_id === acc.id && l.status !== 'SKIPPED' && l.status !== 'skipped');
      const totalLogs = accLogs.length;

      if (totalLogs >= 3) {
        const successCount = accLogs.filter(l => l.status === 'berhasil').length;
        const failedCount = accLogs.filter(l => l.status === 'gagal' || l.status === 'error').length;
        const successRate = Math.round((successCount / totalLogs) * 100);

        // Kasus 1: Success Rate Sangat Rendah (< 60%)
        if (successRate < 60) {
          const lastFail = accLogs.find(l => l.status === 'gagal' || l.status === 'error');
          insights.push({
            category: 'accounts',
            id: `acc-sr-crit-${acc.id}`,
            severity: 'CRITICAL',
            title: `Kestabilan Kritis Akun: ${acc.nama}`,
            message: `Akun ${acc.nama} (${acc.npm}) memiliki tingkat keberhasilan absensi sangat rendah (${successRate}%).`,
            reason: `Ditemukan ${failedCount} kegagalan dari ${totalLogs} eksekusi terakhir.`,
            data: { successRate, failedCount, totalCount: totalLogs, lastError: lastFail ? lastFail.pesan : '' },
            recommendation: 'Verifikasi kredensial login SIMKULIAH akun tersebut, periksa apakah akun ditangguhkan, atau bersihkan sesi browser yang menggantung.'
          });
        }
        // Kasus 2: Success Rate Rendah (60% - 80%)
        else if (successRate < 80) {
          insights.push({
            category: 'accounts',
            id: `acc-sr-high-${acc.id}`,
            severity: 'HIGH',
            title: `Success Rate Rendah: ${acc.nama}`,
            message: `Akun ${acc.nama} (${acc.npm}) menunjukkan kinerja absensi di bawah batas optimal (${successRate}%).`,
            reason: `Terdapat ${failedCount} kali kegagalan absensi.`,
            data: { successRate, failedCount, totalCount: totalLogs },
            recommendation: 'Evaluasi konfigurasi CAPTCHA OCR atau jadwalkan ulang ke jam yang lebih lengang untuk menghindari timeout server.'
          });
        }
        // Kasus 3: Akun Sangat Stabil (Success Rate >= 95%) - LOW/INFO
        else if (successRate >= 95 && totalLogs >= 5) {
          insights.push({
            category: 'accounts',
            id: `acc-stable-low-${acc.id}`,
            severity: 'LOW',
            title: `Performa Akun Stabil: ${acc.nama}`,
            message: `Akun ${acc.nama} (${acc.npm}) berjalan dengan sangat lancar (${successRate}% sukses).`,
            reason: `${successCount} eksekusi berhasil dari total ${totalLogs} kali jalan.`,
            data: { successRate, totalLogs },
            recommendation: 'Pertahankan konfigurasi saat ini. Tidak ada tindakan yang diperlukan.'
          });
        }
      }

      // Kasus 4: Akun Nonaktif tetapi memiliki Scheduler Config yang Aktif
      const hasActiveScheduler = schedulerHistory.some(h => h.account_id === acc.id) || 
        (acc.is_active === 0 && absenLogs.some(l => l.account_id === acc.id)); 
      
      if (acc.is_active === 0) {
        insights.push({
          category: 'accounts',
          id: `acc-inactive-med-${acc.id}`,
          severity: 'MEDIUM',
          title: `Akun Nonaktif Berjadwal: ${acc.nama}`,
          message: `Akun ${acc.nama} (${acc.npm}) berstatus nonaktif tetapi masih memiliki riwayat penugasan penjadwalan.`,
          reason: 'Akun dinonaktifkan sementara oleh admin tetapi konfigurasinya masih terdaftar.',
          data: { is_active: acc.is_active },
          recommendation: 'Jika mahasiswa sudah tidak aktif, hapus konfigurasi penjadwalan atau hapus akun ini secara permanen untuk meminimalkan beban kompilasi rule.'
        });
      }

      // Kasus 5: Tingkat Retry Tinggi
      const accRetries = schedulerFailedJobs.filter(j => j.account_id === acc.id);
      const totalRetries = accRetries.reduce((sum, job) => sum + (job.retry_count || 0), 0);
      if (totalRetries >= 3) {
        insights.push({
          category: 'accounts',
          id: `acc-retry-med-${acc.id}`,
          severity: 'MEDIUM',
          title: `Percobaan Ulang (Retry) Tinggi: ${acc.nama}`,
          message: `Akun ${acc.nama} (${acc.npm}) mengalami banyak percobaan ulang absensi otomatis.`,
          reason: `Terjadi total ${totalRetries} kali antrean retry karena kegagalan awal.`,
          data: { totalRetries },
          recommendation: 'Periksa koneksi jaringan server atau tingkatkan timeout browser Playwright di konfigurasi sistem.'
        });
      }
    });
  },

  /**
   * Kategori B: Analisis Efisiensi & Kepadatan Scheduler
   */
  analyzeSchedulers: (insights, schedulerConfigs, schedulerHistory, schedulerFailedJobs, accounts) => {
    // Kasus 1: Bentrokan / Penumpukan Concurrency Jadwal (Sama jam & menit)
    const timeGroups = new Map();
    schedulerConfigs.forEach(config => {
      if (config.is_enabled === 1) {
        const parts = config.cron_pattern.split(' '); // "minute hour * * day"
        if (parts.length >= 5) {
          const key = `${parts[0]}_${parts[1]}_${parts[4]}`; // min_hour_dayOfWeek
          const list = timeGroups.get(key) || [];
          list.push(config);
          timeGroups.set(key, list);
        }
      }
    });

    const daysName = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    timeGroups.forEach((list, key) => {
      if (list.length > 1) {
        const [min, hour, day] = key.split('_');
        const dayStr = daysName[Number(day)] || `Hari-${day}`;
        const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
        
        const severity = list.length >= 3 ? 'HIGH' : 'MEDIUM';
        const accountNames = list.map(c => {
          const a = accounts.find(acc => acc.id === c.account_id);
          return a ? a.nama : 'Unknown';
        }).join(', ');

        insights.push({
          category: 'scheduler',
          id: `sched-concurrency-${key}`,
          severity: severity,
          title: `Penumpukan Jadwal Concurrency (${dayStr} ${timeStr})`,
          message: `Ditemukan ${list.length} tugas absensi berjalan pada waktu yang bersamaan.`,
          reason: `Akun terdampak: ${accountNames}. Bentrok memicu peluncuran beberapa instansi browser sekaligus.`,
          data: { time: timeStr, day: dayStr, count: list.length },
          recommendation: 'Atur ulang jam/menit scheduler agar memiliki selisih waktu 5 hingga 10 menit guna mengurangi beban CPU & RAM server.'
        });
      }
    });

    // Kasus 2: Scheduler sering gagal eksekusi (History Status)
    const schedulerFailMap = new Map();
    schedulerHistory.forEach(h => {
      const sId = h.scheduler_id;
      if (!sId) return;
      const record = schedulerFailMap.get(sId) || { total: 0, failed: 0 };
      record.total++;
      if (h.status === 'failed' || h.status === 'error') record.failed++;
      schedulerFailMap.set(sId, record);
    });

    schedulerFailMap.forEach((val, sId) => {
      const failRate = Math.round((val.failed / val.total) * 100);
      if (val.total >= 4 && failRate >= 50) {
        const config = schedulerConfigs.find(c => c.id === sId);
        const acc = config ? accounts.find(a => a.id === config.account_id) : null;
        
        insights.push({
          category: 'scheduler',
          id: `sched-fail-high-${sId}`,
          severity: 'HIGH',
          title: `Scheduler Tidak Efisien: ID ${sId}`,
          message: `Konfigurasi scheduler untuk mahasiswa ${acc ? acc.nama : 'ID ' + sId} memiliki tingkat kegagalan ${failRate}%.`,
          reason: `Mengalami ${val.failed} kegagalan dari total ${val.total} kali percobaan jadwal berjalan.`,
          data: { schedulerId: sId, failRate, total: val.total },
          recommendation: 'Nonaktifkan sementara scheduler ini, lalu periksa integrasi API OCR Captcha dan pastikan situs SIMKULIAH tidak sedang maintenance pada jam tersebut.'
        });
      }
    });
  },

  /**
   * Kategori C: Analisis Trend & Kesehatan Sistem (Memori, DB, Uptime)
   */
  analyzeSystemHealth: (insights, absenLogs, stats) => {
    if (!stats || stats.error) return;

    // Kasus 1: Memory leaks (heapUsed / heapLimitMB > 80%)
    const mem = stats.memoryUsageMB;
    if (mem) {
      const heapStatistics = v8.getHeapStatistics();
      const heapLimitMB = Math.round(heapStatistics.heap_size_limit / 1024 / 1024);
      const limitRatio = mem.heapUsed / heapLimitMB;
      
      if (limitRatio > 0.80 && mem.heapUsed > 256) {
        insights.push({
          category: 'system',
          id: 'sys-mem-critical',
          severity: 'CRITICAL',
          title: 'Penggunaan Memori Heap Kritis',
          message: `Layanan Node.js menggunakan ${mem.heapUsed}MB dari ${heapLimitMB}MB batas maksimal heap (${Math.round(limitRatio * 100)}%).`,
          reason: 'Beban kerja browser atau scheduler yang terus berjalan berpotensi menyisakan memori yang belum dibersihkan.',
          data: { heapUsed: mem.heapUsed, heapTotal: heapLimitMB },
          recommendation: 'Lakukan restart process dashboard menggunakan PM2 (`pm2 reload index`), kurangi jumlah concurrency browser, atau periksa kebocoran resource di browser manager.'
        });
      } else if (mem.rss > 600) {
        insights.push({
          category: 'system',
          id: 'sys-rss-high',
          severity: 'HIGH',
          title: 'Konsumsi RAM Sistem Tinggi (RSS)',
          message: `Total memori fisik (RSS) yang dikonsumsi aplikasi mencapai ${mem.rss}MB.`,
          reason: 'Playwright Browser chromium headless yang diluncurkan tidak sepenuhnya ditutup setelah eksekusi.',
          data: { rss: mem.rss },
          recommendation: 'Pastikan method browser.close() selalu dieksekusi di blok try-finally penanganan absensi otomatis.'
        });
      }
    }

    // Kasus 2: Database Size & Log Count (Optimasi DB)
    const logCount = absenLogs.length;
    if (logCount > 2000) {
      insights.push({
        category: 'system',
        id: 'sys-db-logsize',
        severity: 'LOW',
        title: 'Penumpukan Riwayat Log Absensi',
        message: `Tabel log absensi memiliki ${logCount} baris riwayat.`,
        reason: 'Riwayat data menumpuk seiring berjalannya waktu eksekusi harian.',
        data: { logCount },
        recommendation: 'Lakukan ekspor data cadangan (backup) lalu bersihkan log lama di dashboard menu System Tools untuk mengoptimalkan kecepatan kueri SQLite.'
      });
    }
  },

  /**
   * Kategori D: Analisis Kalender Akademik (Overlap Libur / Libur Semester)
   */
  analyzeAcademicCalendar: (insights, schedulerConfigs, accounts) => {
    // Dapatkan preview jadwal 7 hari ke depan untuk semua akun aktif
    const activeConfigs = schedulerConfigs.filter(c => c.is_enabled === 1);
    const checkedAccounts = new Set(activeConfigs.map(c => c.account_id));

    checkedAccounts.forEach(accountId => {
      const previewList = RuleEngine.getPreview(accountId);
      const acc = accounts.find(a => a.id === accountId);
      if (!acc) return;

      // Ambil jadwal yang diprediksi akan ter-skip oleh Smart Rules
      const skippedPreviews = previewList.filter(p => p.skipped);
      
      if (skippedPreviews.length > 0) {
        // Group by alasan skip
        const reasons = [...new Set(skippedPreviews.map(p => p.reason))];
        insights.push({
          category: 'calendar',
          id: `cal-skip-low-${accountId}`,
          severity: 'LOW',
          title: `Penundaan Absensi Otomatis: ${acc.nama}`,
          message: `Jadwal absensi ${acc.nama} (${acc.npm}) akan dilewati dalam 7 hari ke depan karena aturan kalender akademik.`,
          reason: `Alasan penundaan: ${reasons.join(', ')}.`,
          data: { accountId, totalSkippedSlots: skippedPreviews.length, reasons },
          recommendation: 'Informasi saja. Sistem secara cerdas menghemat resource server dengan menghentikan eksekusi browser di hari non-kuliah/libur.'
        });
      }
    });
  },

  /**
   * Menghitung nilai tingkat resiko sistem (Executive Risk Assessment)
   */
  calculateRisk: (insights) => {
    const criticalCount = insights.filter(i => i.severity === 'CRITICAL').length;
    const highCount = insights.filter(i => i.severity === 'HIGH').length;
    const mediumCount = insights.filter(i => i.severity === 'MEDIUM').length;

    let score = 0; // 0 - 100 (Semakin tinggi semakin berbahaya)
    score += criticalCount * 30;
    score += highCount * 15;
    score += mediumCount * 5;
    
    if (score > 100) score = 100;

    let level = 'SEHAT / STABIL';
    let statusClass = 'text-green';
    let description = 'Sistem berjalan normal dan aman tanpa anomali kritis.';

    if (score >= 60 || criticalCount > 0) {
      level = 'KRITIS (CRITICAL)';
      statusClass = 'text-red font-bold';
      description = 'Ditemukan masalah kritis (masalah akun/memori) yang membutuhkan tindakan admin segera.';
    } else if (score >= 25 || highCount > 0) {
      level = 'SANGAT RENTAN (HIGH RISK)';
      statusClass = 'text-orange font-bold';
      description = 'Beberapa scheduler tidak efisien atau success rate akun menurun. Sistem perlu ditinjau.';
    } else if (score > 0) {
      level = 'PERINGATAN RINGAN (WARNING)';
      statusClass = 'text-yellow';
      description = 'Ditemukan anomali minor atau bentrokan jadwal kecil. Tidak berdampak besar.';
    }

    return {
      score,
      level,
      statusClass,
      description,
      counts: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: insights.filter(i => i.severity === 'LOW').length
      }
    };
  }
};

module.exports = RecommendationEngine;
