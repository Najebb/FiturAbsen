# 🎯 Absensi SIMKULIAH — Enterprise Automator & Analytics Module

Modul absensi otomatis untuk SIMKULIAH USK, dilengkapi dengan AI Insights, Analytics & Reporting, Smart Scheduling, serta Multi-User Security Governance (RBAC, Active Sessions, & Audit Trail).

---

## 🚀 Fitur Utama

### 1. Core Automation & Intelligent OCR
* **Login Otomatis:** Otomatisasi browser berbasis **Playwright (Chromium)** untuk melakukan pengisian absen kelas perkuliahan.
* **Intelligent Captcha OCR:** Penyelesaian captcha dinamis menggunakan **Gemini AI** sebagai mesin utama dan **Tesseract.js** sebagai fallback offline lokal.
* **Multi-Akun Enkripsi:** Penyimpanan data akun mahasiswa aman terenkripsi dengan algoritma **AES-256-GCM**.

### 2. Multi-User Security Governance & RBAC
Mengubah sistem dari single-admin menjadi platform multi-user yang aman dan siap digunakan bersama.
* **Role-Based Access Control (RBAC):** Hak akses ketat berdasarkan peran pengguna:
  * `SUPER_ADMIN`: Akses penuh sistem (termasuk manajemen user administrasi).
  * `ADMIN`: Mengelola akun mahasiswa, penjadwalan, kalender, log audit, analytics, dan AI insights.
  * `OPERATOR`: Menjalankan bot absen, melihat jadwal, dan kalender (read-only).
  * `STUDENT`: Akses terbatas mandiri untuk melihat data & jadwal milik NPM yang bersangkutan saja.
* **Session Management:** Manajemen sesi berbasis database SQLite dengan waktu kedaluwarsa tetap (24 jam) dan deteksi inaktivitas (30 menit). Administrator dapat melihat dan mencabut (*revoke*) sesi aktif kapan saja.
* **Audit Trail Logs:** Pencatatan real-time untuk setiap aktivitas administratif penting (Siapa, Melakukan Apa, Pada Modul Apa, dari IP Address Mana).
* **Brute-force Protection:** Lockout otomatis selama 15 menit jika pengguna gagal login 5 kali berturut-turut.

### 3. AI Insights & recommendations
* **Gemini Recommendations:** Menganalisis log absensi secara cerdas untuk memberikan saran operasional seperti penyesuaian jam scheduler untuk menghindari load tinggi, deteksi dini kegagalan berulang, dan analisis performa sistem.
* **Warning System:** Peringatan otomatis apabila tingkat keberhasilan absensi berada di bawah ambang batas aman.

### 4. Analytics & Reporting Dashboard
* **Tren Performa:** Grafik interaktif berbasis **Chart.js** untuk melihat rasio keberhasilan absensi dalam rentang 7 hari, 30 hari, dan semester.
* **Failure Analysis:** Deteksi dini akun bermasalah, alasan kegagalan terbanyak (*failure reasons*), dan distribusi percobaan ulang (*retry*).
* **Report Exporter:** Cetak dan unduh laporan absensi secara instan dalam format **PDF**, **Excel (CSV)**, dan **CSV**.

### 5. Smart Scheduling & Academic Calendar
* **Academic Calendar:** Penjadwalan cerdas terintegrasi kalender akademik nasional/universitas untuk otomatis melompati hari libur nasional atau perkuliahan yang ditiadakan.
* **Jadwal Pintar:** Konfigurasi penjadwalan dinamis per-hari dan slot jam berdasarkan kelas mahasiswa.

---

## 📂 Struktur Folder Terbaru

```
Absensi-Module/
├── index.js              ← Entry point module & server routing
├── package.json          ← Dependensi npm
├── README.md             ← Dokumentasi (file ini)
│
├── config/
│   └── config.js         ← Konfigurasi & Environment variables
│
├── services/
│   ├── user-service.js   ← Kriptografi user, hashing PBKDF2 & lockout
│   ├── rbac-service.js   ← Matriks izin akses dan route middleware
│   ├── session-service.js← Sesi aktif (pembuatan, kedaluwarsa, revoking)
│   ├── audit-service.js  ← Log aktivitas keamanan (Audit Trail)
│   ├── analytics-service.js ← Agregasi statistik & metrik absensi
│   ├── metrics-engine.js ← Mesin kalkulasi rata-rata performa & tren
│   ├── report-generator.js ← Ekspor laporan PDF/Excel/CSV
│   ├── ai-insights-service.js ← Service penghubung analitik ke Gemini AI
│   └── calendar.js       ← Service kalender akademik & hari libur
│
├── routes/
│   └── absen-proxy.js    ← Backend API, Playwright scheduler & database schema
│
├── scheduler/
│   └── manager.js        ← Cron scheduler & retry manager untuk bot
│
├── dashboard/            ← Frontend UI (Single Page Application)
│   ├── index.html        ← HTML dashboard dengan modal popup
│   ├── app.js            ← Client-side SPA routing & API controller
│   └── style.css         ← Tema visual dark-mode & sidebar scrollable
│
└── data/
    └── absen.db          ← Database SQLite (auto-created)
```

