// services/rule-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine untuk kompilasi jadwal mingguan ke Cron dan simulasi preview
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../utils/logger');
const CalendarService = require('./calendar');

// Lazy-require to prevent circular dependency at startup
let dbInstance = null;
function getDB() {
  if (!dbInstance) {
    const proxy = require('../routes/absen-proxy');
    dbInstance = proxy.db;
  }
  return dbInstance;
}

let schedulerManagerInstance = null;
function getSchedulerManager() {
  if (!schedulerManagerInstance) {
    schedulerManagerInstance = require('../scheduler/manager');
  }
  return schedulerManagerInstance;
}

const RuleEngine = {
  /**
   * Mendapatkan aturan mingguan untuk suatu akun
   */
  getRulesByAccount: (accountId) => {
    try {
      const db = getDB();
      const rows = db.prepare('SELECT * FROM scheduler_rules WHERE account_id = ?').all(accountId);
      
      // Kembalikan 7 hari penuh (Minggu = 0 s/d Sabtu = 6) dengan default kosong jika belum diset
      const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const rules = [];
      
      for (let d = 0; d < 7; d++) {
        const match = rows.find(r => r.day_of_week === d);
        rules.push({
          day_of_week: d,
          day_name: days[d],
          time_slots: match ? match.time_slots : '',
          is_enabled: match ? match.is_enabled : 0
        });
      }
      return rules;
    } catch (e) {
      logger.error(`[Rule Engine] Gagal mengambil aturan untuk akun ID ${accountId}:`, e);
      return [];
    }
  },

  /**
   * Menyimpan aturan mingguan untuk suatu akun dan menyusunnya ke scheduler_configs
   */
  saveRules: (accountId, rulesArray) => {
    const db = getDB();
    
    try {
      db.transaction(() => {
        const stmt = db.prepare(`
          INSERT INTO scheduler_rules (account_id, day_of_week, time_slots, is_enabled, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(account_id, day_of_week) DO UPDATE SET
            time_slots = excluded.time_slots,
            is_enabled = excluded.is_enabled,
            updated_at = CURRENT_TIMESTAMP
        `);
        
        for (const r of rulesArray) {
          const day = Number(r.day_of_week);
          const enabled = r.is_enabled ? 1 : 0;
          
          // Bersihkan string time_slots (misal: " 10:50 , 17:30 " -> "10:50,17:30")
          const cleanSlots = String(r.time_slots || '')
            .split(',')
            .map(s => s.trim())
            .filter(s => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(s)) // validasi format HH:MM
            .join(',');
            
          stmt.run(accountId, day, cleanSlots, enabled);
        }
      })();
      
      logger.info(`[Rule Engine] Berhasil menyimpan aturan mingguan untuk Akun ID ${accountId}`);
      
      // Pemicu kompilasi ke scheduler_configs
      RuleEngine.compileRulesToConfigs(accountId);
      return true;
    } catch (e) {
      logger.error(`[Rule Engine] Gagal menyimpan aturan untuk akun ID ${accountId}:`, e);
      throw e;
    }
  },

  /**
   * Kompilasi scheduler_rules ke scheduler_configs (node-cron pattern)
   */
  compileRulesToConfigs: (accountId) => {
    const db = getDB();
    
    try {
      // 1. Ambil semua aturan aktif dari database
      const activeRules = db.prepare(`
        SELECT * FROM scheduler_rules 
        WHERE account_id = ? AND is_enabled = 1 AND time_slots != ''
      `).all(accountId);
      
      db.transaction(() => {
        // 2. Hapus konfigurasi lama untuk akun ini
        db.prepare('DELETE FROM scheduler_configs WHERE account_id = ?').run(accountId);
        
        // 3. Masukkan konfigurasi baru hasil kompilasi
        const insertStmt = db.prepare(`
          INSERT INTO scheduler_configs (account_id, cron_pattern, timezone, is_enabled)
          VALUES (?, ?, 'Asia/Jakarta', 1)
        `);
        
        for (const rule of activeRules) {
          const dayOfWeek = rule.day_of_week;
          const slots = rule.time_slots.split(',');
          
          for (const slot of slots) {
            const [hour, minute] = slot.split(':');
            // Format cron pattern: "minute hour * * day_of_week"
            const cronPattern = `${Number(minute)} ${Number(hour)} * * ${dayOfWeek}`;
            insertStmt.run(accountId, cronPattern);
          }
        }
      })();
      
      logger.info(`[Rule Engine] Berhasil kompilasi aturan mingguan ke tabel scheduler_configs untuk Akun ID ${accountId}`);
      
      // 4. Reload scheduler manager untuk akun ini agar cron baru terdaftar
      const scheduler = getSchedulerManager();
      if (scheduler && typeof scheduler.reloadAccountConfigs === 'function') {
        scheduler.reloadAccountConfigs(accountId);
      }
    } catch (e) {
      logger.error(`[Rule Engine] Gagal kompilasi aturan ke config untuk akun ID ${accountId}:`, e);
      throw e;
    }
  },

  /**
   * Mensimulasikan jadwal absensi selama 7 hari ke depan untuk melihat hari eksekusi & skip
   */
  getPreview: (accountId) => {
    try {
      const rules = RuleEngine.getRulesByAccount(accountId);
      const activeRules = rules.filter(r => r.is_enabled === 1 && r.time_slots !== '');
      
      const previewList = [];
      const now = new Date();
      
      // Ambil data akun untuk melihat apakah akun itu sendiri dinonaktifkan
      const proxy = require('../routes/absen-proxy');
      const account = proxy.Accounts.getById(accountId);
      const isAccountInactive = account && account.is_active === 0;

      // Iterasi selama 7 hari ke depan (dimulai dari hari ini)
      for (let i = 0; i < 7; i++) {
        const targetDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        const dayOfWeek = targetDate.getDay();
        const dateStr = CalendarService.getJakartaDateStr(targetDate);
        
        const ruleMatch = activeRules.find(r => r.day_of_week === dayOfWeek);
        if (ruleMatch) {
          const slots = ruleMatch.time_slots.split(',');
          
          for (const slot of slots) {
            // Prediksi kecocokan running
            const timeObj = new Date(`${dateStr}T${slot}:00`);
            
            // Cek Smart Rules evaluasi
            let skipped = false;
            let reason = '';
            
            if (isAccountInactive) {
              skipped = true;
              reason = 'Akun mahasiswa dinonaktifkan.';
            } else {
              const holidayName = CalendarService.isHoliday(dateStr);
              const breakName = CalendarService.isSemesterBreak(dateStr);
              const isOutside = CalendarService.isOutsideSemester(dateStr);
              
              if (holidayName) {
                skipped = true;
                reason = `Hari Libur Nasional: ${holidayName}`;
              } else if (breakName) {
                skipped = true;
                reason = `Masa Libur Semester: ${breakName}`;
              } else if (isOutside) {
                skipped = true;
                reason = 'Di luar masa aktif perkuliahan semester.';
              }
            }
            
            previewList.push({
              date: dateStr,
              time: slot,
              timestamp: timeObj.getTime(),
              day_name: ruleMatch.day_name,
              skipped,
              reason
            });
          }
        }
      }
      
      // Urutkan secara kronologis berdasarkan waktu eksekusi
      previewList.sort((a, b) => a.timestamp - b.timestamp);
      return previewList;
    } catch (e) {
      logger.error(`[Rule Engine] Gagal membuat preview untuk akun ID ${accountId}:`, e);
      return [];
    }
  }
};

module.exports = RuleEngine;
