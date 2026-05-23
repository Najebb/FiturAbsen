// =============================================================================
// ABSEN SIMKULIAH — Frontend JS (Standalone Module)
// File ini adalah bagian dari modul Absensi-Module/frontend/
// Load via: <script src="/absen-assets/absen-script.js"></script>
// =============================================================================

const BOT_URL = window.BOT_URL || '/api'; // pakai proxy via Express (direkomendasikan)
// Jika bot berjalan terpisah, ganti dengan:
// const BOT_URL = 'http://localhost:5001/api';

// ─────────────────────────────────────────────────────────────────────────────
// View switcher dalam tab Absen
// ─────────────────────────────────────────────────────────────────────────────

function switchAbsenView(view) {
  ['accounts', 'add', 'log'].forEach(v => {
    const el = document.getElementById(`absenView-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  if (view === 'accounts') loadAkunAbsen();
  if (view === 'log')      loadAbsenLog();
}

// NOTE:
// Jangan override switchTab di bawah ini.
// Handler tab utama sudah meng-handle tab "absen" di fungsi switchTab utama.

// ─────────────────────────────────────────────────────────────────────────────
// Load daftar akun
// ─────────────────────────────────────────────────────────────────────────────

async function loadAkunAbsen() {
  const grid    = document.getElementById('akunGrid');
  const emptyEl = document.getElementById('absenEmptyMsg');
  const countEl = document.getElementById('absenCount');

  if (!grid) return;
  grid.innerHTML = `<div style="
    grid-column:1/-1;text-align:center;padding:2rem;
    font-family:'Share Tech Mono',monospace;font-size:0.75rem;color:var(--text-dim);">
    <div class="absen-spinner"></div>
    LOADING...
  </div>`;

  try {
    const res  = await fetch(`${BOT_URL}/accounts`);
    const data = await res.json();
    const list = data.data || [];

    if (countEl) countEl.textContent = list.length;

    if (list.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    grid.innerHTML = list.map(acc => `
      <div class="feature-card absen-account-card" id="card-${acc.id}" style="
        position:relative;padding:1.4rem;display:flex;flex-direction:column;gap:0.8rem;">

        <!-- BADGE STATUS -->
        <div class="absen-status-badge" id="badge-${acc.id}" style="
          position:absolute;top:12px;right:12px;
          font-family:'Share Tech Mono',monospace;font-size:0.6rem;
          letter-spacing:2px;padding:3px 10px;border-radius:2px;
          background:rgba(0,255,136,0.08);border:1px solid #00ff88;color:#00ff88;">
          READY
        </div>

        <!-- INFO AKUN -->
        <div style="padding-right:60px;">
          <div style="font-family:'Orbitron',monospace;font-size:0.85rem;
            font-weight:700;color:#fff;margin-bottom:4px;">
            ${escHtml(acc.nama)}
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:0.7rem;
            color:var(--red-bright);">
            NPM: ${escHtml(acc.npm)}
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:0.65rem;
            color:var(--text-dim);margin-top:4px;">
            Ditambah: ${formatDate(acc.created_at)}
          </div>
        </div>

        <!-- HASIL ABSEN -->
        <div id="result-${acc.id}" style="display:none;"></div>

        <!-- ACTIONS -->
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.4rem;">
          <button class="add-btn absen-single-btn" id="btn-${acc.id}"
            onclick="absenSatu(${acc.id}, '${escHtml(acc.nama)}')"
            style="flex:1;min-width:120px;font-size:0.68rem;padding:8px 12px;">
            ⚡ ABSEN
          </button>
          <button class="add-btn" id="retry-btn-${acc.id}"
            onclick="retryAbsenCaptcha(${acc.id}, '${escHtml(acc.nama)}', 5)"
            style="background:transparent;border:1px solid #555;color:#ffcc66;
              min-width:140px;font-size:0.63rem;padding:8px 12px;letter-spacing:1px;">
            🔁 RETRY CAPTCHA x5
          </button>
          <button onclick="hapusAkun(${acc.id}, '${escHtml(acc.nama)}')"
            style="background:transparent;border:1px solid #3E0000;
              color:#ff4444;padding:8px 12px;font-family:'Share Tech Mono',monospace;
              font-size:0.65rem;cursor:pointer;letter-spacing:1px;
              transition:all 0.2s;"
            onmouseover="this.style.borderColor='#ff4444'"
            onmouseout="this.style.borderColor='#3E0000'">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    grid.innerHTML = `<div style="
      grid-column:1/-1;text-align:center;padding:2rem;
      font-family:'Share Tech Mono',monospace;font-size:0.75rem;color:#ff4444;">
      ❌ Gagal memuat akun. Pastikan server bot berjalan.<br>
      <span style="color:var(--text-dim);font-size:0.65rem;">${err.message}</span>
    </div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Absen satu akun
// ─────────────────────────────────────────────────────────────────────────────

async function absenSatu(id, nama) {
  const btn      = document.getElementById(`btn-${id}`);
  const badge    = document.getElementById(`badge-${id}`);
  const resultEl = document.getElementById(`result-${id}`);

  setAbsenState(btn, badge, 'loading', `ABSEN ${nama.split(' ')[0].toUpperCase()}...`);

  try {
    const res  = await fetch(`${BOT_URL}/absen/${id}`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      setAbsenState(btn, badge, 'success');
      showAbsenResult(resultEl, data.data || [], true);
      if (data.outside_time) {
        showStatusBar(`⏰ ${nama}: ${data.message}`, 'warning');
      } else {
        showStatusBar(`✅ ${nama}: ${data.message}`, 'success');
      }
      return data;
    } else {
      setAbsenState(btn, badge, 'error');
      showAbsenResult(resultEl, [], false, data.message);
      showStatusBar(`❌ ${nama}: ${data.message}`, 'error');
      return data;
    }
  } catch (err) {
    setAbsenState(btn, badge, 'error');
    showStatusBar(`❌ Koneksi gagal: ${err.message}`, 'error');
    return { success: false, message: err.message || 'Koneksi gagal' };
  }

  // Reset tombol setelah 8 detik
  setTimeout(() => setAbsenState(btn, badge, 'ready'), 8000);
}

function isCaptchaReadError(msg) {
  return /captcha.*(tidak terbaca|invalid|gagal)/i.test(String(msg || ''));
}

async function retryAbsenCaptcha(id, nama, maxTry = 5) {
  const retryBtn = document.getElementById(`retry-btn-${id}`);
  if (retryBtn) {
    retryBtn.disabled = true;
    retryBtn.textContent = `⏳ RETRY 0/${maxTry}`;
    retryBtn.style.opacity = '0.7';
  }

  for (let i = 1; i <= maxTry; i++) {
    if (retryBtn) retryBtn.textContent = `⏳ RETRY ${i}/${maxTry}`;
    const result = await absenSatu(id, nama);
    if (!result) continue;
    if (result.success || !isCaptchaReadError(result.message)) break;
    if (i < maxTry) {
      showStatusBar(`🔁 ${nama}: retry captcha ${i}/${maxTry}`, 'loading');
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (retryBtn) {
    retryBtn.disabled = false;
    retryBtn.textContent = '🔁 RETRY CAPTCHA x5';
    retryBtn.style.opacity = '1';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Absen semua akun
// ─────────────────────────────────────────────────────────────────────────────

async function absenAll() {
  const btn = document.getElementById('btnAbsenAll');
  if (!btn) return;

  const origText = btn.innerHTML;
  btn.disabled   = true;
  btn.innerHTML  = `<span class="absen-spinner"></span> PROSES SEMUA AKUN...`;
  btn.style.opacity = '0.7';

  showStatusBar('⏳ Menjalankan absen untuk semua akun...', 'loading');

  try {
    const res  = await fetch(`${BOT_URL}/absen/all`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      const berhasil = (data.data || []).filter(x => x.success).length;
      const gagal    = (data.data || []).filter(x => !x.success).length;
      const outsideCount = (data.data || []).filter(x => x.outside_time).length;
      if (outsideCount > 0 && berhasil === 0) {
        showStatusBar(`⏰ Belum masuk waktu absen (${outsideCount} akun).`, 'warning');
      } else {
        showStatusBar(`✅ Selesai: ${berhasil} akun berhasil, ${gagal} gagal.`, 'success');
      }

      // Update badge tiap akun
      (data.data || []).forEach(item => {
        const badge = document.getElementById(`badge-${item.account_id}`);
        const btn2  = document.getElementById(`btn-${item.account_id}`);
        const res2  = document.getElementById(`result-${item.account_id}`);
        if (badge && btn2) {
          setAbsenState(btn2, badge, item.success ? 'success' : 'error');
          if (res2) showAbsenResult(res2, item.absen_list || [], item.success);
        }
      });
    } else {
      showStatusBar(`❌ ${data.message}`, 'error');
    }
  } catch (err) {
    showStatusBar(`❌ Koneksi gagal: ${err.message}`, 'error');
  }

  btn.disabled  = false;
  btn.innerHTML = origText;
  btn.style.opacity = '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tambah akun
// ─────────────────────────────────────────────────────────────────────────────

async function tambahAkunAbsen() {
  const nama     = document.getElementById('ab-nama')?.value.trim();
  const npm      = document.getElementById('ab-npm')?.value.trim();
  const password = document.getElementById('ab-password')?.value.trim();
  const msgEl    = document.getElementById('absenFormMsg');

  if (!nama || !npm || !password) {
    showFormMsg(msgEl, '⚠️ Semua field wajib diisi.', 'error');
    return;
  }

  try {
    const res  = await fetch(`${BOT_URL}/accounts`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ nama, npm, password }),
    });
    const data = await res.json();

    if (data.success) {
      showFormMsg(msgEl, `✅ Akun ${nama} berhasil ditambahkan.`, 'success');
      resetFormAbsen();
      // Kembali ke view accounts setelah 1.5 detik
      setTimeout(() => switchAbsenView('accounts'), 1500);
    } else {
      showFormMsg(msgEl, `❌ ${data.message}`, 'error');
    }
  } catch (err) {
    showFormMsg(msgEl, `❌ Koneksi gagal: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hapus akun
// ─────────────────────────────────────────────────────────────────────────────

async function hapusAkun(id, nama) {
  if (!confirm(`Hapus akun "${nama}"? Log absen juga akan terhapus.`)) return;

  try {
    const res  = await fetch(`${BOT_URL}/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(0.95)';
        setTimeout(() => loadAkunAbsen(), 350);
      }
      showStatusBar(`🗑️ Akun ${nama} dihapus.`, 'success');
    } else {
      showStatusBar(`❌ ${data.message}`, 'error');
    }
  } catch (err) {
    showStatusBar(`❌ Koneksi gagal: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Load log absen
// ─────────────────────────────────────────────────────────────────────────────

async function loadAbsenLog() {
  const tbody = document.getElementById('absenLogBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;
    font-family:'Share Tech Mono',monospace;font-size:0.75rem;color:var(--text-dim);">
    <div class="absen-spinner" style="margin:0 auto 8px;"></div>LOADING...
  </td></tr>`;

  try {
    const res  = await fetch(`${BOT_URL}/absen/log`);
    const data = await res.json();
    const logs = data.data || [];

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;
        font-family:'Share Tech Mono',monospace;font-size:0.75rem;color:var(--text-dim);">
        Belum ada log absen.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(log => `
      <tr>
        <td style="font-family:'Share Tech Mono',monospace;font-size:0.72rem;">
          ${escHtml(log.nama || '—')}
        </td>
        <td style="font-family:'Share Tech Mono',monospace;font-size:0.7rem;
          color:var(--red-bright);">
          ${escHtml(log.npm || '—')}
        </td>
        <td style="font-family:'Share Tech Mono',monospace;font-size:0.7rem;max-width:200px;">
          ${escHtml(log.kelas || '—')}
        </td>
        <td>
          <span style="
            font-family:'Share Tech Mono',monospace;font-size:0.65rem;
            padding:3px 10px;border-radius:2px;letter-spacing:1px;
            ${log.status === 'berhasil'
              ? 'background:rgba(0,255,136,0.08);border:1px solid #00ff88;color:#00ff88;'
              : 'background:rgba(255,23,68,0.08);border:1px solid var(--red-bright);color:var(--red-bright);'}
          ">
            ${escHtml(log.status?.toUpperCase() || '—')}
          </span>
        </td>
        <td style="font-family:'Share Tech Mono',monospace;font-size:0.65rem;
          color:var(--text-dim);white-space:nowrap;">
          ${formatDate(log.absen_at)}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ff4444;
      font-family:'Share Tech Mono',monospace;font-size:0.75rem;padding:1rem;">
      ❌ Gagal muat log: ${err.message}
    </td></tr>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────────────────────

function setAbsenState(btn, badge, state, customLabel) {
  if (!btn || !badge) return;

  const states = {
    loading: { btnTxt: `<span class="absen-spinner"></span> ${customLabel || 'PROSES...'}`, btnDis: true,  badgeTxt: 'RUNNING', badgeStyle: 'background:rgba(255,200,0,0.08);border:1px solid #ffc800;color:#ffc800;' },
    success: { btnTxt: '✅ SELESAI',  btnDis: false, badgeTxt: 'DONE',    badgeStyle: 'background:rgba(0,255,136,0.08);border:1px solid #00ff88;color:#00ff88;' },
    error:   { btnTxt: '❌ GAGAL',    btnDis: false, badgeTxt: 'ERROR',   badgeStyle: 'background:rgba(255,23,68,0.08);border:1px solid var(--red-bright);color:var(--red-bright);' },
    ready:   { btnTxt: '⚡ ABSEN',    btnDis: false, badgeTxt: 'READY',   badgeStyle: 'background:rgba(0,255,136,0.08);border:1px solid #00ff88;color:#00ff88;' },
  };

  const s = states[state] || states.ready;
  btn.innerHTML   = s.btnTxt;
  btn.disabled    = s.btnDis;
  badge.innerHTML = s.badgeTxt;
  badge.style.cssText += s.badgeStyle;
}

function showAbsenResult(el, list, success, errMsg) {
  if (!el) return;
  el.style.display = 'block';

  if (!success) {
    el.innerHTML = `<div style="padding:8px 12px;border:1px solid var(--red-bright);
      background:rgba(255,23,68,0.05);font-family:'Share Tech Mono',monospace;
      font-size:0.68rem;color:#ff6b6b;">
      ❌ ${escHtml(errMsg || 'Gagal')}
    </div>`;
    return;
  }

  if (!list || list.length === 0) {
    el.innerHTML = `<div style="padding:8px 12px;border:1px solid #00ff88;
      background:rgba(0,255,136,0.05);font-family:'Share Tech Mono',monospace;
      font-size:0.68rem;color:#00ff88;">
      ✅ Sudah terabsen sebelumnya
    </div>`;
    return;
  }

  el.innerHTML = `<div style="padding:10px 12px;border:1px solid #1a3a1a;
    background:rgba(0,255,136,0.03);">
    ${list.map(item => `
      <div style="font-family:'Share Tech Mono',monospace;font-size:0.68rem;
        color:${item.status === 'berhasil' ? '#00ff88' : '#ff6b6b'};
        padding:2px 0;">
        ${item.status === 'berhasil' ? '✅' : '❌'} ${escHtml(item.kelas)}
      </div>
    `).join('')}
  </div>`;
}

function showStatusBar(msg, type) {
  const bar = document.getElementById('absenStatusBar');
  if (!bar) return;

  const styles = {
    success: 'background:rgba(0,255,136,0.05);border-color:#00ff88;color:#00ff88;',
    error:   'background:rgba(255,23,68,0.05);border-color:var(--red-bright);color:#ff6b6b;',
    loading: 'background:rgba(255,200,0,0.05);border-color:#ffc800;color:#ffc800;',
    warning: 'background:rgba(255,180,0,0.05);border-color:#ffb400;color:#ffcc66;',
  };

  bar.style.cssText += styles[type] || styles.loading;
  bar.innerHTML      = msg;
  bar.style.display  = 'block';

  if (type !== 'loading') {
    setTimeout(() => { bar.style.display = 'none'; }, 6000);
  }
}

function showFormMsg(el, msg, type) {
  if (!el) return;
  el.style.display     = 'block';
  el.innerHTML          = msg;
  el.style.borderColor  = type === 'success' ? '#00ff88' : 'var(--red-bright)';
  el.style.color        = type === 'success' ? '#00ff88' : '#ff6b6b';
  el.style.background   = type === 'success' ? 'rgba(0,255,136,0.05)' : 'rgba(255,23,68,0.05)';
}

function resetFormAbsen() {
  ['ab-nama','ab-npm','ab-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const msgEl = document.getElementById('absenFormMsg');
  if (msgEl) msgEl.style.display = 'none';
}

function togglePw() {
  const input = document.getElementById('ab-password');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('id-ID', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}
