const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const levels = { info: 0, warn: 1, error: 2 };

function getTimestamp() {
  return new Date().toISOString();
}

function writeLog(level, message, error = null) {
  const currentLevel = levels[config.logLevel] !== undefined ? levels[config.logLevel] : 0;
  const targetLevel = levels[level];
  
  if (targetLevel < currentLevel) return;

  let logMsg = `[${getTimestamp()}] [${level.toUpperCase()}] ${message}`;
  if (error) {
    logMsg += ` | Error: ${error.message}\n${error.stack}`;
  }

  // Console output
  if (level === 'error') {
    console.error(`🔴 ${logMsg}`);
  } else if (level === 'warn') {
    console.warn(`🟡 ${logMsg}`);
  } else {
    console.log(`🟢 ${logMsg}`);
  }

  // File output
  if (config.logToFile) {
    try {
      const dir = path.dirname(config.logFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(config.logFilePath, logMsg + '\n', 'utf8');
    } catch (e) {
      console.error('❌ Gagal menulis log ke file:', e.message);
    }
  }
}

module.exports = {
  info: (msg) => writeLog('info', msg),
  warn: (msg, err) => writeLog('warn', msg, err),
  error: (msg, err) => writeLog('error', msg, err),
};
