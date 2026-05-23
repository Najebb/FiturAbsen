# 🎯 Absensi SIMKULIAH — Module

Modul absensi otomatis untuk SIMKULIAH USK, dipisahkan dari project utama ZieeBot.

## Fitur

- ✅ **Login otomatis** ke SIMKULIAH via Playwright (headless browser)
- ✅ **OCR Captcha** — Gemini AI (utama) + Tesseract.js (fallback lokal)
- ✅ **Multi-akun** — CRUD akun dengan enkripsi AES-256
- ✅ **Absen batch** — Satu klik absen semua akun
- ✅ **Log riwayat** — Semua hasil absen tersimpan di SQLite
- ✅ **Dashboard UI** — Panel frontend siap pakai (HTML/CSS/JS)

## Struktur Folder

```
Absensi-Module/
├── index.js              ← Entry point module
├── package.json          ← Dependencies terpisah
├── README.md             ← Dokumentasi (file ini)
│
├── routes/
│   └── absen-proxy.js    ← Backend: Express router + bot Playwright
│
├── frontend/
│   ├── absen-tab.html    ← HTML panel tab absensi
│   ├── absen-script.js   ← Frontend JavaScript (489 baris)
│   └── absen-style.css   ← CSS khusus komponen absensi
│
├── data/
│   └── absen.db          ← (auto-created) Database SQLite
│
└── docs/
    └── PANDUAN_INTEGRASI.md ← Panduan integrasi ke project lain
```

## Cara Integrasi ke Project Express

### 1. Install dependencies

```bash
cd Absensi-Module
npm install
```

### 2. Require di server utama

```js
const absensi = require('../Absensi-Module');  // sesuaikan path

// Mount API routes
app.use('/api', absensi.router);

// (Opsional) Serve frontend assets
const express = require('express');
app.use('/absen-assets', express.static(absensi.frontendDir));
```

### 3. Environment Variables

Tambahkan di `.env` project utama:

```env
GEMINI_API_KEY=your-gemini-api-key      # Untuk OCR captcha (utama)
ENCRYPTION_KEY=32-karakter-rahasia!!     # Untuk enkripsi password akun
```

### 4. Frontend

Muat file frontend di HTML:

```html
<!-- CSS -->
<link rel="stylesheet" href="/absen-assets/absen-style.css">

<!-- HTML tab (bisa di-include atau copy isi absen-tab.html) -->

<!-- JS -->
<script src="/absen-assets/absen-script.js"></script>
```

## API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/accounts` | Daftar semua akun |
| `POST` | `/api/accounts` | Tambah akun baru (`{nama, npm, password}`) |
| `DELETE` | `/api/accounts/:id` | Hapus akun |
| `GET` | `/api/accounts/:id/log` | Log absen per akun |
| `POST` | `/api/absen/:id` | Absen satu akun |
| `POST` | `/api/absen/all` | Absen semua akun |
| `GET` | `/api/absen/log` | Log absen terbaru (100 record) |

## Asal File

Module ini diekstrak dari project **ZieeBot (Jebb Bot)** v1.8. File asli:

| File Module | Asal |
|-------------|------|
| `routes/absen-proxy.js` | `Jebb Bot/routes/absen-proxy.js` (copy langsung) |
| `frontend/absen-style.css` | `Jebb Bot/absen-style.css` (copy langsung) |
| `frontend/absen-tab.html` | `Jebb Bot/PATCH_index.html` (copy langsung) |
| `frontend/absen-script.js` | `Jebb Bot/script.js` L1622-2110 (extracted) |
| `docs/PANDUAN_INTEGRASI.md` | `Jebb Bot/PANDUAN_INTEGRASI.md` (copy langsung) |
