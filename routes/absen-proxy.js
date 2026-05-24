// routes/absen-proxy.js
// ─────────────────────────────────────────────────────────────────────────────
// Backend route untuk modul Absensi SIMKULIAH (standalone module)
// Menangani: CRUD akun, bot Playwright, OCR captcha, log absen
// ─────────────────────────────────────────────────────────────────────────────

const router   = require('express').Router();
module.exports = router;
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');

// Import config dan logger terpusat
const config = require('../config/config');
const logger = require('../utils/logger');
const BrowserManager = require('../utils/browser-manager');
const NotificationService = require('../services/notification');

// ── Setup DB dengan Fallback ─────────────────────────────────────────────────
let db;
let dbFallback = false;

try {
  const DATA_DIR = path.dirname(config.dbPath);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new Database(config.dbPath);
  logger.info(`Database terhubung di ${config.dbPath}`);
} catch (e) {
  logger.error(`Gagal memuat database SQLite di ${config.dbPath}, beralih ke Database Fallback (In-Memory).`, e);
  dbFallback = true;
  try {
    db = new Database(':memory:');
    logger.warn('Database in-memory berhasil diinisialisasi sebagai fallback.');
    
    // Kirim notifikasi fallback db aktif
    NotificationService.sendDbFallbackActive({ error: e.message || String(e) })
      .catch(err => logger.warn('[DB Init] Gagal mengirim notifikasi fallback:', err.message));
  } catch (err) {
    logger.error('Database in-memory pun gagal terinisialisasi!', err);
  }
}

