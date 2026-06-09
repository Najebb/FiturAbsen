// services/metrics-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Mesin kalkulasi metrik, analisis kegagalan, dan Early Warning System (EWS)
// ─────────────────────────────────────────────────────────────────────────────

const MetricsEngine = {
  /**
   * Menghitung ringkasan statistik (Overview Metrics) & memicu Early Warning System (EWS)
   */
  calculateOverview: (absenLogs, schedulerHistory, accounts) => {
    const totalLogs = absenLogs.length;
    const successLogs = absenLogs.filter(l => l.status === 'berhasil').length;
    const skippedLogs = absenLogs.filter(l => l.status === 'SKIPPED' || l.status === 'skipped').length;
    
    // Kegagalan adalah log status 'gagal' atau 'error'
    const failedLogs = absenLogs.filter(l => l.status === 'gagal' || l.status === 'error').length;
    
    // Tingkat keberhasilan dan kegagalan
    const totalNonSkipped = successLogs + failedLogs;
    const successRate = totalNonSkipped > 0 ? Math.round((successLogs / totalNonSkipped) * 100) : 100;
    const failureRate = totalNonSkipped > 0 ? Math.round((failedLogs / totalNonSkipped) * 100) : 0;

    // Retry counts dari history
    const retryCount = schedulerHistory.filter(h => h.status === 'retry').length;

    // Hitung EWS Alerts
    const alerts = MetricsEngine.evaluateEarlyWarningSystem(absenLogs, schedulerHistory, accounts);

    return {
      totalExecutions: totalLogs,
      successCount: successLogs,
      failedCount: failedLogs,
      skippedCount: skippedLogs,
      retryCount: retryCount,
      successRate,
      failureRate,
      alerts
    };
  },

  /**
   * Menganalisis tren performa absensi berdasarkan hari (7 Hari, 30 Hari, Semester)
   */
  calculateTrends: (absenLogs, days = 7) => {
    const trendsMap = new Map();
    const now = new Date();
    
    // Inisialisasi peta tanggal untuk memastikan data urut dan tidak ada yang kosong
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      trendsMap.set(dateStr, { success: 0, failed: 0, skipped: 0 });
    }

    absenLogs.forEach(log => {
      // Ambil YYYY-MM-DD dari timestamp absen_at
      const absenAt = log.absen_at || '';
      const dateStr = absenAt.split(' ')[0] || absenAt.split('T')[0];
      if (trendsMap.has(dateStr)) {
        const val = trendsMap.get(dateStr);
        if (log.status === 'berhasil') {
          val.success++;
        } else if (log.status === 'SKIPPED' || log.status === 'skipped') {
          val.skipped++;
        } else if (log.status === 'gagal' || log.status === 'error') {
          val.failed++;
        }
      }
    });

    const labels = [];
    const successData = [];
    const failedData = [];
    const skippedData = [];

    // Ubah peta tren menjadi array urut
    for (const [date, val] of trendsMap.entries()) {
      // Format tanggal ke DD/MM untuk chart label
      const parts = date.split('-');
      const formattedLabel = `${parts[2]}/${parts[1]}`;
      labels.push(formattedLabel);
      successData.push(val.success);
      failedData.push(val.failed);
      skippedData.push(val.skipped);
    }

    return { labels, successData, failedData, skippedData };
  },

  /**
   * Menganalisis data kegagalan sistem absensi (Failure Analysis)
   */
  calculateFailures: (absenLogs, schedulerHistory, accounts) => {
    // 1. Top failed accounts
    const accountFailureMap = new Map();
    const failedLogs = absenLogs.filter(l => l.status === 'gagal' || l.status === 'error');

    failedLogs.forEach(log => {
      const accId = log.account_id;
      const count = accountFailureMap.get(accId) || 0;
      accountFailureMap.set(accId, count + 1);
    });

    const topFailedAccounts = [];
    accountFailureMap.forEach((failCount, accId) => {
      const acc = accounts.find(a => a.id === accId);
      if (acc) {
        // Ambil kegagalan terakhir
        const lastFail = failedLogs.filter(l => l.account_id === accId)
          .sort((a, b) => b.absen_at.localeCompare(a.absen_at))[0];

        topFailedAccounts.push({
          id: accId,
          nama: acc.nama,
          npm: acc.npm,
          failureCount: failCount,
          lastFailureAt: lastFail ? lastFail.absen_at : '',
          lastFailureReason: lastFail ? lastFail.pesan : ''
        });
      }
    });
    topFailedAccounts.sort((a, b) => b.failureCount - a.failureCount);

    // 2. Failure reasons frequency
    const reasonMap = new Map();
    failedLogs.forEach(log => {
      let reason = 'Kesalahan Umum/Sistem';
      const msg = log.pesan ? log.pesan.toLowerCase() : '';

      if (msg.includes('captcha') || msg.includes('ocr')) {
        reason = 'Kegagalan Captcha OCR';
      } else if (msg.includes('credentials') || msg.includes('login') || msg.includes('password salah')) {
        reason = 'Kredensial Login Salah';
      } else if (msg.includes('timeout') || msg.includes('waiting')) {
        reason = 'Timeout / Koneksi Lambat';
      } else if (msg.includes('tidak ada jadwal') || msg.includes('kuliah selesai')) {
        reason = 'Jadwal Kuliah Selesai';
      } else if (msg.includes('navigation') || msg.includes('selector')) {
        reason = 'Struktur SIMKULIAH Berubah';
      }
      
      const count = reasonMap.get(reason) || 0;
      reasonMap.set(reason, count + 1);
    });

    const failureReasons = [];
    reasonMap.forEach((count, reason) => {
      failureReasons.push({ reason, count });
    });
    failureReasons.sort((a, b) => b.count - a.count);

    // 3. Retry distribution
    let retrySuccess = 0;
    let retryFailed = 0;
    
    // Mencari korelasi di scheduler history
    schedulerHistory.forEach((item, idx) => {
      if (item.status === 'retry') {
        // Cari status berikutnya dari scheduler yang sama
        const nextItem = schedulerHistory
          .slice(idx + 1)
          .find(h => h.scheduler_id === item.scheduler_id && h.account_id === item.account_id);
        
        if (nextItem) {
          if (nextItem.status === 'berhasil') {
            retrySuccess++;
          } else if (nextItem.status === 'failed') {
            retryFailed++;
          }
        }
      }
    });

    return {
      topFailedAccounts: topFailedAccounts.slice(0, 5), // Ambil 5 teratas
      failureReasons,
      retryStats: {
        totalRetries: schedulerHistory.filter(h => h.status === 'retry').length,
        successCount: retrySuccess,
        failedCount: retryFailed
      }
    };
  },

  /**
   * Evaluasi Peringatan Dini (Early Warning System)
   */
  evaluateEarlyWarningSystem: (absenLogs, schedulerHistory, accounts) => {
    const alerts = [];
    const now = new Date();

    // 1. Akun yang gagal berturut-turut (Consecutive Failures >= 3)
    accounts.forEach(acc => {
      const accLogs = absenLogs
        .filter(l => l.account_id === acc.id && l.status !== 'SKIPPED' && l.status !== 'skipped')
        .sort((a, b) => b.absen_at.localeCompare(a.absen_at)); // terbaru dulu

      if (accLogs.length >= 3) {
        const consecutiveFails = [];
        for (let i = 0; i < 3; i++) {
          if (accLogs[i].status === 'gagal' || accLogs[i].status === 'error') {
            consecutiveFails.push(accLogs[i]);
          } else {
            break;
          }
        }

        if (consecutiveFails.length === 3) {
          alerts.push({
            type: 'danger',
            title: `Kegagalan Beruntun Akun ${acc.nama}`,
            message: `Akun ${acc.nama} (${acc.npm}) mengalami kegagalan absensi 3 kali berturut-turut. Alasan terakhir: "${consecutiveFails[0].pesan}"`
          });
        }
      }
    });

    // 2. Akun aktif dengan Success Rate sangat rendah (< 70% dari minimal 5 eksekusi)
    accounts.filter(a => a.is_active !== 0).forEach(acc => {
      const accLogs = absenLogs.filter(l => l.account_id === acc.id && l.status !== 'SKIPPED' && l.status !== 'skipped');
      if (accLogs.length >= 5) {
        const successCount = accLogs.filter(l => l.status === 'berhasil').length;
        const rate = Math.round((successCount / accLogs.length) * 100);
        if (rate < 70) {
          alerts.push({
            type: 'warning',
            title: `Success Rate Rendah: Akun ${acc.nama}`,
            message: `Tingkat keberhasilan absensi untuk ${acc.nama} (${acc.npm}) hanya ${rate}%. Harap periksa kredensial atau kestabilan akun.`
          });
        }
      }
    });

    // 3. Success rate sistem dalam 24 jam terakhir sangat rendah (< 85%)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const recentLogs = absenLogs.filter(l => l.absen_at >= oneDayAgo && l.status !== 'SKIPPED' && l.status !== 'skipped');
    
    if (recentLogs.length >= 4) {
      const recentSuccess = recentLogs.filter(l => l.status === 'berhasil').length;
      const recentRate = Math.round((recentSuccess / recentLogs.length) * 100);
      if (recentRate < 85) {
        alerts.push({
          type: 'danger',
          title: `Tingkat Kestabilan Sistem Menurun`,
          message: `Success rate sistem 24 jam terakhir sangat rendah (${recentRate}% dari ${recentLogs.length} eksekusi). Kemungkinan terdapat kendala koneksi SIMKULIAH atau Captcha API.`
        });
      }
    }

    return alerts;
  }
};

module.exports = MetricsEngine;
