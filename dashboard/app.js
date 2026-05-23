// =============================================================================
// Standalone Absensi-Module Dashboard client app
// SPA Router, API fetcher, state management, toast notifications
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // --- UI Elements ---
  const toastContainer = document.getElementById('toast-container');
  const loginScreen = document.getElementById('login-screen');
  const appLayout = document.getElementById('app-layout');
  const loginForm = document.getElementById('login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  
  // Navigation elements
  const navOverview = document.getElementById('nav-overview');
  const navAccounts = document.getElementById('nav-accounts');
  const navLogs = document.getElementById('nav-logs');
  const navHealth = document.getElementById('nav-health');
  const pageTitle = document.getElementById('page-title');
  
  const sections = {
    overview: document.getElementById('page-overview'),
    accounts: document.getElementById('page-accounts'),
    logs: document.getElementById('page-logs'),
    health: document.getElementById('page-health')
  };

  const navItems = [navOverview, navAccounts, navLogs, navHealth];

  // Mobile elements
  const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
  const btnSidebarClose = document.getElementById('btn-sidebar-close');
  const appSidebar = document.getElementById('app-sidebar');

  // Modals
  const addAccountModal = document.getElementById('add-account-modal');
  const btnAddAccountModal = document.getElementById('btn-add-account-modal');
  const btnModalClose = document.getElementById('btn-modal-close');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const addAccountForm = document.getElementById('add-account-form');

  // Dynamic values
  const displayUsername = document.getElementById('display-username');
  const headerStatusIndicator = document.getElementById('header-status-indicator');
  const btnLogout = document.getElementById('btn-logout');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  
  // --- App State ---
  let authToken = localStorage.getItem('absen_token') || '';
  let accountsData = [];
  let logsData = [];
  let healthInterval = null;

  // --- Initialize Lucide Icons ---
  lucide.createIcons();

  // --- Theme Toggle ---
  btnThemeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    btnThemeToggle.innerHTML = isLight 
      ? `<i data-lucide="moon"></i>` 
      : `<i data-lucide="sun"></i>`;
    lucide.createIcons();
  });

  // --- Sidebar Mobile Actions ---
  btnSidebarToggle.addEventListener('click', () => {
    appSidebar.classList.add('show');
  });

  btnSidebarClose.addEventListener('click', () => {
    appSidebar.classList.remove('show');
  });

  // Close sidebar on mobile item click
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      appSidebar.classList.remove('show');
    });
  });

  // --- Toast Notifications ---
  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle-2';
    if (type === 'error') iconName = 'alert-triangle';
    
    toast.innerHTML = `
      <i data-lucide="${iconName}" class="toast-icon"></i>
      <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    toastContainer.appendChild(toast);
    lucide.createIcons();
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 50);
    
    // Remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --- API Base Fetch Wrapper ---
  async function apiFetch(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(authToken ? { 'X-Auth-Token': authToken } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(endpoint, { ...options, headers });
      
      if (response.status === 401) {
        // Token expired / Unauthorized
        logout();
        showToast('Sesi telah berakhir. Harap login kembali.', 'error');
        throw new Error('Unauthorized');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP error ${response.status}`);
      }
      return data;
    } catch (e) {
      if (e.message !== 'Unauthorized') {
        console.error(`Fetch error on ${endpoint}:`, e);
      }
      throw e;
    }
  }

  // --- Auth Check & Login ---
  async function checkAuth() {
    if (!authToken) {
      showLoginScreen();
      return;
    }

    try {
      const data = await apiFetch('/api/auth/me');
      if (data.success) {
        displayUsername.textContent = data.username;
        showDashboard();
      } else {
        logout();
      }
    } catch (e) {
      logout();
    }
  }

  function showLoginScreen() {
    loginScreen.classList.remove('hidden');
    appLayout.classList.add('hidden');
    clearInterval(healthInterval);
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    appLayout.classList.remove('hidden');
    
    // Load state
    loadActiveTab();
    
    // Start health monitoring checks every 10 seconds
    fetchHealthData();
    healthInterval = setInterval(fetchHealthData, 10000);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login-submit');
    btn.disabled = true;
    
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });

      if (data.success && data.token) {
        authToken = data.token;
        localStorage.setItem('absen_token', authToken);
        displayUsername.textContent = usernameInput.value;
        showToast('Login berhasil!', 'success');
        showDashboard();
      } else {
        showToast(data.error || 'Kredensial tidak valid.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Gagal terhubung ke server.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  async function logout() {
    try {
      if (authToken) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      }
    } catch (e) {}
    
    authToken = '';
    localStorage.removeItem('absen_token');
    showLoginScreen();
  }

  btnLogout.addEventListener('click', logout);

  // --- SPA Router ---
  window.addEventListener('hashchange', loadActiveTab);

  function loadActiveTab() {
    if (!authToken) return;

    const hash = window.location.hash.replace('#', '') || 'overview';
    
    // Update active class on side navigations
    navItems.forEach(item => {
      const itemHash = item.getAttribute('href').replace('#', '');
      if (itemHash === hash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update section view
    Object.keys(sections).forEach(key => {
      if (key === hash) {
        sections[key].classList.remove('hidden');
      } else {
        sections[key].classList.add('hidden');
      }
    });

    // Update title
    const titles = {
      overview: 'Ringkasan',
      accounts: 'Kelola Akun SIMKULIAH',
      logs: 'Riwayat Absensi',
      health: 'Health Monitor'
    };
    pageTitle.textContent = titles[hash] || 'Dashboard';

    // Fetch tab specific data
    if (hash === 'overview') {
      fetchOverviewData();
    } else if (hash === 'accounts') {
      fetchAccountsData();
    } else if (hash === 'logs') {
      fetchLogsData();
    } else if (hash === 'health') {
      fetchHealthData();
    }
  }

  // --- Fetch Data Functions ---
  
  // Overview Tab Data
  async function fetchOverviewData() {
    try {
      const [accResult, logResult] = await Promise.all([
        apiFetch('/api/accounts'),
        apiFetch('/api/absen/log')
      ]);

      if (accResult.success) {
        accountsData = accResult.data || [];
        document.getElementById('stat-total-accounts').textContent = accountsData.length;
      }
      
      if (logResult.success) {
        logsData = logResult.data || [];
        
        // Count today's success/failure
        const today = new Date().toDateString();
        const todayLogs = logsData.filter(log => new Date(log.absen_at).toDateString() === today);
        const successLogs = todayLogs.filter(log => log.status === 'berhasil').length;
        const failedLogs = todayLogs.filter(log => log.status === 'gagal' || log.status === 'error').length;
        
        document.getElementById('stat-successful-logs').textContent = successLogs;
        document.getElementById('stat-failed-logs').textContent = failedLogs;

        // Populate recent logs list on dashboard (last 5)
        const recentList = document.getElementById('recent-logs-list');
        recentList.innerHTML = '';
        
        if (logsData.length === 0) {
          recentList.innerHTML = `<tr><td colspan="4" class="text-muted text-center">Belum ada riwayat aktivitas.</td></tr>`;
        } else {
          logsData.slice(0, 5).forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>
                <div class="user-cell">
                  <span class="user-cell-name">${escapeHtml(log.nama || 'Akun ID: ' + log.account_id)}</span>
                  <span class="user-cell-npm">${escapeHtml(log.npm || '')}</span>
                </div>
              </td>
              <td>
                <div class="class-cell-title">${escapeHtml(log.kelas || 'Absensi Massal')}</div>
                <div class="class-cell-desc text-muted">${escapeHtml(log.pesan || '')}</div>
              </td>
              <td>${formatRelativeTime(log.absen_at)}</td>
              <td><span class="badge ${log.status === 'berhasil' ? 'badge-success' : 'badge-danger'}">${escapeHtml(log.status)}</span></td>
            `;
            recentList.appendChild(tr);
          });
        }
      }
    } catch (e) {
      showToast('Gagal memuat ringkasan data.', 'error');
    }
  }

  // Accounts Tab Data
  async function fetchAccountsData() {
    try {
      const result = await apiFetch('/api/accounts');
      if (result.success) {
        accountsData = result.data || [];
        const accountsList = document.getElementById('accounts-list');
        accountsList.innerHTML = '';

        if (accountsData.length === 0) {
          accountsList.innerHTML = `<tr><td colspan="5" class="text-muted text-center">Belum ada akun terdaftar.</td></tr>`;
        } else {
          accountsData.forEach(acc => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td><strong>${escapeHtml(acc.nama)}</strong></td>
              <td><code>${escapeHtml(acc.npm)}</code></td>
              <td>${new Date(acc.created_at).toLocaleString('id-ID')}</td>
              <td><span class="badge badge-outline-success">Ready</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn btn-primary btn-sm btn-test-absen" data-id="${acc.id}">
                    <i data-lucide="play" class="btn-icon-inline"></i> Jalankan Absen
                  </button>
                  <button class="btn btn-danger btn-sm btn-delete-account" data-id="${acc.id}">
                    <i data-lucide="trash-2" class="btn-icon-inline"></i> Hapus
                  </button>
                </div>
              </td>
            `;
            accountsList.appendChild(tr);
          });

          // Bind event listeners
          document.querySelectorAll('.btn-test-absen').forEach(btn => {
            btn.addEventListener('click', () => runSingleAbsen(btn.dataset.id, btn));
          });
          document.querySelectorAll('.btn-delete-account').forEach(btn => {
            btn.addEventListener('click', () => deleteAccount(btn.dataset.id));
          });
          lucide.createIcons();
        }
      }
    } catch (e) {
      showToast('Gagal mengambil daftar akun.', 'error');
    }
  }

  // Logs Tab Data
  async function fetchLogsData() {
    try {
      const result = await apiFetch('/api/absen/log');
      if (result.success) {
        logsData = result.data || [];
        renderLogsTable(logsData);
      }
    } catch (e) {
      showToast('Gagal memuat log riwayat.', 'error');
    }
  }

  function renderLogsTable(logs) {
    const logsList = document.getElementById('logs-list');
    logsList.innerHTML = '';

    if (logs.length === 0) {
      logsList.innerHTML = `<tr><td colspan="5" class="text-muted text-center">Belum ada riwayat absen.</td></tr>`;
    } else {
      logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${escapeHtml(log.nama || 'ID: ' + log.account_id)}</strong>
            <br><small class="text-muted">${escapeHtml(log.npm || '')}</small>
          </td>
          <td><strong>${escapeHtml(log.kelas || '-')}</strong></td>
          <td><span class="badge ${log.status === 'berhasil' ? 'badge-success' : 'badge-danger'}">${escapeHtml(log.status)}</span></td>
          <td><small>${escapeHtml(log.pesan || '')}</small></td>
          <td>${new Date(log.absen_at).toLocaleString('id-ID')}</td>
        `;
        logsList.appendChild(tr);
      });
    }
  }

  // Logs Search Filter
  const logsSearch = document.getElementById('logs-search');
  logsSearch.addEventListener('input', () => {
    const query = logsSearch.value.toLowerCase().trim();
    if (!query) {
      renderLogsTable(logsData);
      return;
    }

    const filtered = logsData.filter(log => {
      const name = (log.nama || '').toLowerCase();
      const npm = (log.npm || '').toLowerCase();
      const kelas = (log.kelas || '').toLowerCase();
      const pesan = (log.pesan || '').toLowerCase();
      return name.includes(query) || npm.includes(query) || kelas.includes(query) || pesan.includes(query);
    });

    renderLogsTable(filtered);
  });

  // Health Monitoring Data
  async function fetchHealthData() {
    try {
      const result = await apiFetch('/api/health');
      
      // Header indicators
      const statusDot = headerStatusIndicator.querySelector('.status-dot');
      const statusText = headerStatusIndicator.querySelector('.status-text');
      
      if (result.status === 'healthy') {
        statusDot.className = 'status-dot green-dot';
        statusText.textContent = 'Online';
        document.getElementById('summary-server-status').className = 'badge badge-success';
        document.getElementById('summary-server-status').textContent = 'Healthy';
      } else {
        statusDot.className = 'status-dot red-dot';
        statusText.textContent = 'Degraded';
        document.getElementById('summary-server-status').className = 'badge badge-danger';
        document.getElementById('summary-server-status').textContent = 'Degraded';
      }

      // Summary Overview panel
      document.getElementById('summary-db-fallback').textContent = result.database.fallbackMode ? 'Active (Memory)' : 'Non-Active';
      document.getElementById('summary-db-fallback').className = result.database.fallbackMode ? 'badge badge-danger' : 'badge badge-outline-success';
      
      document.getElementById('summary-gemini-key').textContent = result.config.hasGeminiKey ? 'Terdeteksi' : 'Kosong';
      document.getElementById('summary-gemini-key').className = result.config.hasGeminiKey ? 'badge badge-outline-success' : 'badge badge-danger';

      document.getElementById('summary-server-uptime').textContent = formatDuration(result.uptime);

      // Health Page Tab
      const healthDbStatus = document.getElementById('health-db-status');
      if (result.database.connected) {
        healthDbStatus.textContent = 'TERHUBUNG';
        healthDbStatus.className = 'value badge badge-success';
      } else {
        healthDbStatus.textContent = 'TERPUTUS';
        healthDbStatus.className = 'value badge badge-danger';
      }

      document.getElementById('health-db-fallback').textContent = result.database.fallbackMode ? 'Aktif (In-Memory Fallover)' : 'Tidak Aktif (File Primer)';
      document.getElementById('health-db-path').textContent = result.database.path || '-';

      const healthGeminiStatus = document.getElementById('health-gemini-status');
      if (result.config.hasGeminiKey) {
        healthGeminiStatus.textContent = 'TERSEDIA (Akurat)';
        healthGeminiStatus.className = 'value badge badge-success';
      } else {
        healthGeminiStatus.textContent = 'TIDAK TERSEDIA (Tesseract Fallback)';
        healthGeminiStatus.className = 'value badge badge-danger';
      }

      document.getElementById('health-encrypt-len').textContent = `${result.config.encryptionKeyLength} karakter`;
      document.getElementById('health-uptime-val').textContent = formatDuration(result.uptime);

    } catch (e) {
      console.error('Health check error:', e);
      // Header offline state
      const statusDot = headerStatusIndicator.querySelector('.status-dot');
      const statusText = headerStatusIndicator.querySelector('.status-text');
      statusDot.className = 'status-dot red-dot';
      statusText.textContent = 'Offline';
      
      // Overview panel status
      document.getElementById('summary-server-status').className = 'badge badge-danger';
      document.getElementById('summary-server-status').textContent = 'Offline';
    }
  }

  // --- Action Operations ---

  // Run Absensi Massal (All Accounts)
  const btnRunAllAbsen = document.getElementById('btn-run-all-absen');
  btnRunAllAbsen.addEventListener('click', async () => {
    if (accountsData.length === 0) {
      showToast('Belum ada akun untuk diproses.', 'error');
      return;
    }

    if (!confirm('Jalankan proses absensi otomatis untuk seluruh akun?')) return;

    btnRunAllAbsen.disabled = true;
    btnRunAllAbsen.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Memproses...`;
    lucide.createIcons();
    showToast('Memulai absensi otomatis massal. Harap tunggu...', 'info');

    try {
      const result = await apiFetch('/api/absen/all', { method: 'POST' });
      if (result.success) {
        showToast('Selesai memproses absensi massal.', 'success');
        fetchOverviewData();
      } else {
        showToast(result.message || 'Gagal memproses absensi massal.', 'error');
      }
    } catch (e) {
      showToast('Gagal menjalankan absen massal.', 'error');
    } finally {
      btnRunAllAbsen.disabled = false;
      btnRunAllAbsen.innerHTML = `<i data-lucide="zap"></i> Jalankan Semua Absensi`;
      lucide.createIcons();
    }
  });

  // Run Absen Single Account
  async function runSingleAbsen(id, btn) {
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Proses...`;
    lucide.createIcons();
    showToast('Menjalankan bot Playwright absensi. Proses membutuhkan waktu ~30 detik...', 'info');

    try {
      const result = await apiFetch(`/api/absen/${id}`, { method: 'POST' });
      if (result.success) {
        showToast(`Absensi Sukses: ${result.message}`, 'success');
      } else {
        showToast(`Gagal Absen: ${result.message}`, 'error');
      }
      fetchAccountsData();
    } catch (e) {
      showToast('Gagal memproses absensi akun ini.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      lucide.createIcons();
    }
  }

  // Delete Account
  async function deleteAccount(id) {
    if (!confirm('Apakah Anda yakin ingin menghapus akun mahasiswa ini?')) return;

    try {
      const result = await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
      if (result.success) {
        showToast('Akun berhasil dihapus.', 'success');
        fetchAccountsData();
      } else {
        showToast(result.message || 'Gagal menghapus akun.', 'error');
      }
    } catch (e) {
      showToast('Terjadi kesalahan saat menghapus akun.', 'error');
    }
  }

  // --- Modal Operations (Add Account) ---
  btnAddAccountModal.addEventListener('click', () => {
    addAccountModal.classList.remove('hidden');
  });

  function closeModal() {
    addAccountModal.classList.add('hidden');
    addAccountForm.reset();
  }

  btnModalClose.addEventListener('click', closeModal);
  btnModalCancel.addEventListener('click', closeModal);
  
  // Close modal on outer click
  addAccountModal.addEventListener('click', (e) => {
    if (e.target === addAccountModal) closeModal();
  });

  addAccountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-modal-submit');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Menyimpan...';

    const nama = document.getElementById('acc-nama').value;
    const npm = document.getElementById('acc-npm').value;
    const password = document.getElementById('acc-password').value;

    try {
      const result = await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ nama, npm, password })
      });

      if (result.success) {
        showToast('Akun mahasiswa berhasil ditambahkan!', 'success');
        closeModal();
        fetchAccountsData();
      } else {
        showToast(result.message || 'Gagal menambahkan akun.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Terjadi kesalahan sistem.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Simpan Akun';
    }
  });

  // --- Helper Formatting Functions ---
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let res = '';
    if (hrs > 0) res += `${hrs}j `;
    if (mins > 0 || hrs > 0) res += `${mins}m `;
    res += `${secs}s`;
    return res;
  }

  function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHrs = Math.floor(diffMins / 60);

    if (diffSecs < 60) return 'Baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffHrs < 24) return `${diffHrs} jam lalu`;
    return date.toLocaleDateString('id-ID');
  }

  // --- Start Auth Check ---
  checkAuth();
});
