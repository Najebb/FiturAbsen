// routes/absen-proxy.js
// ─────────────────────────────────────────────────────────────────────────────
// Backend route untuk modul Absensi SIMKULIAH (standalone module)
// Menangani: CRUD akun, bot Playwright, OCR captcha, log absen
//
// CARA PAKAI:
//   const absensi = require('../Absensi-Module');
//   app.use('/api', absensi.router);
//
// DATA_DIR: ../data (relative to this file) → Absensi-Module/data/
// ─────────────────────────────────────────────────────────────────────────────

const router   = require('express').Router();
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');

// ── Setup DB ─────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'absen.db'));
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
`);

// ── Enkripsi ─────────────────────────────────────────────────────────────────
const RAW_KEY    = process.env.ENCRYPTION_KEY || 'ganti-dengan-32-karakter-rahasia!';
const SECRET_KEY = crypto.scryptSync(RAW_KEY, 'simkuliah-salt', 32);

function encrypt(text) {
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
  return iv.toString('hex') + ':' + c.update(text, 'utf8', 'hex') + c.final('hex');
}
function decrypt(enc) {
  const [ivHex, data] = enc.split(':');
  const d = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, Buffer.from(ivHex, 'hex'));
  return d.update(data, 'hex', 'utf8') + d.final('utf8');
}

// ── DB helpers ────────────────────────────────────────────────────────────────
const Accounts = {
  getAll:      ()   => db.prepare('SELECT id,nama,npm,created_at FROM accounts ORDER BY created_at DESC').all(),
  getById:     (id) => db.prepare('SELECT * FROM accounts WHERE id=?').get(id),
  getPassword: (id) => { const r = db.prepare('SELECT password_enc FROM accounts WHERE id=?').get(id); return r ? decrypt(r.password_enc) : null; },
  create: ({ nama, npm, password }) => {
    const r = db.prepare('INSERT INTO accounts (nama,npm,password_enc) VALUES (?,?,?)').run(nama, npm, encrypt(password));
    return { id: r.lastInsertRowid, nama, npm };
  },
  delete: (id) => db.prepare('DELETE FROM accounts WHERE id=?').run(id).changes > 0,
};
const AbsenLog = {
  insert: (accountId, items) => {
    const s = db.prepare('INSERT INTO absen_log (account_id,kelas,status,pesan) VALUES (?,?,?,?)');
    db.transaction((rows) => rows.forEach(r => s.run(accountId, r.kelas, r.status, r.pesan)))(items);
  },
  getByAccount: (id) => db.prepare('SELECT * FROM absen_log WHERE account_id=? ORDER BY absen_at DESC LIMIT 50').all(id),
  getRecent: () => db.prepare(`
    SELECT l.*,a.nama,a.npm FROM absen_log l
    JOIN accounts a ON a.id=l.account_id
    ORDER BY l.absen_at DESC LIMIT 100
  `).all(),
};

function buildSummaryLogItems(result) {
  const msg = String(result?.message || '').trim();
  if (!msg) return [];
  // Simpan ringkasan ketika tidak ada detail kelas, mis. "sudah absen sebelumnya".
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

// ── Bot ───────────────────────────────────────────────────────────────────────
const BASE_URL       = 'https://simkuliah.usk.ac.id';
const LOGIN_URL      = `${BASE_URL}/index.php/login`;
const ABSENSI_URL    = `${BASE_URL}/index.php/absensi`;
const KONFIRMASI_URL = `${BASE_URL}/index.php/absensi/konfirmasi_kehadiran`;
const runningJobs    = new Set();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
    if (up.length < 5 || up.length > 6) return false; // captcha umumnya 5-6 char
    return !bannedFragments.some((frag) => up.includes(frag));
  });
  if (!filtered.length) return '';
  // Prioritaskan token alfanumerik dengan panjang paling umum captcha (5-6).
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
      // Coba model berikutnya jika model tidak ditemukan/unsupported.
      if (!/not found|not supported|404/i.test(msg)) break;
    }
  }

  // Fallback OCR lokal (tanpa Gemini quota/key)
  try {
    const variants = [buf];

    // Preprocessing beberapa varian untuk meningkatkan akurasi OCR captcha.
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
        tessedit_pageseg_mode: 8, // single word
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
    if (!lastErr) lastErr = ocrErr;
  }

  throw lastErr || new Error('Gagal membaca captcha via Gemini dan OCR lokal.');
}

async function captureCaptchaBuffer(page) {
  // 1) Ambil langsung dari <img id="captcha-img"> (paling akurat)
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

  // 2) Fallback screenshot elemen captcha
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 20000 });
    let loggedIn = false;
    let invalidCaptchaCount = 0;

    let lastCaptchaProvider = 'unknown';
    for (let i = 1; i <= 3; i++) {
      await page.fill('input[placeholder="NIP/NPM"], input[name="username"], input[name="npm"]', npm);
      await page.fill('input[placeholder="Password"], input[name="password"]', password);

      // Baca captcha
      let captchaText = '';
      const captchaBuf = await captureCaptchaBuffer(page);
      if (captchaBuf) {
        try {
          const cap = await readCaptcha(captchaBuf);
          captchaText = cap.text;
          lastCaptchaProvider = cap.provider || lastCaptchaProvider;
        } catch {}
      }
      if (!captchaText) {
        try {
          const cap = await readCaptcha(await page.screenshot({ clip: { x:0, y:0, width:700, height:500 } }));
          captchaText = cap.text;
          lastCaptchaProvider = cap.provider || lastCaptchaProvider;
        } catch (e) {}
      }

      if (!captchaText) {
        console.log(`[Login attempt ${i}] captcha tidak terbaca valid, refresh & retry`);
        invalidCaptchaCount++;
        try { await page.click('.ti-reload, #refresh', { timeout: 2000 }); } catch { await page.reload({ waitUntil: 'networkidle' }); }
        await page.waitForTimeout(800);
        continue;
      }

      console.log(`[Login attempt ${i}] provider: ${lastCaptchaProvider}, captcha: "${captchaText}"`);
      await page.fill('input[placeholder="Masukkan kode verifikasi"], input[name="captcha"], input[id*="captcha"]', captchaText);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20000 }),
        page.click('button[type="submit"], button:has-text("Login")'),
      ]);

      if (!page.url().includes('login')) { loggedIn = true; break; }
      // Refresh captcha
      try { await page.click('.ti-reload, #refresh', { timeout: 2000 }); } catch { await page.reload({ waitUntil: 'networkidle' }); }
      await page.waitForTimeout(600);
    }

    if (!loggedIn) {
      const failMessage = invalidCaptchaCount >= 2
        ? 'Login gagal: CAPTCHA tidak terbaca valid. Coba lagi atau aktifkan Gemini API.'
        : 'Login gagal. Cek NPM/password.';
      return {
        success: false,
        message: failMessage,
        absen_list: [],
        captcha_provider: lastCaptchaProvider
      };
    }

    // Halaman absensi
    await page.goto(ABSENSI_URL, { waitUntil: 'networkidle', timeout: 20000 });

    // Ekstrak jadwal
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
      return {
        success: true,
        message: sudah > 0 ? 'Sudah terabsen semua.' : 'Belum masuk waktu absen / tidak ada jadwal aktif saat ini.',
        absen_list: [],
        outside_time: !sudah,
        captcha_provider: lastCaptchaProvider
      };
    }

    // Konfirmasi satu per satu
    const absen_list = [];
    for (const j of jadwalList) {
      try {
        let res;
        if (j.fallback) {
          // Klik + handle swal
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
          // AJAX langsung
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
        console.log(`[Absensi] ${res.status==='berhasil'?'✅':'❌'} ${j.namaKelas}`);
        absen_list.push(res);
      } catch(e) {
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
    return { success: false, message: `Error: ${e.message}`, absen_list: [], captcha_provider: 'unknown' };
  } finally {
    await browser.close();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/accounts
router.get('/accounts', (req, res) => {
  try { res.json({ success: true, data: Accounts.getAll() }); }
  catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/accounts
router.post('/accounts', (req, res) => {
  const { nama, npm, password } = req.body || {};
  if (!nama || !npm || !password)
    return res.status(400).json({ success: false, message: "nama, npm, password wajib diisi." });
  try {
    const acc = Accounts.create({ nama, npm, password });
    res.status(201).json({ success: true, data: acc });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'NPM sudah terdaftar.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/accounts/:id', (req, res) => {
  const deleted = Accounts.delete(Number(req.params.id));
  if (!deleted) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
  res.json({ success: true, message: 'Akun dihapus.' });
});

// GET /api/accounts/:id/log
router.get('/accounts/:id/log', (req, res) => {
  res.json({ success: true, data: AbsenLog.getByAccount(Number(req.params.id)) });
});

// POST /api/absen/all
router.post('/absen/all', async (req, res) => {
  const accounts = Accounts.getAll();
  if (!accounts.length) return res.status(404).json({ success: false, message: 'Belum ada akun.' });

  const jobs = accounts.map(async acc => {
    const result = await runAbsen({ npm: acc.npm, password: Accounts.getPassword(acc.id) });
    const items = result.absen_list?.length ? result.absen_list : buildSummaryLogItems(result);
    if (items.length) AbsenLog.insert(acc.id, items);
    return { account_id: acc.id, nama: acc.nama, npm: acc.npm, ...result };
  });

  const settled = await Promise.allSettled(jobs);
  const data    = settled.map(r => r.status === 'fulfilled' ? r.value : { success: false, message: r.reason?.message });
  res.json({ success: true, message: `${accounts.length} akun diproses.`, data });
});

// POST /api/absen/:id
router.post('/absen/:id', async (req, res) => {
  const id      = Number(req.params.id);
  const account = Accounts.getById(id);
  if (!account) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
  if (runningJobs.has(id)) return res.status(409).json({ success: false, message: 'Bot sedang berjalan untuk akun ini.' });

  runningJobs.add(id);
  try {
    const result = await runAbsen({ npm: account.npm, password: Accounts.getPassword(id) });
    const items = result.absen_list?.length ? result.absen_list : buildSummaryLogItems(result);
    if (items.length) AbsenLog.insert(id, items);
    res.json({ success: result.success, message: result.message, data: result.absen_list });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message, data: [] });
  } finally {
    runningJobs.delete(id);
  }
});

// GET /api/absen/log
router.get('/absen/log', (req, res) => {
  res.json({ success: true, data: AbsenLog.getRecent() });
});

module.exports = router;