// Inisialisasi skema tabel jika db tersedia
if (db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        nama         TEXT    NOT NULL,
        npm          TEXT    NOT NULL UNIQUE,
        password_enc TEXT    NOT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS absen_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        kelas      TEXT,
        status     TEXT,
        pesan      TEXT,
        absen_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduler_configs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id   INTEGER NOT NULL,
        cron_pattern TEXT    NOT NULL,
        timezone     TEXT    DEFAULT 'Asia/Jakarta',
        is_enabled   INTEGER DEFAULT 1,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduler_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scheduler_id INTEGER NOT NULL,
        account_id   INTEGER NOT NULL,
        status       TEXT    NOT NULL,
        message      TEXT,
        executed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduler_failed_jobs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scheduler_id INTEGER NOT NULL,
        account_id   INTEGER NOT NULL,
        retry_count  INTEGER DEFAULT 0,
        last_error   TEXT,
        next_retry_at DATETIME,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
    `);
    logger.info('Skema database terverifikasi/dibuat.');
  } catch (e) {
    logger.error('Gagal membuat skema database:', e);
  }
}

// ── Enkripsi ─────────────────────────────────────────────────────────────────
const SECRET_KEY = (() => {
  try {
    const rawKey = config.encryptionKey;
    if (rawKey.length < 32) {
      logger.warn(`ENCRYPTION_KEY terlalu pendek (${rawKey.length} karakter). Direkomendasikan minimal 32 karakter.`);
    }
    return crypto.scryptSync(rawKey, 'simkuliah-salt', 32);
  } catch (e) {
    logger.error('Gagal menginisialisasi Kunci Enkripsi! Menggunakan fallback acak.', e);
    return crypto.randomBytes(32);
  }
})();

function encrypt(text) {
  try {
    const iv  = crypto.randomBytes(16);
    const c   = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
    return iv.toString('hex') + ':' + c.update(text, 'utf8', 'hex') + c.final('hex');
  } catch (e) {
    logger.error('Gagal melakukan enkripsi password:', e);
    throw new Error('Proses enkripsi gagal.');
  }
}

function decrypt(enc) {
  try {
    const [ivHex, data] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, Buffer.from(ivHex, 'hex'));
    return d.update(data, 'hex', 'utf8') + d.final('utf8');
  } catch (e) {
    logger.error('Gagal melakukan dekripsi password:', e);
    throw new Error('Proses dekripsi gagal.');
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
const Accounts = {
  getAll: () => {
    try {
      return db.prepare('SELECT id,nama,npm,created_at FROM accounts ORDER BY created_at DESC').all();
    } catch (e) {
      logger.error('DB Error: Accounts.getAll gagal', e);
      return [];
    }
  },
  getById: (id) => {
    try {
      return db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
    } catch (e) {
      logger.error(`DB Error: Accounts.getById gagal untuk ID ${id}`, e);
      return null;
    }
  },
  getPassword: (id) => {
    try {
      const r = db.prepare('SELECT password_enc FROM accounts WHERE id=?').get(id);
      return r ? decrypt(r.password_enc) : null;
    } catch (e) {
      logger.error(`DB Error: Accounts.getPassword gagal untuk ID ${id}`, e);
      return null;
    }
  },
  create: ({ nama, npm, password }) => {
    try {
      const r = db.prepare('INSERT INTO accounts (nama,npm,password_enc) VALUES (?,?,?)').run(nama, npm, encrypt(password));
      return { id: r.lastInsertRowid, nama, npm };
    } catch (e) {
      logger.error('DB Error: Accounts.create gagal', e);
      throw e;
    }
  },
  delete: (id) => {
    try {
      return db.prepare('DELETE FROM accounts WHERE id=?').run(id).changes > 0;
    } catch (e) {
      logger.error(`DB Error: Accounts.delete gagal untuk ID ${id}`, e);
      return false;
    }
  },
};

const AbsenLog = {
  insert: (accountId, items) => {
    try {
      const s = db.prepare('INSERT INTO absen_log (account_id,kelas,status,pesan) VALUES (?,?,?,?)');
      db.transaction((rows) => rows.forEach(r => s.run(accountId, r.kelas, r.status, r.pesan)))(items);
    } catch (e) {
      logger.error(`DB Error: AbsenLog.insert gagal untuk Account ID ${accountId}`, e);
    }
  },
  getByAccount: (id) => {
    try {
      return db.prepare('SELECT * FROM absen_log WHERE account_id=? ORDER BY absen_at DESC LIMIT 50').all(id);
    } catch (e) {
      logger.error(`DB Error: AbsenLog.getByAccount gagal untuk Account ID ${id}`, e);
      return [];
    }
  },
  getRecent: () => {
    try {
      return db.prepare(`
        SELECT l.*,a.nama,a.npm FROM absen_log l
        JOIN accounts a ON a.id=l.account_id
        ORDER BY l.absen_at DESC LIMIT 100
      `).all();
    } catch (e) {
      logger.error('DB Error: AbsenLog.getRecent gagal', e);
      return [];
    }
  },
};

function buildSummaryLogItems(result) {
  const msg = String(result?.message || '').trim();
  if (!msg) return [];
  if (result?.absen_list?.length) return [];
  if (/sudah terabsen|sudah absen/i.test(msg)) {
    return [{ kelas: 'SEMUA KELAS', status: 'berhasil', pesan: msg }];
  }
  if (/belum masuk waktu absen|tidak ada jadwal aktif/i.test(msg)) {
    return [{ kelas: 'SEMUA KELAS', status: 'info', pesan: msg }];
  }
  if (/login gagal|captcha|error/i.test(msg)) {
    return [{ kelas: 'LOGIN', status: 'gagal', pesan: msg }];
  }
  return [{ kelas: 'SEMUA KELAS', status: 'info', pesan: msg }];
}

// ── Bot & Captcha OCR ────────────────────────────────────────────────────────
const BASE_URL       = 'https://simkuliah.usk.ac.id';
const LOGIN_URL      = `${BASE_URL}/index.php/login`;
const ABSENSI_URL    = `${BASE_URL}/index.php/absensi`;
const KONFIRMASI_URL = `${BASE_URL}/index.php/absensi/konfirmasi_kehadiran`;
const runningJobs    = new Set();

const genAI = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;
const GEMINI_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
].filter(Boolean);

function isOutsideAttendanceTimeMessage(msg) {
  const t = String(msg || '').toLowerCase();
  return /belum.*(waktu|jam)|di luar.*(waktu|jam)|waktu absen|jadwal.*belum dimulai|sudah berakhir|belum bisa absen/.test(t);
}

function pickCaptchaCandidate(raw) {
  const text = String(raw || '').replace(/\s+/g, '');
  const candidates = text.match(/[A-Za-z0-9]{4,8}/g) || [];
  if (!candidates.length) return '';
  const bannedFragments = ['SIM', 'KULIAH', 'LOGIN', 'AKUN', 'NPM', 'VERIFIKASI', 'PEG'];
  const filtered = candidates.filter((c) => {
    const up = c.toUpperCase();
    if (up.length < 5 || up.length > 6) return false;
    return !bannedFragments.some((frag) => up.includes(frag));
  });
  if (!filtered.length) return '';
  filtered.sort((a, b) => {
    const score = (s) => {
      if (s.length === 5 || s.length === 6) return 3;
      if (s.length === 4 || s.length === 7) return 2;
      return 1;
    };
    return score(b) - score(a);
  });
  return filtered[0];
}

async function readCaptcha(buf) {
  let lastErr = null;

  if (genAI) {
    for (const modelName of GEMINI_MODEL_CANDIDATES) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          "Baca karakter CAPTCHA di gambar ini. Jawab HANYA karakter CAPTCHA-nya saja. Tanpa spasi atau penjelasan apapun.",
          {
            inlineData: {
              data: buf.toString('base64'),
              mimeType: "image/png",
            },
          }
        ]);
        const parsed = pickCaptchaCandidate(result.response.text());
        if (!parsed) throw new Error('Captcha Gemini tidak valid.');
        return {
          text: parsed,
          provider: `gemini:${modelName}`,
        };
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        logger.warn(`Model Gemini ${modelName} gagal membaca captcha: ${msg}`);
        if (!/not found|not supported|404/i.test(msg)) break;
      }
    }
  } else {
    logger.warn('GEMINI_API_KEY tidak dikonfigurasi. Menggunakan OCR lokal Tesseract.');
  }

  // Fallback OCR lokal
  try {
    const variants = [buf];
    const buildVariant = async (thresholdMax, invert = false) => {
      const img = await Jimp.read(buf);
      img.greyscale().contrast(0.7).normalize().resize({ w: img.bitmap.width * 3, h: img.bitmap.height * 3 });
      img.posterize(3);
      img.threshold({ max: thresholdMax });
      if (invert) img.invert();
      return await img.getBuffer('image/png');
    };

    variants.push(await buildVariant(175, false));
    variants.push(await buildVariant(155, false));
    variants.push(await buildVariant(170, true));

    let best = null;
    for (const vb of variants) {
      const ocr = await Tesseract.recognize(vb, 'eng', {
        logger: () => {},
        tessedit_pageseg_mode: 8,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      });
      const raw = String(ocr?.data?.text || '').trim();
      const parsed = pickCaptchaCandidate(raw);
      if (!parsed) continue;
      const conf = Number(ocr?.data?.confidence || 0);
      if (!best || conf > best.conf) best = { parsed, conf };
    }

    if (best?.parsed) return { text: best.parsed, provider: 'tesseract' };
  } catch (ocrErr) {
    logger.error('Gagal memproses OCR lokal Tesseract:', ocrErr);
    if (!lastErr) lastErr = ocrErr;
  }

  throw lastErr || new Error('Gagal membaca captcha via Gemini dan OCR lokal.');
}

async function captureCaptchaBuffer(page) {
  try {
    const img = page.locator('#captcha-img').first();
    if (await img.count()) {
      const src = await img.getAttribute('src');
      if (src) {
        const abs = new URL(src, LOGIN_URL).toString();
        const resp = await page.request.get(abs, { timeout: 10000 });
        if (resp.ok()) return Buffer.from(await resp.body());
      }
    }
  } catch {}

  for (const sel of ['#captcha-img', "img[src*='captcha']", "img[src*='kode']", 'canvas']) {
    try {
      const el = page.locator(sel).first();
      const box = await el.boundingBox({ timeout: 1500 });
      if (box) return await el.screenshot();
    } catch {}
  }
  return null;
}

async function runAbsen({ npm, password }) {
  let page;
  try {
    page = await BrowserManager.createPage();
  } catch (e) {
    logger.error('Gagal menjalankan Chromium Playwright via Browser Manager!', e);
    return { success: false, message: 'Gagal menjalankan Chromium Playwright via Browser Manager. Pastikan browser terinstal.', absen_list: [], captcha_provider: 'unknown' };
  }

  try {
    logger.info(`Memulai proses absen login untuk NPM: ${npm}`);
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 20000 });
    let loggedIn = false;
    let invalidCaptchaCount = 0;

    let lastCaptchaProvider = 'unknown';
    for (let i = 1; i <= 3; i++) {
      await page.fill('input[placeholder="NIP/NPM"], input[name="username"], input[name="npm"]', npm);
      await page.fill('input[placeholder="Password"], input[name="password"]', password);

      let captchaText = '';
      const captchaBuf = await captureCaptchaBuffer(page);
      if (captchaBuf) {
        try {
          const cap = await readCaptcha(captchaBuf);
          captchaText = cap.text;
          lastCaptchaProvider = cap.provider || lastCaptchaProvider;
        } catch (e) {
          logger.warn(`Percobaan membaca captcha ${i} gagal: ${e.message}`);
        }
      }
      if (!captchaText) {
        try {
          const cap = await readCaptcha(await page.screenshot({ clip: { x:0, y:0, width:700, height:500 } }));
          captchaText = cap.text;
          lastCaptchaProvider = cap.provider || lastCaptchaProvider;
        } catch (e) {}
      }

      if (!captchaText) {
        logger.info(`[Login attempt ${i}] captcha tidak terbaca valid, refresh & retry`);
        invalidCaptchaCount++;
        try { await page.click('.ti-reload, #refresh', { timeout: 2000 }); } catch { await page.reload({ waitUntil: 'networkidle' }); }
        await page.waitForTimeout(800);
        continue;
      }

      logger.info(`[Login attempt ${i}] provider: ${lastCaptchaProvider}, captcha: "${captchaText}"`);
      await page.fill('input[placeholder="Masukkan kode verifikasi"], input[name="captcha"], input[id*="captcha"]', captchaText);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20000 }),
        page.click('button[type="submit"], button:has-text("Login")'),
      ]);

      if (!page.url().includes('login')) { loggedIn = true; break; }
      try { await page.click('.ti-reload, #refresh', { timeout: 2000 }); } catch { await page.reload({ waitUntil: 'networkidle' }); }
      await page.waitForTimeout(600);
    }

    if (!loggedIn) {
      const failMessage = invalidCaptchaCount >= 2
        ? 'Login gagal: CAPTCHA tidak terbaca valid. Coba lagi atau aktifkan Gemini API.'
        : 'Login gagal. Cek NPM/password.';
      logger.warn(`Login gagal untuk NPM ${npm}: ${failMessage}`);
      return {
        success: false,
        message: failMessage,
        absen_list: [],
        captcha_provider: lastCaptchaProvider
      };
    }

    logger.info(`Login berhasil untuk NPM ${npm}. Menavigasi ke halaman absensi...`);
    await page.goto(ABSENSI_URL, { waitUntil: 'networkidle', timeout: 20000 });

    const jadwalList = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('[id^="konfirmasi-kehadiran-"]').forEach(btn => {
        const m = btn.id.match(/konfirmasi-kehadiran-(\d+)/);
        if (!m) return;
        const id = m[1];
        const card = btn.closest('.card');
        const namaKelas = card?.querySelector('h5')?.textContent?.trim() || `Jadwal ID ${id}`;

        for (const script of document.querySelectorAll('script')) {
          const src = script.textContent || '';
          if (!src.includes(`konfirmasi-kehadiran-${id}`)) continue;
          const startIdx = src.indexOf(`konfirmasi-kehadiran-${id}`);
          const block = src.substring(startIdx, startIdx + 1000);
          const getVar = (n) => {
            const names = n === 'kd_mt_kul8' ? ['kd_mt_kul_8','kd_mt_kul8'] : [n];
            for (const name of names) {
              const r = new RegExp(`var\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(block);
              if (r) return r[1];
            }
            return null;
          };
          const data = {
            id, namaKelas,
            kelas: getVar('kelas'), kd_mt_kul8: getVar('kd_mt_kul8'),
            jadwal_mulai: getVar('jadwal_mulai'), jadwal_berakhir: getVar('jadwal_berakhir'),
            pertemuan: getVar('pertemuan'), sks_mengajar: getVar('sks_mengajar'),
          };
          if (data.kelas && data.kd_mt_kul8) { results.push(data); return; }
          results.push({ id, namaKelas, fallback: true }); return;
        }
        results.push({ id, namaKelas, fallback: true });
      });
      return results;
    });

    if (jadwalList.length === 0) {
      const sudah = await page.locator('text=Anda sudah absen').count();
      logger.info(`Tidak ada tombol konfirmasi untuk NPM ${npm}. Terabsen: ${sudah > 0}`);
      return {
        success: true,
        message: sudah > 0 ? 'Sudah terabsen semua.' : 'Belum masuk waktu absen / tidak ada jadwal aktif saat ini.',
        absen_list: [],
        outside_time: !sudah,
        captcha_provider: lastCaptchaProvider
      };
    }

    const absen_list = [];
    for (const j of jadwalList) {
      try {
        let res;
        if (j.fallback) {
          let txt = null;
          const h = async (r) => { if (r.url().includes('konfirmasi_kehadiran')) try { txt = await r.text(); } catch {} };
          page.on('response', h);
          await page.click(`#konfirmasi-kehadiran-${j.id}`, { timeout: 5000 });
          await page.waitForTimeout(700);
          await page.evaluate(() => { document.querySelector('.confirm, .swal2-confirm')?.click(); });
          await page.waitForTimeout(2500);
          page.off('response', h);
          res = { kelas: j.namaKelas, status: (txt||'').trim()==='success'?'berhasil':'gagal', pesan: (txt||'').trim()||'Tidak ada respon' };
        } else {
          const r = await page.evaluate(async ({ url, data }) => {
            try {
              const body = new URLSearchParams(data).toString();
              const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body, credentials:'include' });
              return { ok:true, text: await res.text() };
            } catch(e) { return { ok:false, error:e.message }; }
          }, { url: KONFIRMASI_URL, data: { kelas:j.kelas, kd_mt_kul8:j.kd_mt_kul8, jadwal_mulai:j.jadwal_mulai, jadwal_berakhir:j.jadwal_berakhir, pertemuan:j.pertemuan, sks_mengajar:j.sks_mengajar, id:j.id } });
          const ok = r.ok && r.text.trim() === 'success';
          res = { kelas: j.namaKelas, status: ok?'berhasil':'gagal', pesan: ok?'Kehadiran berhasil dikonfirmasi':(r.text||r.error||'Error') };
        }
        logger.info(`[Absensi NPM ${npm}] ${res.status==='berhasil'?'✅':'❌'} ${j.namaKelas}`);
        absen_list.push(res);
      } catch(e) {
        logger.error(`Error konfirmasi kelas ${j.namaKelas} untuk NPM ${npm}`, e);
        absen_list.push({ kelas: j.namaKelas, status:'error', pesan: e.message });
      }
    }

    const berhasil = absen_list.filter(x => x.status === 'berhasil').length;
    const allOutsideTime = absen_list.length > 0 &&
      berhasil === 0 &&
      absen_list.every((x) => isOutsideAttendanceTimeMessage(x.pesan));

    const message = allOutsideTime
      ? 'Belum masuk waktu absen untuk jadwal saat ini.'
      : `Selesai: ${berhasil}/${absen_list.length} berhasil.`;

    return {
      success: true,
      message,
      absen_list,
      outside_time: allOutsideTime,
      captcha_provider: lastCaptchaProvider
    };

  } catch(e) {
    logger.error(`Error pada proses absensi NPM ${npm}`, e);
    return { success: false, message: `Error: ${e.message}`, absen_list: [], captcha_provider: 'unknown' };
  } finally {
    try {
      await BrowserManager.closePage(page);
    } catch (e) {
      logger.error('Error saat menutup page Playwright', e);
    }
  }
}

