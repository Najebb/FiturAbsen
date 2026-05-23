const path = require('path');

try {
  require('dotenv').config();
} catch (e) {
  // Silent catch jika dotenv tidak terinstall di sub-module
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
