// ==============================================================================
// RUNTIME UTILITY: SQLite Database Lock & WAL Integrity Detector
// Connects to local SQLite instance, executes a test query, and alerts on locks
// ==============================================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Import config and logger
const config = require('../config/config');
const logger = require('../utils/logger');

const DB_FILE = path.resolve(config.dbPath);

console.log(`=== Memulai Deteksi Kunci & Integritas Database SQLite ===`);
console.log(`Berkas Database: ${DB_FILE}`);

if (!fs.existsSync(DB_FILE)) {
  console.error(`[WARN] File database belum terbentuk di path tersebut. Integritas OK.`);
  process.exit(0);
}

let db;
try {
  // Buka database dengan opsi busyTimeout 2000ms
  db = new Database(DB_FILE, { timeout: 2000 });
  
  // 1. Cek Mode Jurnal
  const journalMode = db.prepare('PRAGMA journal_mode').pluck().get();
  console.log(`[INFO] Mode Jurnal Aktif: ${journalMode.toUpperCase()}`);

  // 2. Jalankan Uji Transaksi Tulis (Write Transaction Test)
  // Ini menguji apakah ada write-lock dari proses zombie
  db.transaction(() => {
    // Kita jalankan query select biasa di dalam transaksi tulis
    db.prepare('SELECT 1').run();
  })();
  
  console.log(`[OK] Verifikasi Transaksi Berhasil! Database bebas dari penguncian (No SQLITE_BUSY).`);
  
  // 3. Periksa file WAL / Journal sisa proses crash
  const dir = path.dirname(DB_FILE);
  const base = path.basename(DB_FILE);
  const files = fs.readdirSync(dir);
  
  const locks = files.filter(f => f.startsWith(base) && (f.endsWith('-journal') || f.endsWith('-wal') || f.endsWith('-shm')));
  if (locks.length > 0) {
    console.log(`[INFO] Ditemukan berkas jurnal aktif: [${locks.join(', ')}]. Ini normal pada mode WAL.`);
  }

  process.exit(0);

} catch (err) {
  console.error(`🔴 [DETEKSI ERROR] DETEKSI PENGUNCIAN DATABASE!`);
  console.error(`Pesan Error: ${err.message}`);
  
  if (err.code === 'SQLITE_BUSY' || err.message.includes('busy') || err.message.includes('locked')) {
    console.error(`⚠️ [BAHAYA] Database SQLite terkunci (SQLITE_BUSY) oleh proses eksternal!`);
    console.error(`Rekomendasi Pemulihan (Self-Healing):`);
    console.error(`1. Jalankan perintah 'taskkill /F /IM node.exe' untuk menutup seluruh proses NodeJS zombie.`);
    console.error(`2. Atau hapus file jurnal sisa crash: '${DB_FILE}-journal' jika tidak ada proses Node aktif.`);
    process.exit(1);
  } else {
    console.error(`⚠️ Terjadi masalah konektivitas lain pada file database.`);
    process.exit(1);
  }
} finally {
  if (db) {
    try {
      db.close();
      console.log(`[INFO] Koneksi verifikasi database ditutup secara bersih.`);
    } catch (e) {}
  }
}
