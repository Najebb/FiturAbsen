const logger = require('../utils/logger');

// Load environment variables dynamically in case they change
const getEnvConfig = () => {
  return {
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    whatsappUrl: process.env.WHATSAPP_API_URL || '',
    whatsappToken: process.env.WHATSAPP_TOKEN || '',
    whatsappNumber: process.env.WHATSAPP_NUMBER || ''
  };
};

const NotificationService = {
  /**
   * Mengirim payload ke semua channel notifikasi aktif (Discord, Telegram, WhatsApp)
   */
  send: async ({ title, text, type = 'info', discordEmbed = null }) => {
    const config = getEnvConfig();
    const promises = [];

    logger.info(`[Notification Service] Mengirim notifikasi: "${title} - ${text}"`);

    // 1. Discord Webhook
    if (config.discordWebhook) {
      const colorMap = {
        success: 3066993, // Hijau
        warning: 15105570, // Oranye/Kuning
        danger: 15158332, // Merah
        info: 3447003 // Biru
      };

      const embed = discordEmbed || {
        title: title,
        description: text,
        color: colorMap[type] || colorMap.info,
        timestamp: new Date().toISOString(),
        footer: { text: 'SIMKULIAH Auto Attendance System' }
      };

      promises.push(
        fetch(config.discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] })
        }).catch(err => {
          logger.error('[Notification Service] Gagal mengirim ke Discord Webhook:', err.message || err);
        })
      );
    }

    // 2. Telegram Bot API
    if (config.telegramToken && config.telegramChatId) {
      const tgUrl = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
      const formattedText = `*${title}*\n${text}`;
      
      promises.push(
        fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.telegramChatId,
            text: formattedText,
            parse_mode: 'Markdown'
          })
        }).catch(err => {
          logger.error('[Notification Service] Gagal mengirim ke Telegram Bot:', err.message || err);
        })
      );
    }

    // 3. WhatsApp Webhook Abstraction (Extensible)
    if (config.whatsappUrl && config.whatsappToken && config.whatsappNumber) {
      const payload = {
        target: config.whatsappNumber,
        message: `*${title}*\n${text}`
      };

      promises.push(
        fetch(config.whatsappUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': config.whatsappToken // support standard auth token header
          },
          body: JSON.stringify(payload)
        }).catch(err => {
          logger.error('[Notification Service] Gagal mengirim ke WhatsApp Webhook:', err.message || err);
        })
      );
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  },

  // ── Event Helpers ──

  sendSuccess: async ({ nama, npm, kelas, pesan }) => {
    const title = '🟢 Absensi SIMKULIAH Sukses!';
    const text = `Akun: *${nama}* (${npm})\nKelas: *${kelas || 'SEMUA KELAS'}*\nPesan: _${pesan || 'Kehadiran berhasil dikonfirmasi!'}_`;
    
    // Custom Discord Embed
    const embed = {
      title: title,
      description: text,
      color: 3066993, // Green
      fields: [
        { name: 'Nama', value: nama, inline: true },
        { name: 'NPM', value: npm, inline: true },
        { name: 'Kelas', value: kelas || 'Semua Kelas', inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    await NotificationService.send({ title, text, type: 'success', discordEmbed: embed });
  },

  sendRetry: async ({ nama, npm, attempt, maxAttempts, error, nextRetry }) => {
    const title = `🟡 [RETRY ${attempt}/${maxAttempts}] Absensi Tertunda`;
    const text = `Akun: *${nama}* (${npm})\nPercobaan gagal karena: _${error || 'Koneksi gagal'}_\n\n*Akan dicoba kembali pada pukul ${nextRetry}*.`;
    
    const embed = {
      title: title,
      description: text,
      color: 15105570, // Yellow
      fields: [
        { name: 'Akun', value: `${nama} (${npm})`, inline: true },
        { name: 'Percobaan', value: `${attempt}/${maxAttempts}`, inline: true },
        { name: 'Rencana Ulang', value: nextRetry, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    await NotificationService.send({ title, text, type: 'warning', discordEmbed: embed });
  },

  sendFailed: async ({ nama, npm, error, attempts }) => {
    const title = '🔴 [FAILED] Absensi Otomatis Gagal!';
    const text = `Akun: *${nama}* (${npm})\nTelah dicoba sebanyak *${attempts} kali* dan gagal total.\n\n*Kesalahan terakhir*: \`\`\`${error || 'Koneksi simulator terputus'}\`\`\``;
    
    const embed = {
      title: title,
      description: text,
      color: 15158332, // Red
      fields: [
        { name: 'Nama', value: nama, inline: true },
        { name: 'NPM', value: npm, inline: true },
        { name: 'Batas Percobaan', value: `${attempts}x`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    await NotificationService.send({ title, text, type: 'danger', discordEmbed: embed });
  },

  sendCaptchaFailure: async ({ npm, ocrProvider, error }) => {
    const title = '⚠️ [WARN] Captcha Reader Gagal';
    const text = `NPM: *${npm}*\nProvider: *${ocrProvider}*\n\nTerjadi kesalahan membaca captcha. Sistem beralih otomatis ke *Tesseract OCR* lokal.\nError: _${error || 'Unknown Error'}_`;
    await NotificationService.send({ title, text, type: 'warning' });
  },

  sendHealthDegraded: async ({ status, reason }) => {
    const title = '🚨 [ALERT] Status Server Degraded / Masalah!';
    const text = `Status: *${status.toUpperCase()}*\nAlasan: *${reason || 'Database utama terputus / Fallback mode aktif.'}*\n\n_Harap lakukan pengecekan pada panel administrasi server._`;
    await NotificationService.send({ title, text, type: 'danger' });
  },

  sendDbFallbackActive: async ({ error }) => {
    const title = '⚠️ [WARN] SQLite Database Primer Gagal!';
    const text = `Sistem terpaksa beralih menggunakan **In-Memory Fallback Database** karena error:\n\`${error}\`\n\n*PENTING*: Seluruh perubahan data (akun baru, logs, jadwal) *TIDAK* akan disimpan secara permanen pada disk!`;
    await NotificationService.send({ title, text, type: 'danger' });
  }
};

module.exports = NotificationService;