---

## 🛠️ Cara Menjalankan & Integrasi

### 1. Instalasi Dependensi
Jalankan perintah berikut di folder modul untuk memasang dependensi beserta binary browser Chromium Playwright:
```bash
cd Absensi-Module
npm install
```

### 2. Konfigurasi Environment (`.env`)
Salin file konfigurasi lingkungan atau tambahkan variabel berikut di file `.env` Anda:
```env
PORT=3001
NODE_ENV=development

# --- Kriptografi & Keamanan ---
SECRET_KEY=masukkan-32-karakter-kunci-enkripsi-anda # Kunci enkripsi AES-256
SESSION_SECRET=kunci-rahasia-tanda-tangan-token      # Kunci token session JWT

# --- Kredensial Default SUPER_ADMIN ---
ABSEN_DASHBOARD_USER=admin
ABSEN_DASHBOARD_PASS=najebb22

# --- Database & OCR ---
DB_PATH=data/absen.db
GEMINI_API_KEY=AIzaSyA...                          # Diperlukan untuk Captcha OCR & AI Insights

# --- Playwright (Ubah true untuk headless di production) ---
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_TIMEOUT=30000
```

### 3. Menjalankan Server secara Standalone
Untuk menjalankan modul absensi beserta dashboard bawaannya secara mandiri:
```bash
npm start
```
Akses dashboard visual melalui browser pada alamat: **`http://localhost:3001`**

---

## 🌐 API Endpoints Terbaru

Semua endpoint dilindungi oleh sistem otentikasi sesi (`requireAuth`) dan diperiksa menggunakan middleware RBAC (`requirePermission`).

### Otentikasi & Profil (Publik / Session Required)
* `POST /api/auth/login` - Masuk dan dapatkan token sesi.
* `POST /api/auth/logout` - Keluar dan hapus sesi aktif.
* `GET /api/auth/me` - Ambil profil sesi pengguna saat ini.
* `POST /api/auth/change-password` - Ubah password pribadi (Self-Service).

### User Management (Hanya `SUPER_ADMIN`)
* `GET /api/users` - Mengambil daftar seluruh pengguna sistem.
* `POST /api/users` - Membuat user administrasi baru.
* `PUT /api/users/:id` - Memperbarui peran/detail user.
* `DELETE /api/users/:id` - Menghapus user dari database.
* `POST /api/users/:id/reset-password` - Reset paksa password user oleh admin.

### Session & Audit (Hanya `SUPER_ADMIN` & `ADMIN`)
* `GET /api/sessions` - Melihat semua sesi aktif yang sedang terhubung ke sistem.
* `DELETE /api/sessions/:token` - Mencabut paksa sesi (*kick*) berdasarkan token sesi.
* `GET /api/audit-logs` - Mengambil daftar catatan aktivitas keamanan (*Audit Trail*).

### Kalender Akademik & Penjadwalan (Staf ke Atas)
* `GET /api/calendar` - Mengambil hari libur dan konfigurasi kalender.
* `POST /api/calendar` - Menyimpan pembaruan kalender akademik.
* `GET /api/scheduler/configs` - Mengambil jadwal cron bot aktif.
* `POST /api/scheduler/configs` - Membuat/mengubah jadwal absen bot baru.
* `DELETE /api/scheduler/configs/:id` - Menghapus penjadwalan.

### Analytics, AI Insights, & Laporan
* `GET /api/analytics/overview` - Metrik ringkasan performa absensi.
* `GET /api/analytics/trends` - Tren tingkat sukses absensi (parameter `days`).
* `GET /api/analytics/failures` - Distribusi kegagalan dan top failed accounts.
* `GET /api/analytics/report/:format` - Ekspor laporan absensi (format: `pdf`, `excel`, `csv`).
* `GET /api/ai-insights/overview` - Mengambil analisis insight Gemini AI terbaru dari sistem.
* `POST /api/ai-insights/refresh` - Memicu pembaruan kalkulasi AI Insights secara manual.
