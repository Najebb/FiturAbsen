# 📋 Panduan Integrasi Absen Bot ke ZieeBot

## File yang perlu dimodifikasi di repo ZieeBot kamu:

---

## 1️⃣ index.js (server utama)

Tambahkan 2 baris ini:

```js
// === TAMBAHKAN DI BAGIAN REQUIRE (atas) ===
const absenProxy = require('./routes/absen-proxy');

// === TAMBAHKAN SETELAH app.use(express.json()) ===
app.use('/api', absenProxy);
```

---

## 2️⃣ index.html

### A) Tambah tab button — cari baris ini:
```html
<button class="tab-btn" onclick="switchTab('tambah')">➕ TAMBAH DATA</button>
```
Tambahkan **SETELAH** baris tersebut:
```html
<button class="tab-btn" onclick="switchTab('absen')">🎯 ABSEN SIMKULIAH</button>
```

### B) Tambah panel tab — cari penutup tab-tambah:
```html
</div>
<!-- cari bagian akhir tab-panel tambah, lalu tempel isi PATCH_index.html di sini -->
```
Salin seluruh isi file `dashboard/PATCH_index.html` dan tempel setelah `</div>` penutup dari `id="tab-tambah"`.

### C) Tambah script — sebelum `</body>`:
```html
<script src="absen-script.js"></script>
```

---

## 3️⃣ style.css

Salin seluruh isi file `dashboard/absen-style.css` dan tempel di **AKHIR** file `style.css`.

---

## 4️⃣ package.json — tambah dependencies

```json
"better-sqlite3": "^9.4.3",
"playwright": "^1.44.0",
"@anthropic-ai/sdk": "^0.30.0"
```

Lalu jalankan:
```bash
npm install
npx playwright install chromium
```

---

## 5️⃣ .env — tambah variable

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxx
ENCRYPTION_KEY=32-karakter-acak-rahasia-kamu!!
```

---

## ✅ Struktur file akhir ZieeBot

```
ZieeBot/
├── routes/
│   ├── absen-proxy.js   ← FILE BARU (copy dari sini)
│   └── ...file lama...
├── data/
│   └── absen.db         ← auto dibuat
├── index.html           ← ditambah tab absen
├── script.js            ← ditambah kode absen-script.js
├── style.css            ← ditambah absen-style.css
├── index.js             ← ditambah require absen-proxy
└── ...
```

---

## 🔄 Cara Test

1. Jalankan server: `npm start`
2. Buka dashboard di browser
3. Klik tab **🎯 ABSEN SIMKULIAH**
4. Tambah akun dengan NPM + password SIMKULIAH
5. Klik **⚡ ABSEN** untuk test satu akun