// ── Startup Validation ────────────────────────────────────────────────────────
(() => {
  logger.info('=== Memulai Startup Validation Absensi-Module ===');
  try {
    const dataDir = path.dirname(config.dbPath);
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`Direktori data siap: ${dataDir}`);
  } catch (e) {
    logger.warn('Gagal memverifikasi/membuat direktori data:', e);
  }

  if (dbFallback) {
    logger.warn('Aplikasi berjalan dengan Database Fallback (In-Memory). Data tidak akan tersimpan secara permanen.');
  } else {
    logger.info('Koneksi SQLite primer operasional.');
  }

  if (config.encryptionKey === 'ganti-dengan-32-karakter-rahasia!') {
    logger.warn('Aplikasi menggunakan ENCRYPTION_KEY default. Sangat tidak direkomendasikan untuk production!');
  } else if (config.encryptionKey.length < 32) {
    logger.warn(`ENCRYPTION_KEY kurang dari 32 karakter (${config.encryptionKey.length}).`);
  } else {
    logger.info('ENCRYPTION_KEY terdeteksi dan dikonfigurasi.');
  }

  if (!config.geminiApiKey) {
    logger.warn('GEMINI_API_KEY kosong. Sistem akan menggunakan Tesseract OCR lokal yang memiliki tingkat akurasi lebih rendah.');
  } else {
    logger.info('GEMINI_API_KEY terdeteksi.');
  }

  try {
    require('playwright');
    logger.info('Playwright SDK terinstall.');
  } catch (e) {
    logger.error('Playwright SDK tidak ditemukan! Bot tidak akan bisa berjalan.', e);
  }

  logger.info('=== Startup Validation Selesai ===');
})();

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /health
router.get('/health', (req, res) => {
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {
    logger.error('Koneksi database ke healthcheck gagal', e);
  }

  const status = {
    status: dbOk && !dbFallback ? 'healthy' : 'degraded',
    database: {
      connected: dbOk,
      fallbackMode: dbFallback,
      path: config.dbPath
    },
    config: {
      hasGeminiKey: !!config.geminiApiKey,
      encryptionKeyLength: config.encryptionKey.length
    },
    uptime: process.uptime()
  };

  res.status(status.status === 'healthy' ? 200 : 503).json(status);
});

