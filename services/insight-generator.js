// services/insight-generator.js
// ─────────────────────────────────────────────────────────────────────────────
// Generator untuk menyusun teks narasi Executive Summary & Laporan Terformat
// ─────────────────────────────────────────────────────────────────────────────

const InsightGenerator = {
  /**
   * Menghasilkan teks Executive Summary secara otomatis berdasarkan tingkat risiko & isu
   */
  generateExecutiveSummary: (insights, riskAssessment) => {
    const { score, level, counts } = riskAssessment;

    if (score === 0) {
      return "Sistem absensi otomatis Anda berada dalam kondisi prima (100% stabil). " +
             "Seluruh akun mahasiswa aktif terproses dengan sukses tanpa adanya kegagalan atau hambatan CAPTCHA. " +
             "Jadwal scheduler beroperasi secara efisien tanpa penumpukan memori.";
    }

    let summary = `Berdasarkan analisis otomatis terbaru, sistem memiliki skor indeks risiko **${score}/100** dengan status **${level}**. `;
    summary += `Ditemukan total **${insights.length} isu** aktif, yang terdiri dari: `;
    
    const parts = [];
    if (counts.critical > 0) parts.push(`**${counts.critical} Kritis** (Critical)`);
    if (counts.high > 0) parts.push(`**${counts.high} Tinggi** (High)`);
    if (counts.medium > 0) parts.push(`**${counts.medium} Sedang** (Medium)`);
    if (counts.low > 0) parts.push(`**${counts.low} Rendah** (Low)`);
    
    summary += parts.join(', ') + '. ';

    // Tambahkan rekomendasi tindakan utama
    const criticalIssues = insights.filter(i => i.severity === 'CRITICAL');
    const highIssues = insights.filter(i => i.severity === 'HIGH');

    if (criticalIssues.length > 0) {
      summary += `\n\n**Tindakan Mendesak (Action Required):** Hubungkan kembali kredensial akun mahasiswa yang mengalami kegagalan beruntun agar jadwal absensinya tidak tertunda terus-menerus.`;
    } else if (highIssues.length > 0) {
      summary += `\n\n**Rekomendasi Utama:** Optimalisasi pembagian jam scheduler untuk mengurangi beban concurrency memori, atau verifikasi status koneksi browser Chromium.`;
    } else {
      summary += `\n\nSistem berada pada tingkat kestabilan yang baik. Hambatan didominasi oleh penundaan jadwal normal (skip hari libur kalender akademik).`;
    }

    return summary;
  },

  /**
   * Menghasilkan berkas Markdown Laporan AI Insights (Daily, Weekly, Monthly)
   */
  generateReport: (period, insights, riskAssessment) => {
    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const periodTitles = {
      daily: 'LAPORAN ANALISIS HARIAN (DAILY AI INSIGHTS)',
      weekly: 'LAPORAN ANALISIS MINGGUAN (WEEKLY AI INSIGHTS)',
      monthly: 'LAPORAN ANALISIS BULANAN (MONTHLY AI INSIGHTS)'
    };
    
    const title = periodTitles[period.toLowerCase()] || 'LAPORAN INSIGHTS SISTEM ABSENSI';
    const execSummary = InsightGenerator.generateExecutiveSummary(insights, riskAssessment);

    let doc = `# ${title}\n`;
    doc += `*Dibuat otomatis oleh AI Recommendation Engine pada: ${nowStr} WIB*\n\n`;
    
    doc += `## 1. Ringkasan Eksekutif (Executive Summary)\n`;
    doc += `${execSummary}\n\n`;

    doc += `## 2. Penilaian Risiko Sistem (System Risk Assessment)\n`;
    doc += `| Parameter | Nilai Status / Statistik |\n`;
    doc += `| --- | --- |\n`;
    doc += `| **Indeks Risiko** | **${riskAssessment.score} / 100** |\n`;
    doc += `| **Tingkat Bahaya** | ${riskAssessment.level} |\n`;
    doc += `| **Deskripsi Kondisi** | ${riskAssessment.description} |\n`;
    doc += `| **Isu Kritis (CRITICAL)** | ${riskAssessment.counts.critical} Masalah |\n`;
    doc += `| **Isu Tinggi (HIGH)** | ${riskAssessment.counts.high} Masalah |\n`;
    doc += `| **Isu Sedang (MEDIUM)** | ${riskAssessment.counts.medium} Masalah |\n`;
    doc += `| **Isu Rendah (LOW)** | ${riskAssessment.counts.low} Masalah |\n|\n\n`;

    doc += `## 3. Daftar Temuan Utama & Rekomendasi Tindakan\n`;
    
    if (insights.length === 0) {
      doc += `*Tidak ditemukan masalah atau anomali pada sistem absensi dalam rentang evaluasi laporan ini.*\n\n`;
    } else {
      // Urutkan berdasarkan keparahan (CRITICAL -> HIGH -> MEDIUM -> LOW)
      const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
      const sortedInsights = [...insights].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      sortedInsights.forEach((item, index) => {
        let badge = `[${item.severity}]`;
        if (item.severity === 'CRITICAL') badge = `🚨 **CRITICAL**`;
        if (item.severity === 'HIGH') badge = `⚠️ **HIGH**`;
        if (item.severity === 'MEDIUM') badge = `⚡ **MEDIUM**`;
        if (item.severity === 'LOW') badge = `ℹ️ **LOW**`;

        doc += `### 3.${index + 1}. ${item.title} (${badge})\n`;
        doc += `* **Kategori:** ${item.category.toUpperCase()}\n`;
        doc += `* **Deskripsi:** ${item.message}\n`;
        doc += `* **Alasan & Bukti:** ${item.reason}\n`;
        doc += `* **Rekomendasi Solusi:** *${item.recommendation}*\n\n`;
      });
    }

    doc += `---\n`;
    doc += `*ZieeBot Absensi-Module  |  Dashboard AI System Copilot Report  |  Sifat: Rahasia/Admin Only*\n`;

    return doc;
  }
};

module.exports = InsightGenerator;
