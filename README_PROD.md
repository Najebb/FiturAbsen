# Panduan Operasional Produksi & Deployment (VPS) 🚀
**Absensi-Module — Highly Observable Automation Server**

Dokumen ini adalah panduan lengkap untuk melakukan *deployment*, administrasi, dan pemeliharaan server otomatisasi absensi `Absensi-Module` di lingkungan produksi VPS Linux/Ubuntu 24/7.

---

## 📋 1. Persiapan Infrastruktur & Portabilitas

Aplikasi ini dapat dijalankan menggunakan **dua metode produksi** yang telah teruji:

### Metode A: Menggunakan Docker & Docker Compose (Sangat Direkomendasikan)
Metode ini paling portabel karena seluruh dependensi (termasuk Chromium Browser dan pustaka pendukung OS untuk Playwright) sudah dibungkus rapi di dalam container.

**Persyaratan:** Docker & Docker Compose terinstal di VPS.

1.  **Salin Berkas Proyek**: Pindahkan seluruh isi folder `Absensi-Module` ke VPS Anda (misal ke direktori `/app/absensi`).
2.  **Konfigurasi Environment**:
    *   Duplikat berkas `.env.production` menjadi `.env`:
        ```bash
        cp .env.production .env
        ```
    *   Edit berkas `.env` menggunakan teks editor (misal `nano .env`) dan isi variabel sensitif (seperti `SECRET_KEY`, `GEMINI_API_KEY`, `DISCORD_WEBHOOK_URL`, dan akun WhatsApp).
3.  **Jalankan Container**:
    ```bash
    docker compose up -d --build
    ```
4.  **Periksa Status Uptime & Kesehatan**:
    ```bash
    docker compose ps
    ```
    *(Container otomatis memantau kesehatan internalnya melalui skrip `scripts/healthcheck.js` setiap 30 detik)*.
5.  **Membaca Log Server**:
    ```bash
    docker compose logs -f
    ```

---

### Metode B: Menggunakan PM2 Ecosystem Manager (Runtime Lokal)
Metode ini berjalan langsung pada mesin OS VPS Anda dengan NodeJS.

**Persyaratan:** Node.js (v18 ke atas), PM2 (`npm install -g pm2`), dan Playwright Browser terinstal di VPS.

1.  **Instalasi Dependensi**:
    ```bash
    npm ci --only=production
    npx playwright install --with-deps chromium
    ```
2.  **Konfigurasi Environment**:
    ```bash
    cp .env.production .env
    # Edit berkas .env Anda sesuai kebutuhan produksi
    ```
3.  **Jalankan Layanan via PM2**:
    ```bash
    pm2 start ecosystem.config.js
    ```
4.  **Operasional Perintah PM2 Penting**:
    *   Melihat log aktif: `pm2 logs absensi-server`
    *   Melihat statistik RAM/CPU: `pm2 monit`
    *   Menghentikan server: `pm2 stop absensi-server`
    *   Menghidupkan ulang server: `pm2 restart absensi-server`

---

## 🔒 2. Konfigurasi Saluran Notifikasi Produksi

Agar Anda mendapatkan info status absensi secara instan di HP, konfigurasikan saluran notifikasi di `.env`:

### A. Discord Webhook
*   Buka Discord -> **Edit Channel** -> **Integrations** -> **Webhooks** -> **Create Webhook** -> **Copy Webhook URL**.
*   Tempel ke berkas `.env`:
    ```env
    DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook_id/your_webhook_token
    ```

### B. WhatsApp Gateway (Fonnte / Layanan SaaS Cloud)
*   Daftar di penyedia layanan gateway WhatsApp (seperti `fonnte.com`).
*   Scan QR Code WhatsApp Anda di panel dashboard mereka.
*   Ambil **API Token** dan isi di berkas `.env`:
    ```env
    WHATSAPP_API_URL=https://api.fonnte.com/send
    WHATSAPP_TOKEN=isi_token_fonnte_anda
    WHATSAPP_NUMBER=628123456789 # Nomor HP Anda untuk menerima notifikasi
    ```

---

## 💾 3. Panduan Pemulihan & Backup Database SQLite

Database disimpan di folder `data/absen.db`. Sistem backup internal kita otomatis mencadangkan database dan menyimpan **10 salinan cadangan terakhir** di `data/backups/`.

### Pembuatan Backup Manual
*   **Via Dashboard**: Masuk ke tab **System Tools** -> Klik tombol **"Buat Backup Instan"**.
*   **Via API Endpoint**: Kirim request POST ke `/api/backups` dengan menyertakan token auth.

### Melakukan Restore (Pemulihan Data)
*   **Via Dashboard (Rekomendasi)**: Masuk ke tab **System Tools** -> Cari nama file backup pada tabel -> Klik tombol **"Restore"**. Sistem akan otomatis menghentikan koneksi database, menimpa dengan file backup, dan menghubungkannya kembali secara aman tanpa perlu me-restart server!

---

## 🛠️ 4. Penanganan Masalah (Troubleshooting)

### Deteksi Database Terkunci (SQLITE_BUSY)
Jika proses crash tidak wajar terjadi, database SQLite dapat mengalami write-lock oleh proses zombie.
1.  Jalankan skrip detektor untuk menganalisis:
    ```bash
    node scripts/db-lock-detector.js
    ```
2.  Jika terbukti terkunci, bunuh seluruh proses node zombie:
    *   **Windows**: `taskkill /F /IM node.exe`
    *   **Linux**: `killall -9 node`
3.  Hidupkan ulang aplikasi kembali.

### Pengujian Beban RAM & Kebocoran Memori (Stress-Test)
Guna memastikan VPS RAM 1GB Anda tidak kehabisan memori saat melayani banyak jadwal sekaligus, Anda dapat mensimulasikan beban puncak secara lokal:
```bash
node --expose-gc scripts/stress-test.js
```
*(Skrip ini akan memicu alokasi 500 jadwal di memori, mensimulasikan 200 transaksi beruntun, dan memicu pembersihan sampah memori NodeJS untuk mendeteksi adanya memori bocor).*

---

## 🛡️ 5. Konfigurasi Keamanan Nginx (Reverse Proxy)

Jika Anda ingin mengakses dashboard menggunakan domain ber-HTTPS (misal `https://absen.domainanda.com`), salin templat konfigurasi di `nginx/absensi.conf` ke folder konfigurasi Nginx Anda (`/etc/nginx/sites-available/`).

Perintah umum untuk mengaktifkan konfigurasi di Ubuntu:
```bash
sudo ln -s /etc/nginx/sites-available/absensi.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
Gunakan **Certbot Let's Encrypt** untuk mendapatkan sertifikat SSL gratis secara otomatis:
```bash
sudo certbot --nginx -d absen.domainanda.com
```