// GET /api/accounts
router.get('/accounts', (req, res) => {
  try {
    res.json({ success: true, data: Accounts.getAll() });
  } catch(e) {
    logger.error('API Error: GET /accounts gagal', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil data akun dari database.' });
  }
});

// POST /api/accounts
router.post('/accounts', (req, res) => {
  const { nama, npm, password } = req.body || {};
  if (!nama || !npm || !password)
    return res.status(400).json({ success: false, message: "Nama, NPM, dan Password wajib diisi." });
  try {
    const acc = Accounts.create({ nama, npm, password });
    res.status(201).json({ success: true, data: acc });
  } catch(e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: 'NPM sudah terdaftar.' });
    }
    logger.error('API Error: POST /accounts gagal', e);
    res.status(500).json({ success: false, message: 'Gagal menambahkan akun ke database.' });
  }
});

// DELETE /api/accounts/:id
router.delete('/accounts/:id', (req, res) => {
  try {
    const deleted = Accounts.delete(Number(req.params.id));
    if (!deleted) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    res.json({ success: true, message: 'Akun berhasil dihapus.' });
  } catch (e) {
    logger.error(`API Error: DELETE /accounts/${req.params.id} gagal`, e);
    res.status(500).json({ success: false, message: 'Gagal menghapus akun dari database.' });
  }
});

