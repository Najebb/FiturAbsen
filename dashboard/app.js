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
  const navScheduler = document.getElementById('nav-scheduler');
  const navLogs = document.getElementById('nav-logs');
  const navHealth = document.getElementById('nav-health');
  const navSystemTools = document.getElementById('nav-system-tools');
  const pageTitle = document.getElementById('page-title');
  
  const sections = {
    overview: document.getElementById('page-overview'),
    accounts: document.getElementById('page-accounts'),
    scheduler: document.getElementById('page-scheduler'),
    logs: document.getElementById('page-logs'),
    health: document.getElementById('page-health'),
    'system-tools': document.getElementById('page-system-tools')
  };

  const navItems = [navOverview, navAccounts, navScheduler, navLogs, navHealth, navSystemTools];

  // Mobile elements
  const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
  const btnSidebarClose = document.getElementById('btn-sidebar-close');
  const appSidebar = document.getElementById('app-sidebar');

  // Modals (Add Account)
  const addAccountModal = document.getElementById('add-account-modal');
  const btnAddAccountModal = document.getElementById('btn-add-account-modal');
  const btnModalClose = document.getElementById('btn-modal-close');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const addAccountForm = document.getElementById('add-account-form');

  // Modals (Add/Edit Scheduler)
  const addSchedulerModal = document.getElementById('add-scheduler-modal');
  const btnAddSchedulerModal = document.getElementById('btn-add-scheduler-modal');
  const btnSchedModalClose = document.getElementById('btn-sched-modal-close');
  const btnSchedModalCancel = document.getElementById('btn-sched-modal-cancel');
  const addSchedulerForm = document.getElementById('add-scheduler-form');
  const schedIdInput = document.getElementById('sched-id');
  const schedAccountSelect = document.getElementById('sched-account');
  const schedPresetSelect = document.getElementById('sched-preset');
  const schedCronInput = document.getElementById('sched-cron');
  const schedTzInput = document.getElementById('sched-tz');

  // Dynamic values
  const displayUsername = document.getElementById('display-username');
  const headerStatusIndicator = document.getElementById('header-status-indicator');
  const btnLogout = document.getElementById('btn-logout');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  
  // --- App State ---
  let authToken = localStorage.getItem('absen_token') || '';
  let accountsData = [];
  let logsData = [];
  let schedulerConfigsData = [];
  let schedulerHistoryData = [];
  let healthInterval = null;
  let schedulerPollerInterval = null;

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
    if (item) {
      item.addEventListener('click', () => {
        appSidebar.classList.remove('show');
      });
    }
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
      if (!response.ok && !options.allowErrorStatus) {
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
    clearInterval(schedulerPollerInterval);
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    appLayout.classList.remove('hidden');
    
    // Load state
    loadActiveTab();
    
    // Start health monitoring checks every 10 seconds
    fetchHealthData();
    healthInterval = setInterval(fetchHealthData, 10000);

    // Start background status polling for scheduler every 7 seconds
    pollSchedulerStatus();
    schedulerPollerInterval = setInterval(pollSchedulerStatus, 7000);
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
      if (item) {
        const itemHash = item.getAttribute('href').replace('#', '');
        if (itemHash === hash) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
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
      scheduler: 'Auto Attendance Scheduler',
      logs: 'Riwayat Absensi',
      health: 'Health Monitor',
      'system-tools': 'System Tools & Backups'
    };
    pageTitle.textContent = titles[hash] || 'Dashboard';

    // Fetch tab specific data
    if (hash === 'overview') {
      fetchOverviewData();
    } else if (hash === 'accounts') {
      fetchAccountsData();
    } else if (hash === 'scheduler') {
      fetchSchedulerConfigs();
      fetchSchedulerHistory();
      pollSchedulerStatus();
    } else if (hash === 'logs') {
      fetchLogsData();
    } else if (hash === 'health') {
      fetchHealthData();
    } else if (hash === 'system-tools') {
      fetchSystemToolsData();
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

  // Scheduler Configs & Status Data
  async function pollSchedulerStatus() {
    try {
      const result = await apiFetch('/api/scheduler/status');
      if (result.success && result.data) {
        const d = result.data;
        
        const statusVal = document.getElementById('scheduler-status-val');
        if (statusVal) {
          statusVal.textContent = d.status ? d.status.toUpperCase() : 'STOPPED';
          statusVal.className = 'stat-value ' + (d.status === 'running' ? 'color-green' : 'color-red');
        }

        const activeJobs = document.getElementById('scheduler-active-jobs');
        if (activeJobs) {
          activeJobs.textContent = d.activeTasksCount || 0;
        }

        const uptimeVal = document.getElementById('scheduler-uptime-val');
        if (uptimeVal) {
          uptimeVal.textContent = formatDuration(d.uptime || 0);
        }
      }
    } catch (e) {
      console.warn('Poller scheduler error:', e);
    }
  }

  async function fetchSchedulerConfigs() {
    try {
      const result = await apiFetch('/api/scheduler/configs');
      if (result.success) {
        schedulerConfigsData = result.data || [];
        const configsList = document.getElementById('scheduler-configs-list');
        configsList.innerHTML = '';

        if (schedulerConfigsData.length === 0) {
          configsList.innerHTML = `<tr><td colspan="5" class="text-muted text-center">Belum ada konfigurasi jadwal otomatis.</td></tr>`;
        } else {
          schedulerConfigsData.forEach(cfg => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>
                <div class="user-cell">
                  <span class="user-cell-name"><strong>${escapeHtml(cfg.nama)}</strong></span>
                  <span class="user-cell-npm">${escapeHtml(cfg.npm)}</span>
                </div>
              </td>
              <td><code>${escapeHtml(cfg.cron_pattern)}</code></td>
              <td>${escapeHtml(cfg.timezone)}</td>
              <td>
                <span class="badge ${cfg.is_enabled === 1 ? 'badge-active' : 'badge-paused'}">
                  ${cfg.is_enabled === 1 ? 'Aktif' : 'Pause'}
                </span>
              </td>
              <td>
                <div class="action-buttons">
                  <button class="btn btn-secondary btn-sm btn-toggle-sched" data-id="${cfg.id}" title="Pause/Resume">
                    <i data-lucide="${cfg.is_enabled === 1 ? 'pause' : 'play'}" class="btn-icon-inline"></i>
                  </button>
                  <button class="btn btn-primary btn-sm btn-edit-sched" data-id="${cfg.id}" title="Edit">
                    <i data-lucide="edit-3" class="btn-icon-inline"></i>
                  </button>
                  <button class="btn btn-danger btn-sm btn-delete-sched" data-id="${cfg.id}" title="Hapus">
                    <i data-lucide="trash-2" class="btn-icon-inline"></i>
                  </button>
                </div>
              </td>
            `;
            configsList.appendChild(tr);
          });

          // Bind Action Events
          document.querySelectorAll('.btn-toggle-sched').forEach(btn => {
            btn.addEventListener('click', () => toggleSchedulerConfig(btn.dataset.id));
          });
          document.querySelectorAll('.btn-edit-sched').forEach(btn => {
            btn.addEventListener('click', () => editSchedulerConfig(btn.dataset.id));
          });
          document.querySelectorAll('.btn-delete-sched').forEach(btn => {
            btn.addEventListener('click', () => deleteSchedulerConfig(btn.dataset.id));
          });
          lucide.createIcons();
        }
      }
    } catch (e) {
      showToast('Gagal memuat konfigurasi scheduler.', 'error');
    }
  }

  async function fetchSchedulerHistory() {
    try {
      const result = await apiFetch('/api/scheduler/history?limit=30');
      if (result.success) {
        schedulerHistoryData = result.data || [];
        const histContainer = document.getElementById('scheduler-history-list');
        histContainer.innerHTML = '';

        if (schedulerHistoryData.length === 0) {
          histContainer.innerHTML = `<div class="text-muted text-center py-20">Belum ada logs otomatis.</div>`;
        } else {
          schedulerHistoryData.forEach(h => {
            const item = document.createElement('div');
            item.className = 'sched-hist-item';
            
            let badgeClass = 'badge-active';
            if (h.status.startsWith('RETRY')) badgeClass = 'badge-retry';
            if (h.status === 'FAILED') badgeClass = 'badge-failed';
            
            item.innerHTML = `
              <div class="sched-hist-header">
                <span class="sched-hist-name">${escapeHtml(h.nama)}</span>
                <span class="badge ${badgeClass}">${escapeHtml(h.status)}</span>
              </div>
              <div class="sched-hist-msg">${escapeHtml(h.message)}</div>
              <div class="sched-hist-time">${new Date(h.executed_at).toLocaleString('id-ID')}</div>
            `;
            histContainer.appendChild(item);
          });
        }
      }
    } catch (e) {
      console.warn('Gagal memuat histori scheduler:', e);
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
  if (logsSearch) {
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
  }

  // Health Monitoring Data
  async function fetchHealthData() {
    try {
      const result = await apiFetch('/api/health', { allowErrorStatus: true });
      
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
  if (btnRunAllAbsen) {
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
  }

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

  // --- Scheduler Actions ---
  
  async function toggleSchedulerConfig(id) {
    try {
      const result = await apiFetch(`/api/scheduler/configs/${id}/toggle`, { method: 'POST' });
      if (result.success) {
        showToast(`Status jadwal berhasil diperbarui.`, 'success');
        fetchSchedulerConfigs();
        pollSchedulerStatus();
      }
    } catch (e) {
      showToast('Gagal mengubah status scheduler.', 'error');
    }
  }

  function editSchedulerConfig(id) {
    const cfg = schedulerConfigsData.find(c => c.id == id);
    if (!cfg) return;

    schedIdInput.value = cfg.id;
    
    // Populate select accounts & select this account ID
    populateSchedulerAccountsSelect(cfg.account_id);
    
    schedCronInput.value = cfg.cron_pattern;
    schedTzInput.value = cfg.timezone;
    
    // Set preset to custom since it is existing config
    schedPresetSelect.value = 'custom';
    
    // Change modal title & show
    const headerTitle = addSchedulerModal.querySelector('.modal-header h3');
    headerTitle.innerHTML = `<i data-lucide="edit"></i> Edit Jadwal Absensi`;
    lucide.createIcons();
    
    addSchedulerModal.classList.remove('hidden');
  }

  async function deleteSchedulerConfig(id) {
    if (!confirm('Apakah Anda yakin ingin menghapus jadwal otomatis ini?')) return;

    try {
      const result = await apiFetch(`/api/scheduler/configs/${id}`, { method: 'DELETE' });
      if (result.success) {
        showToast('Jadwal berhasil dihapus.', 'success');
        fetchSchedulerConfigs();
        pollSchedulerStatus();
      }
    } catch (e) {
      showToast('Gagal menghapus jadwal.', 'error');
    }
  }

  // Populate Accounts into select element on Scheduler Modal
  function populateSchedulerAccountsSelect(selectedId = null) {
    schedAccountSelect.innerHTML = '';
    
    if (accountsData.length === 0) {
      schedAccountSelect.innerHTML = `<option value="">-- Tambah akun di tab Akun terlebih dahulu --</option>`;
      return;
    }

    accountsData.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.nama} (${acc.npm})`;
      if (selectedId && acc.id == selectedId) {
        opt.selected = true;
      }
      schedAccountSelect.appendChild(opt);
    });
  }

  // Sched Preset change handler to auto-fill cron pattern
  schedPresetSelect.addEventListener('change', () => {
    const preset = schedPresetSelect.value;
    const presets = {
      'pagi': '30 7 * * *',
      'siang': '30 13 * * *',
      'sore': '30 16 * * *',
      'multi-3': '30 7,13,16 * * *',
      'multi-5': '30 7,10,13,16,19 * * *',
      'per-jam': '0 * * * *'
    };
    if (presets[preset]) {
      schedCronInput.value = presets[preset];
    }
  });

  // Modal open (Add Scheduler Config)
  btnAddSchedulerModal.addEventListener('click', async () => {
    schedIdInput.value = '';
    
    // Load accounts data if empty
    if (accountsData.length === 0) {
      try {
        const result = await apiFetch('/api/accounts');
        if (result.success) accountsData = result.data || [];
      } catch(e){}
    }
    
    populateSchedulerAccountsSelect();
    addSchedulerForm.reset();
    
    schedCronInput.value = '30 7 * * *';
    schedTzInput.value = 'Asia/Jakarta';
    
    const headerTitle = addSchedulerModal.querySelector('.modal-header h3');
    headerTitle.innerHTML = `<i data-lucide="calendar-plus"></i> Tambah Jadwal Baru`;
    lucide.createIcons();
    
    addSchedulerModal.classList.remove('hidden');
  });

  function closeSchedulerModal() {
    addSchedulerModal.classList.add('hidden');
    addSchedulerForm.reset();
  }

  btnSchedModalClose.addEventListener('click', closeSchedulerModal);
  btnSchedModalCancel.addEventListener('click', closeSchedulerModal);
  
  addSchedulerModal.addEventListener('click', (e) => {
    if (e.target === addSchedulerModal) closeSchedulerModal();
  });

  addSchedulerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-sched-modal-submit');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Menyimpan...';

    const id = schedIdInput.value;
    const account_id = schedAccountSelect.value;
    const cron_pattern = schedCronInput.value;
    const timezone = schedTzInput.value;

    if (!account_id) {
      showToast('Silakan pilih akun mahasiswa terlebih dahulu.', 'error');
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Simpan Jadwal';
      return;
    }

    try {
      let result;
      if (id) {
        // PUT Edit Config
        result = await apiFetch(`/api/scheduler/configs/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ cron_pattern, timezone })
        });
      } else {
        // POST Add Config
        result = await apiFetch('/api/scheduler/configs', {
          method: 'POST',
          body: JSON.stringify({ account_id, cron_pattern, timezone })
        });
      }

      if (result.success) {
        showToast(id ? 'Jadwal berhasil diperbarui!' : 'Jadwal otomatis baru berhasil ditambahkan!', 'success');
        closeSchedulerModal();
        fetchSchedulerConfigs();
        pollSchedulerStatus();
      } else {
        showToast(result.message || 'Gagal menyimpan konfigurasi.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Terjadi kesalahan sistem.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Simpan Jadwal';
    }
  });

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

  // --- System Tools & Backup Functions ---
  async function fetchSystemToolsData() {
    try {
      const [statsResult, backupsResult] = await Promise.all([
        apiFetch('/api/monitor/stats'),
        apiFetch('/api/backups')
      ]);

      if (statsResult.success) {
        const stats = statsResult.data;
        
        // Memory formatting helper
        const formatMB = (val) => val ? `${val} MB` : '-';
        document.getElementById('sys-rss').textContent = formatMB(stats.memoryUsageMB?.rss);
        document.getElementById('sys-heap-used').textContent = formatMB(stats.memoryUsageMB?.heapUsed);
        document.getElementById('sys-heap-total').textContent = formatMB(stats.memoryUsageMB?.heapTotal);
        document.getElementById('sys-active-jobs').textContent = `${stats.jobs?.activeCount || 0} Aktif / ${stats.jobs?.registeredCount || 0} Terjadwal`;
      }

      // Check notification channels
      const healthData = await apiFetch('/api/health');
      if (healthData.success) {
        const env = healthData.data?.env || {};
        
        const discordStatus = document.getElementById('noti-discord-status');
        if (env.discord_webhook) {
          discordStatus.className = 'value badge badge-success';
          discordStatus.textContent = 'AKTIF (Discord)';
        } else {
          discordStatus.className = 'value badge badge-outline-danger';
          discordStatus.textContent = 'MATI';
        }

        const telegramStatus = document.getElementById('noti-telegram-status');
        if (env.telegram_token && env.telegram_chat_id) {
          telegramStatus.className = 'value badge badge-success';
          telegramStatus.textContent = 'AKTIF (Telegram)';
        } else {
          telegramStatus.className = 'value badge badge-outline-danger';
          telegramStatus.textContent = 'MATI';
        }

        const whatsappStatus = document.getElementById('noti-whatsapp-status');
        if (env.whatsapp_url && env.whatsapp_number) {
          whatsappStatus.className = 'value badge badge-success';
          whatsappStatus.textContent = 'AKTIF (WhatsApp)';
        } else {
          whatsappStatus.className = 'value badge badge-outline-danger';
          whatsappStatus.textContent = 'MATI';
        }
      }

      if (backupsResult.success) {
        renderBackups(backupsResult.data || []);
      }
    } catch (e) {
      showToast('Gagal memuat informasi system tools.', 'error');
    }
  }

  function renderBackups(backups) {
    const listBody = document.getElementById('backup-list-body');
    listBody.innerHTML = '';

    if (backups.length === 0) {
      listBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada berkas backup database SQLite tersedia.</td></tr>`;
      return;
    }

    backups.forEach(backup => {
      const tr = document.createElement('tr');
      
      // Calculate human readable size
      const kb = Math.round(backup.sizeBytes / 1024);
      const sizeText = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
      
      const formattedDate = new Date(backup.createdAt).toLocaleString('id-ID');

      tr.innerHTML = `
        <td><strong class="text-white">${escapeHtml(backup.filename)}</strong></td>
        <td>${sizeText}</td>
        <td>${formattedDate}</td>
        <td style="text-align: center;">
          <button class="btn btn-outline-success btn-xs btn-restore-backup" data-filename="${escapeHtml(backup.filename)}" style="margin-right: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 4px; background: transparent; color: #10b981; border: 1px solid #10b981; cursor: pointer;">
            Restore
          </button>
        </td>
      `;
      listBody.appendChild(tr);
    });

    // Wire restore actions
    document.querySelectorAll('.btn-restore-backup').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const filename = e.currentTarget.getAttribute('data-filename');
        if (confirm(`Apakah Anda yakin ingin memulihkan database dari backup "${filename}"?\n\nKoneksi database aktif saat ini akan ditutup dan ditulis ulang.`)) {
          try {
            showToast('Memulihkan database...', 'info');
            const res = await apiFetch('/api/backups/restore', {
              method: 'POST',
              body: JSON.stringify({ filename })
            });

            if (res.success) {
              showToast('Database berhasil dipulihkan dari cadangan!', 'success');
              fetchSystemToolsData();
            } else {
              showToast(res.message || 'Gagal memulihkan database.', 'error');
            }
          } catch (err) {
            showToast('Gagal memulihkan database.', 'error');
          }
        }
      });
    });

    lucide.createIcons();
  }

  // Handle manual backup trigger
  document.getElementById('btn-backup-now').addEventListener('click', async () => {
    try {
      showToast('Membuat database backup cadangan...', 'info');
      const res = await apiFetch('/api/backups', { method: 'POST' });
      if (res.success) {
        showToast('Backup database SQLite berhasil dibuat!', 'success');
        fetchSystemToolsData();
      } else {
        showToast(res.message || 'Gagal membuat backup.', 'error');
      }
    } catch (e) {
      showToast('Gagal membuat backup.', 'error');
    }
  });

  // --- Start Auth Check ---
  checkAuth();
});
