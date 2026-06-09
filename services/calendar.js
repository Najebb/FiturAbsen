// services/calendar.js
// ─────────────────────────────────────────────────────────────────────────────
// Layanan evaluasi tanggal libur nasional, kalender akademik, dan rule status
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const HOLIDAYS_PATH = path.join(__dirname, '../data/holidays.json');
const CALENDAR_PATH = path.join(__dirname, '../data/academic-calendar.json');

const CalendarService = {
  /**
   * Mendapatkan daftar hari libur nasional
   */
  getHolidays: () => {
    try {
      if (fs.existsSync(HOLIDAYS_PATH)) {
        const raw = fs.readFileSync(HOLIDAYS_PATH, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      logger.error('[Calendar Service] Gagal membaca holidays.json:', e);
    }
    return [];
  },

  /**
   * Menyimpan daftar hari libur nasional
   */
  saveHolidays: (data) => {
    try {
      fs.writeFileSync(HOLIDAYS_PATH, JSON.stringify(data, null, 2), 'utf8');
      logger.info('[Calendar Service] Berhasil memperbarui holidays.json');
      return true;
    } catch (e) {
      logger.error('[Calendar Service] Gagal menulis holidays.json:', e);
      return false;
    }
  },

  /**
   * Mendapatkan detail kalender akademik
   */
  getAcademicCalendar: () => {
    try {
      if (fs.existsSync(CALENDAR_PATH)) {
        const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      logger.error('[Calendar Service] Gagal membaca academic-calendar.json:', e);
    }
    return { semester_start: '', semester_end: '', semester_breaks: [] };
  },

  /**
   * Menyimpan detail kalender akademik
   */
  saveAcademicCalendar: (data) => {
    try {
      fs.writeFileSync(CALENDAR_PATH, JSON.stringify(data, null, 2), 'utf8');
      logger.info('[Calendar Service] Berhasil memperbarui academic-calendar.json');
      return true;
    } catch (e) {
      logger.error('[Calendar Service] Gagal menulis academic-calendar.json:', e);
      return false;
    }
  },

  /**
   * Mendapatkan string tanggal hari ini di timezone Asia/Jakarta (format: YYYY-MM-DD)
   */
  getJakartaDateStr: (date = new Date()) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(date);
    } catch (e) {
      // Fallback
      return date.toISOString().split('T')[0];
    }
  },

  /**
   * Mengecek apakah tanggal tertentu merupakan hari libur nasional
   */
  isHoliday: (dateStr) => {
    const holidays = CalendarService.getHolidays();
    const match = holidays.find(h => h.date === dateStr);
    return match ? match.name : null;
  },

  /**
   * Mengecek apakah tanggal tertentu berada dalam masa libur semester
   */
  isSemesterBreak: (dateStr) => {
    const calendar = CalendarService.getAcademicCalendar();
    if (!calendar.semester_breaks || !Array.isArray(calendar.semester_breaks)) {
      return null;
    }

    const match = calendar.semester_breaks.find(b => {
      return dateStr >= b.start && dateStr <= b.end;
    });
    return match ? match.name : null;
  },

  /**
   * Mengecek apakah tanggal tertentu berada di luar masa perkuliahan semester aktif
   */
  isOutsideSemester: (dateStr) => {
    const calendar = CalendarService.getAcademicCalendar();
    const start = calendar.semester_start;
    const end = calendar.semester_end;

    if (!start || !end) return false; // Abaikan jika kalender tidak didefinisikan
    return dateStr < start || dateStr > end;
  },

  /**
   * Validasi Smart Rules: Mengecek apakah absensi mahasiswa boleh dijalankan
   */
  checkShouldRun: (accountId, dateInput = new Date()) => {
    const dateStr = typeof dateInput === 'string' ? dateInput : CalendarService.getJakartaDateStr(dateInput);
    
    // 1. Cek keaktifan akun mahasiswa
    try {
      const proxy = require('../routes/absen-proxy');
      const account = proxy.Accounts.getById(accountId);
      if (!account) {
        return { shouldRun: false, reason: 'Akun mahasiswa tidak terdaftar di database.' };
      }
      if (account.is_active === 0) {
        return { shouldRun: false, reason: 'Akun dinonaktifkan sementara oleh pengguna.' };
      }
    } catch (e) {
      logger.error(`[Calendar Service] Gagal memverifikasi akun ID ${accountId}:`, e);
    }

    // 2. Cek apakah hari libur nasional
    const holidayName = CalendarService.isHoliday(dateStr);
    if (holidayName) {
      return { shouldRun: false, reason: `Hari libur nasional: ${holidayName}` };
    }

    // 3. Cek apakah masa libur semester
    const breakName = CalendarService.isSemesterBreak(dateStr);
    if (breakName) {
      return { shouldRun: false, reason: `Masa libur semester: ${breakName}` };
    }

    // 4. Cek apakah berada di luar masa aktif perkuliahan semester
    if (CalendarService.isOutsideSemester(dateStr)) {
      return { shouldRun: false, reason: 'Di luar rentang tanggal perkuliahan aktif semester.' };
    }

    return { shouldRun: true };
  }
};

module.exports = CalendarService;
