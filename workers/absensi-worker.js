// workers/absensi-worker.js
// ─────────────────────────────────────────────────────────────────────────────
// Worker eksekusi absensi otomatis SIMKULIAH dengan mekanisme retry & logs
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../utils/logger');
const SchedulerDB = require('../services/scheduler-db');

// Lazy-require router helper & config
let proxyInstance = null;
function getProxy() {
  if (!proxyInstance) {
    proxyInstance = require('../routes/absen-proxy');
  }
  return proxyInstance;
}

let notificationInstance = null;
function getNotificationService() {
  if (!notificationInstance) {
    notificationInstance = require('../services/notification');
  }
  return notificationInstance;
}

const AbsensiWorker = {
  // Melacak status eksekusi akun aktif untuk mencegah eksekusi ganda
  executingAccounts: new Set(),

  /**
   * Mengeksekusi proses absensi untuk satu konfigurasi scheduler secara asinkron
   * @param {Object} config - Konfigurasi scheduler dari database
   * @param {boolean} isRetry - Apakah pemanggilan ini merupakan retry dari kegagalan sebelumnya
   */
  execute: async (config, isRetry = false) => {
    const { id: schedulerId, account_id: accountId } = config;
    
    // 1. Anti-Duplicate Lock Check
    if (AbsensiWorker.executingAccounts.has(accountId)) {
      logger.warn(`[Scheduler Worker] Akun ID ${accountId} sedang diproses. Membatalkan eksekusi duplikat.`);
      return;
    }
    
    // Ambil references dari proxy router
    const proxy = getProxy();
    if (proxy.runningJobs && proxy.runningJobs.has(accountId)) {
      logger.warn(`[Scheduler Worker] Akun ID ${accountId} sedang melakukan absensi manual. Membatalkan eksekusi duplikat.`);
      return;
    }

    // Lock account
    AbsensiWorker.executingAccounts.add(accountId);
    if (proxy.runningJobs) proxy.runningJobs.add(accountId);

    logger.info(`[Scheduler Worker] Memulai tugas absensi otomatis untuk Scheduler ID ${schedulerId}, Akun ID ${accountId}`);

    try {
      // 2. Ambil Akun & Password
      const account = proxy.Accounts.getById(accountId);
      if (!account) {
        throw new Error('Akun mahasiswa tidak ditemukan dalam database.');
      }
      
      const decryptedPassword = proxy.Accounts.getPassword(accountId);
      if (!decryptedPassword) {
        throw new Error('Password tidak dapat didekripsi atau kosong.');
      }

      // 3. Jalankan Absensi (Playwright Simulator)
      const result = await proxy.runAbsen({
        npm: account.npm,
        password: decryptedPassword
      });

      // 4. Proses Hasil
      if (result.success) {
        logger.info(`[Scheduler Worker] Sukses menjalankan absensi otomatis untuk Scheduler ID ${schedulerId} (${account.nama})`);
        
        // Hapus record kegagalan jika sebelumnya ada di antrean failed_jobs
        SchedulerDB.deleteFailedJobByScheduler(schedulerId);

        // Catat ke log history scheduler
        SchedulerDB.insertHistory({
          scheduler_id: schedulerId,
          account_id: accountId,
          status: 'SUCCESS',
          message: result.message || 'Absensi berhasil diselesaikan.'
        });

        // Masukkan detail ke tabel absen_log utama untuk sinkronisasi statistik dashboard
        const items = result.absen_list && result.absen_list.length 
          ? result.absen_list 
          : [{ kelas: 'SEMUA KELAS', status: 'berhasil', pesan: result.message || 'Selesai otomatis' }];
        
        proxy.AbsenLog.insert(accountId, items);

        // Kirim Notifikasi Sukses Ke Discord/Telegram/WhatsApp
        getNotificationService().sendSuccess({
          nama: account.nama,
          npm: account.npm,
          kelas: result.absen_list ? result.absen_list.map(x => x.kelas).join(', ') : 'SEMUA KELAS',
          pesan: result.message
        }).catch(err => logger.warn('[Scheduler Worker] Gagal mengirim notifikasi sukses:', err.message));

      } else {
        // Gagal login / validasi captcha gagal
        throw new Error(result.message || 'Koneksi simulator gagal.');
      }

    } catch (err) {
      const errMsg = err.message || String(err);
      logger.error(`[Scheduler Worker] Gagal pada Scheduler ID ${schedulerId}: ${errMsg}`);

      // 5. Retry Mechanism
      await AbsensiWorker.handleFailure(config, errMsg);
    } finally {
      // Unlock account
      AbsensiWorker.executingAccounts.delete(accountId);
      if (proxy.runningJobs) proxy.runningJobs.delete(accountId);
    }
  },

  /**
   * Menangani kegagalan eksekusi & menjadwalkan ulang jika batas retry belum tercapai
   */
  handleFailure: async (config, errorMsg) => {
    const { id: schedulerId, account_id: accountId } = config;
    const MAX_RETRIES = 3;
    const RETRY_COOLDOWN_MS = 10 * 60 * 1000; // 10 Menit selang waktu retry

    try {
      const failedJob = SchedulerDB.getFailedJobByScheduler(schedulerId);
      const currentRetry = failedJob ? failedJob.retry_count : 0;

      const proxy = getProxy();
      const account = proxy.Accounts.getById(accountId);

      if (currentRetry < MAX_RETRIES) {
        const nextRetryCount = currentRetry + 1;
        const nextRetryTime = new Date(Date.now() + RETRY_COOLDOWN_MS);

        logger.warn(`[Scheduler Worker] Menjadwalkan ulang Scheduler ID ${schedulerId} (Retry ${nextRetryCount}/${MAX_RETRIES}) pada ${nextRetryTime.toISOString()}`);
        
        // Catat percobaan retry di database
        SchedulerDB.insertOrUpdateFailedJob({
          scheduler_id: schedulerId,
          account_id: accountId,
          retry_count: nextRetryCount,
          last_error: errorMsg,
          next_retry_at: nextRetryTime.toISOString().replace('T', ' ').substring(0, 19)
        });

        // Masukkan history status RETRY
        SchedulerDB.insertHistory({
          scheduler_id: schedulerId,
          account_id: accountId,
          status: `RETRY_${nextRetryCount}`,
          message: `Percobaan ke-${nextRetryCount} gagal: ${errorMsg}. Direncanakan ulang pada ${nextRetryTime.toLocaleTimeString()}`
        });

        // Kirim Notifikasi Retry
        if (account) {
          getNotificationService().sendRetry({
            nama: account.nama,
            npm: account.npm,
            attempt: nextRetryCount,
            maxAttempts: MAX_RETRIES,
            error: errorMsg,
            nextRetry: nextRetryTime.toLocaleTimeString('id-ID')
          }).catch(err => logger.warn('[Scheduler Worker] Gagal mengirim notifikasi retry:', err.message));
        }

      } else {
        logger.error(`[Scheduler Worker] Scheduler ID ${schedulerId} telah mencapai batas maksimal retry (${MAX_RETRIES}). Ditandai GAGAL.`);
        
        // Bersihkan dari failed jobs
        SchedulerDB.deleteFailedJobByScheduler(schedulerId);

        // Catat history status FAILED
        SchedulerDB.insertHistory({
          scheduler_id: schedulerId,
          account_id: accountId,
          status: 'FAILED',
          message: `Gagal setelah ${MAX_RETRIES} kali percobaan. Kesalahan terakhir: ${errorMsg}`
        });

        // Masukkan ke log utama sebagai kegagalan
        if (proxy.AbsenLog) {
          proxy.AbsenLog.insert(accountId, [{
            kelas: 'AUTOMATIS',
            status: 'gagal',
            pesan: `Scheduler gagal: ${errorMsg}`
          }]);
        }

        // Kirim Notifikasi Gagal Total
        if (account) {
          getNotificationService().sendFailed({
            nama: account.nama,
            npm: account.npm,
            error: errorMsg,
            attempts: MAX_RETRIES
          }).catch(err => logger.warn('[Scheduler Worker] Gagal mengirim notifikasi failed:', err.message));
        }
      }
    } catch (e) {
      logger.error('[Scheduler Worker] Gagal memproses data kegagalan scheduler:', e);
    }
  }
};

module.exports = AbsensiWorker;