// GET /api/accounts/:id/log
router.get('/accounts/:id/log', (req, res) => {
  try {
    res.json({ success: true, data: AbsenLog.getByAccount(Number(req.params.id)) });
  } catch (e) {
    logger.error(`API Error: GET /accounts/${req.params.id}/log gagal`, e);
    res.status(500).json({ success: false, message: 'Gagal mengambil log akun.' });
  }
});

// POST /api/absen/all
router.post('/absen/all', async (req, res) => {
  try {
    const accounts = Accounts.getAll();
    if (!accounts.length) return res.status(404).json({ success: false, message: 'Belum ada akun terdaftar.' });

    const jobs = accounts.map(async acc => {
      try {
        const password = Accounts.getPassword(acc.id);
        if (!password) throw new Error('Password tidak ditemukan atau gagal didekripsi.');
        const result = await runAbsen({ npm: acc.npm, password });
        const items = result.absen_list?.length ? result.absen_list : buildSummaryLogItems(result);
        if (items.length) AbsenLog.insert(acc.id, items);
        return { account_id: acc.id, nama: acc.nama, npm: acc.npm, ...result };
      } catch (err) {
        logger.error(`Gagal memproses absen massal untuk NPM: ${acc.npm}`, err);
        return { account_id: acc.id, nama: acc.nama, npm: acc.npm, success: false, message: err.message };
      }
    });

    const settled = await Promise.allSettled(jobs);
    const data    = settled.map(r => r.status === 'fulfilled' ? r.value : { success: false, message: r.reason?.message });
    res.json({ success: true, message: `${accounts.length} akun diproses.`, data });
  } catch (e) {
    logger.error('API Error: POST /absen/all gagal', e);
    res.status(500).json({ success: false, message: 'Gagal menjalankan absen massal.' });
  }
});

