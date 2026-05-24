const { chromium } = require('playwright');
const logger = require('./logger');
const config = require('../config/config');

let browserInstance = null;
const activePages = new Map(); // pageObj -> { createdAt: timestamp, context: contextObj }

const BrowserManager = {
  /**
   * Mendapatkan atau meluncurkan instansi browser Playwright terpusat
   */
  getBrowser: async () => {
    if (!browserInstance) {
      try {
        logger.info('[Browser Manager] Meluncurkan instansi Chromium Playwright terpusat...');
        browserInstance = await chromium.launch({
          headless: config.playwright.headless,
          timeout: config.playwright.timeout
        });
        logger.info('[Browser Manager] Instansi Chromium berhasil diluncurkan.');
      } catch (e) {
        logger.error('[Browser Manager] Gagal meluncurkan Chromium!', e);
        throw e;
      }
    }
    return browserInstance;
  },

  /**
   * Membuat context & page baru dari shared browser
   */
  createPage: async () => {
    const browser = await BrowserManager.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    
    // Simpan metadata pelacakan zombie
    activePages.set(page, {
      createdAt: Date.now(),
      context: context
    });

    return page;
  },

  /**
   * Menutup page & context tertentu secara bersih
   */
  closePage: async (page) => {
    if (!page) return;
    const meta = activePages.get(page);
    if (meta) {
      try {
        await page.close();
        await meta.context.close();
      } catch (e) {
        // Silent catch
      } finally {
        activePages.delete(page);
      }
    }
  },

  /**
   * Membersihkan zombie page yang tidak ditutup lebih dari 5 menit
   */
  cleanupZombiePages: async () => {
    const now = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 menit
    let cleanupCount = 0;

    for (const [page, meta] of activePages.entries()) {
      if (now - meta.createdAt > TIMEOUT_MS) {
        logger.warn('[Browser Manager] Mendeteksi zombie page tidak aktif selama > 5 menit. Memaksa pembersihan...');
        await BrowserManager.closePage(page);
        cleanupCount++;
      }
    }
    if (cleanupCount > 0) {
      logger.info(`[Browser Manager] Berhasil membersihkan ${cleanupCount} zombie page.`);
    }
  },

  /**
   * Mematikan instansi browser secara anggun saat shutdown
   */
  gracefulShutdown: async () => {
    if (browserInstance) {
      logger.info('[Browser Manager] Mematikan instansi browser secara anggun...');
      // Tutup semua halaman aktif terlebih dahulu
      const pages = Array.from(activePages.keys());
      for (const page of pages) {
        await BrowserManager.closePage(page);
      }
      try {
        await browserInstance.close();
        logger.info('[Browser Manager] Instansi browser berhasil ditutup secara anggun.');
      } catch (e) {
        logger.error('[Browser Manager] Error saat mematikan browser:', e);
      } finally {
        browserInstance = null;
      }
    }
  }
};

// Skedulkan pembersihan zombie page setiap 1 menit secara teratur
setInterval(() => {
  BrowserManager.cleanupZombiePages().catch(err => {
    logger.error('[Browser Manager] Gagal melakukan pembersihan zombie page:', err);
  });
}, 60 * 1000);

module.exports = BrowserManager;
