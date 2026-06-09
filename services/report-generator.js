// services/report-generator.js
// ─────────────────────────────────────────────────────────────────────────────
// Modul pembuatan laporan terformat (CSV, Excel BOM, PDF)
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');

const ReportGenerator = {
  /**
   * Menghasilkan berkas CSV standar (juga kompatibel dengan Excel jika ditambahkan BOM)
   */
  generateCSV: (headers, rows) => {
    // Unicode BOM untuk kompatibilitas Excel
    let csvContent = '\uFEFF';
    
    // Tulis header
    csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';
    
    // Tulis baris data
    rows.forEach(row => {
      csvContent += row.map(cell => {
        const strCell = cell !== null && cell !== undefined ? String(cell) : '';
        return `"${strCell.replace(/"/g, '""')}"`;
      }).join(',') + '\n';
    });

    return Buffer.from(csvContent, 'utf8');
  },

  /**
   * Menghasilkan berkas PDF Laporan Analitik Sistem Absensi
   */
  generatePDF: async (overview, failures, trends, days, recentLogs) => {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 50,
          info: {
            Title: 'Laporan Analisis Performa Absensi SIMKULIAH',
            Author: 'ZieeBot Absensi-Module',
            Subject: 'System Analytics'
          }
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- STYLING & PALETTE ---
        const primaryColor = '#111827';
        const secondaryColor = '#4B5563';
        const accentColor = '#0284C7';
        const dangerColor = '#DC2626';
        const warningColor = '#D97706';
        const successColor = '#16A34A';
        const lightBg = '#F3F4F6';
        const borderLight = '#E5E7EB';

        // --- TITLE HEADER ---
        doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('LAPORAN ANALISIS PERFORMA ABSENSI', { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor(secondaryColor).text(`Modul Absensi Otomatis SIMKULIAH  |  Rentang Analisis: Last ${days} Hari`, { align: 'center' });
        doc.text(`Waktu Cetak Laporan: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
        doc.moveDown(1.5);

        // Draw horizontal line
        doc.strokeColor(accentColor).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1.5);

        // --- METRICS OVERVIEW CARD GRID (2x2) ---
        const startY = doc.y;
        
        // Card Left: Total & Success Rate
        doc.fillColor(lightBg).rect(50, startY, 235, 80).fill();
        doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('Performa Eksekusi', 60, startY + 10);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Total Eksekusi:', 60, startY + 30);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text(`${overview.totalExecutions} Kali`, 150, startY + 30);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Success Rate:', 60, startY + 45);
        doc.fontSize(11).font('Helvetica-Bold').fillColor(successColor).text(`${overview.successRate}%`, 150, startY + 45);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Retry Rate:', 60, startY + 60);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(accentColor).text(`${overview.retryCount} Retries`, 150, startY + 60);

        // Card Right: Status Breakdown
        doc.fillColor(lightBg).rect(310, startY, 235, 80).fill();
        doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text('Rincian Status', 320, startY + 10);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Berhasil:', 320, startY + 30);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(successColor).text(`${overview.successCount} Eksekusi`, 420, startY + 30);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Gagal / Error:', 320, startY + 45);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(dangerColor).text(`${overview.failedCount} Eksekusi`, 420, startY + 45);
        doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Dilewati (Skipped):', 320, startY + 60);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(warningColor).text(`${overview.skippedCount} Eksekusi`, 420, startY + 60);

        doc.y = startY + 95;

        // --- EARLY WARNING SYSTEM SECTION ---
        if (overview.alerts && overview.alerts.length > 0) {
          doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('Sistem Peringatan Dini (Early Warnings)', 50, doc.y);
          doc.moveDown(0.5);
          
          overview.alerts.forEach(alert => {
            const boxColor = alert.type === 'danger' ? dangerColor : warningColor;
            
            // Draw warning box
            doc.strokeColor(boxColor).lineWidth(1).rect(50, doc.y, 495, 36).stroke();
            doc.fillColor(boxColor).fontSize(9).font('Helvetica-Bold').text(alert.title, 60, doc.y + 6);
            doc.fillColor(primaryColor).fontSize(8).font('Helvetica').text(alert.message, 60, doc.y + 18, { width: 475 });
            doc.moveDown(2.5);
          });
          doc.moveDown(0.5);
        }

        // --- FAILURE REASONS TABLE ---
        doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('Kategori Penyebab Kegagalan', 50, doc.y);
        doc.moveDown(0.5);
        
        let tableY = doc.y;
        doc.fillColor(lightBg).rect(50, tableY, 495, 18).fill();
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Kategori Alasan', 60, tableY + 5);
        doc.text('Jumlah Kasus', 450, tableY + 5, { align: 'right', width: 80 });
        
        tableY += 18;
        if (failures.failureReasons.length === 0) {
          doc.fillColor(secondaryColor).fontSize(8).font('Helvetica').text('Tidak ditemukan catatan kegagalan sistem dalam rentang ini.', 60, tableY + 5);
          tableY += 18;
        } else {
          failures.failureReasons.forEach(reason => {
            doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, tableY).lineTo(545, tableY).stroke();
            doc.fillColor(primaryColor).fontSize(8).font('Helvetica').text(reason.reason, 60, tableY + 5);
            doc.fillColor(dangerColor).fontSize(8).font('Helvetica-Bold').text(`${reason.count} Kasus`, 450, tableY + 5, { align: 'right', width: 80 });
            tableY += 18;
          });
        }

        doc.y = tableY + 15;

        // Page break if near bottom
        if (doc.y > 600) {
          doc.addPage();
        }

        // --- TOP FAILED ACCOUNTS ---
        doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('Akun dengan Frekuensi Gagal Tertinggi', 50, doc.y);
        doc.moveDown(0.5);

        tableY = doc.y;
        doc.fillColor(lightBg).rect(50, tableY, 495, 18).fill();
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Nama Mahasiswa', 60, tableY + 5);
        doc.text('NPM', 220, tableY + 5);
        doc.text('Kegagalan', 340, tableY + 5);
        doc.text('Alasan Terakhir', 400, tableY + 5);

        tableY += 18;
        if (failures.topFailedAccounts.length === 0) {
          doc.fillColor(secondaryColor).fontSize(8).font('Helvetica').text('Seluruh akun berjalan sukses tanpa kendala.', 60, tableY + 5);
          tableY += 18;
        } else {
          failures.topFailedAccounts.forEach(acc => {
            doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, tableY).lineTo(545, tableY).stroke();
            doc.fillColor(primaryColor).fontSize(8).font('Helvetica').text(acc.nama, 60, tableY + 5, { width: 150 });
            doc.fillColor(secondaryColor).text(acc.npm, 220, tableY + 5);
            doc.fillColor(dangerColor).font('Helvetica-Bold').text(`${acc.failureCount} Kali`, 340, tableY + 5);
            doc.fillColor(primaryColor).font('Helvetica').text(acc.lastFailureReason || '-', 400, tableY + 5, { width: 140, height: 12, ellipsis: true });
            tableY += 18;
          });
        }

        doc.y = tableY + 15;

        // Page break if near bottom
        if (doc.y > 600) {
          doc.addPage();
        }

        // --- RECENT EXECUTION LOGS ---
        doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('Log Aktivitas Terbaru', 50, doc.y);
        doc.moveDown(0.5);

        tableY = doc.y;
        doc.fillColor(lightBg).rect(50, tableY, 495, 18).fill();
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Waktu (WIB)', 60, tableY + 5);
        doc.text('Nama / NPM', 160, tableY + 5);
        doc.text('Kelas Kuliah', 300, tableY + 5);
        doc.text('Status', 440, tableY + 5);

        recentLogs.slice(0, 12).forEach(log => {
          if (tableY > 740) {
            doc.addPage();
            tableY = 50;
            doc.fillColor(lightBg).rect(50, tableY, 495, 18).fill();
            doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Waktu (WIB)', 60, tableY + 5);
            doc.text('Nama / NPM', 160, tableY + 5);
            doc.text('Kelas Kuliah', 300, tableY + 5);
            doc.text('Status', 440, tableY + 5);
            tableY += 18;
          }

          doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, tableY).lineTo(545, tableY).stroke();
          
          const statusStr = String(log.status || 'UNKNOWN').toLowerCase();
          let statColor = successColor;
          if (statusStr === 'gagal' || statusStr === 'error') statColor = dangerColor;
          if (statusStr === 'skipped') statColor = warningColor;

          doc.fillColor(secondaryColor).fontSize(8).font('Helvetica').text(log.absen_at || '-', 60, tableY + 5);
          doc.fillColor(primaryColor).text(`${log.nama || 'Sistem'} (${log.npm || '-'})`, 160, tableY + 5, { width: 130, height: 12, ellipsis: true });
          doc.text(log.kelas || 'Massal', 300, tableY + 5, { width: 130, height: 12, ellipsis: true });
          doc.fillColor(statColor).font('Helvetica-Bold').text(statusStr.toUpperCase(), 440, tableY + 5);
          
          tableY += 18;
        });

        // --- FOOTER ON ALL PAGES ---
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
          doc.switchToPage(i);
          doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, 780).lineTo(545, 780).stroke();
          doc.fillColor(secondaryColor).fontSize(7).font('Helvetica')
            .text('ZieeBot SIMKULIAH Absensi-Module  |  Dashboard Analytics Engine Report  |  Rahasia & Internal', 50, 787);
          doc.text(`Halaman ${i + 1} dari ${pageCount}`, 450, 787, { align: 'right', width: 95 });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
};

module.exports = ReportGenerator;