// POST /api/absen/:id
router.post('/absen/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const account = Accounts.getById(id);
    if (!account) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    if (runningJobs.has(id)) return res.status(409).json({ success: false, message: 'Proses absen sedang berjalan untuk akun ini.' });

    runningJobs.add(id);
    try {
      const password = Accounts.getPassword(id);
      if (!password) throw new Error('Password tidak ditemukan atau gagal didekripsi.');
      const result = await runAbsen({ npm: account.npm, password });
      const items = result.absen_list?.length ? result.absen_list : buildSummaryLogItems(result);
      if (items.length) AbsenLog.insert(id, items);
      res.json({ success: result.success, message: result.message, data: result.absen_list });
    } catch(err) {
      logger.error(`Gagal memproses absen untuk ID ${id}`, err);
      res.status(500).json({ success: false, message: `Gagal menjalankan absen: ${err.message}`, data: [] });
    } finally {
      runningJobs.delete(id);
    }
  } catch (e) {
    logger.error(`API Error: POST /absen/${id} gagal`, e);
    res.status(500).json({ success: false, message: 'Gagal memproses permintaan absen.' });
  }
});

// GET /api/absen/log
router.get('/absen/log', (req, res) => {
  try {
    res.json({ success: true, data: AbsenLog.getRecent() });
  } catch (e) {
    logger.error('API Error: GET /absen/log gagal', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil data log absensi.' });
  }
});

// Set export properties early before circular reference imports are triggered
router.db = db;
router.runAbsen = runAbsen;
router.Accounts = Accounts;
router.AbsenLog = AbsenLog;
router.runningJobs = runningJobs;

// ── Scheduler API Routes ──────────────────────────────────────────────────────
const SchedulerDB = require('../services/scheduler-db');
const scheduler = require('../scheduler/manager');

// GET /api/scheduler/status
router.get('/scheduler/status', (req, res) => {
  try {
    res.json({ success: true, data: scheduler.getHealthStatus() });
  } catch (e) {
    logger.error('API Error: GET /scheduler/status gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/scheduler/configs
router.get('/scheduler/configs', (req, res) => {
  try {
    res.json({ success: true, data: SchedulerDB.getConfigs() });
  } catch (e) {
    logger.error('API Error: GET /scheduler/configs gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/scheduler/configs
router.post('/scheduler/configs', (req, res) => {
  const { account_id, cron_pattern, timezone, is_enabled } = req.body || {};
  if (!account_id || !cron_pattern) {
    return res.status(400).json({ success: false, message: 'account_id dan cron_pattern wajib diisi.' });
  }

  try {
    const config = SchedulerDB.createConfig({ account_id: Number(account_id), cron_pattern, timezone, is_enabled: is_enabled !== undefined ? Number(is_enabled) : 1 });
    // Reload task di cron manager
    scheduler.reloadJob(config.id);
    res.status(201).json({ success: true, data: config });
  } catch (e) {
    logger.error('API Error: POST /scheduler/configs gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/scheduler/configs/:id
router.put('/scheduler/configs/:id', (req, res) => {
  const id = Number(req.params.id);
  const { cron_pattern, timezone, is_enabled } = req.body || {};

  try {
    const updated = SchedulerDB.updateConfig(id, { 
      cron_pattern, 
      timezone, 
      is_enabled: is_enabled !== undefined ? Number(is_enabled) : undefined 
    });
    // Reload task di cron manager
    scheduler.reloadJob(id);
    res.json({ success: true, data: updated });
  } catch (e) {
    logger.error(`API Error: PUT /scheduler/configs/${id} gagal`, e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/scheduler/configs/:id
router.delete('/scheduler/configs/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    // Unregister di cron manager
    scheduler.unregisterJob(id);
    const deleted = SchedulerDB.deleteConfig(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Konfigurasi tidak ditemukan.' });
    res.json({ success: true, message: 'Konfigurasi scheduler dihapus.' });
  } catch (e) {
    logger.error(`API Error: DELETE /scheduler/configs/${id} gagal`, e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/scheduler/configs/:id/toggle
router.post('/scheduler/configs/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  try {
    const current = SchedulerDB.getConfigById(id);
    if (!current) return res.status(404).json({ success: false, message: 'Konfigurasi tidak ditemukan.' });
    
    const newStatus = current.is_enabled === 1 ? 0 : 1;
    SchedulerDB.updateConfig(id, { is_enabled: newStatus });
    
    // Reload task di cron manager
    scheduler.reloadJob(id);
    
    res.json({ success: true, data: { id, is_enabled: newStatus } });
  } catch (e) {
    logger.error(`API Error: POST /scheduler/configs/${id}/toggle gagal`, e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/scheduler/history
router.get('/scheduler/history', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  try {
    res.json({ success: true, data: SchedulerDB.getHistory(limit) });
  } catch (e) {
    logger.error('API Error: GET /scheduler/history gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Monitoring & Backup APIs ────────────────────────────────────────────────
const MonitoringService = require('../services/monitoring');
const BackupService = require('../services/backup');

// GET /api/monitor/stats
router.get('/monitor/stats', async (req, res) => {
  try {
    const stats = await MonitoringService.getStats();
    res.json({ success: true, data: stats });
  } catch (e) {
    logger.error('API Error: GET /monitor/stats gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/backups
router.get('/backups', (req, res) => {
  try {
    const list = BackupService.listBackups();
    res.json({ success: true, data: list });
  } catch (e) {
    logger.error('API Error: GET /backups gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/backups
router.post('/backups', async (req, res) => {
  try {
    const filename = await BackupService.backupNow();
    res.json({ success: true, message: `Backup berhasil dibuat: ${filename}`, filename });
  } catch (e) {
    logger.error('API Error: POST /backups gagal', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/backups/restore
router.post('/backups/restore', async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) {
    return res.status(400).json({ success: false, message: 'Nama berkas backup wajib dikirim.' });
  }
  try {
    await BackupService.restoreBackup(filename);
    res.json({ success: true, message: 'Database primer berhasil dipulihkan dari berkas cadangan.' });
  } catch (e) {
    logger.error(`API Error: POST /backups/restore untuk ${filename} gagal`, e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Router is already exported at the top, properties assigned early.