const path = require('path');
const fs = require('fs');

try {
  // 1. Coba load .env lokal di Absensi-Module terlebih dahulu
  require('dotenv').config();
} catch (e) {
  // Silent catch
}

// 2. Jika ENCRYPTION_KEY tidak ada di .env lokal, coba cari di sibling Jebb Bot/.env
if (!process.env.ENCRYPTION_KEY) {
  try {
    const siblingEnvPath = path.join(__dirname, '../../Jebb Bot/.env');
    if (fs.existsSync(siblingEnvPath)) {
      require('dotenv').config({ path: siblingEnvPath });
    }
  } catch (e) {
    // Silent catch
  }
}

module.exports = {
  dbPath: process.env.ABSEN_DB_PATH || path.join(__dirname, '../data/absen.db'),
  encryptionKey: process.env.ENCRYPTION_KEY || 'ganti-dengan-32-karakter-rahasia!',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  logLevel: process.env.ABSEN_LOG_LEVEL || 'info', // info, warn, error
  logToFile: process.env.ABSEN_LOG_TO_FILE !== 'false',
  logFilePath: path.join(__dirname, '../logs/absen.log'),
  playwright: {
    headless: process.env.ABSEN_BROWSER_HEADLESS !== 'false',
    timeout: parseInt(process.env.ABSEN_BROWSER_TIMEOUT || '60000', 10),
  }
};
