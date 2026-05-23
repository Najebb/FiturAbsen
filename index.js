// =============================================================================
// Absensi SIMKULIAH — Module Entry Point
// =============================================================================
//
// Module ini berisi fitur absensi otomatis SIMKULIAH yang dipisahkan
// dari project utama ZieeBot.
//
// CARA PAKAI:
//   const absensi = require('../Absensi-Module');  // path dari Jebb Bot/
//   app.use('/api', absensi.router);
//   // Opsional: serve frontend assets
//   app.use('/absen-assets', express.static(absensi.frontendDir));
// =============================================================================

const path = require('path');

module.exports = {
  // Express router untuk API endpoints absensi
  // Routes: /accounts, /absen/all, /absen/:id, /absen/log
  router: require('./routes/absen-proxy'),

  // Path ke folder frontend (HTML, CSS, JS)
  frontendDir: path.join(__dirname, 'frontend'),

  // Path ke folder data (absen.db akan di-create otomatis)
  dataDir: path.join(__dirname, 'data'),

  // Metadata module
  name: 'absensi-simkuliah',
  version: '1.0.0',
  description: 'Modul absensi otomatis SIMKULIAH dengan Playwright + OCR captcha',
};
