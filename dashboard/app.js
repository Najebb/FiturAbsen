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
  const navCalendar = document.getElementById('nav-calendar');
  const navScheduler = document.getElementById('nav-scheduler');
  const navLogs = document.getElementById('nav-logs');
  const navAnalytics = document.getElementById('nav-analytics');
  const navAIInsights = document.getElementById('nav-ai-insights');
  const navHealth = document.getElementById('nav-health');
  const navSystemTools = document.getElementById('nav-system-tools');
  const navUsers = document.getElementById('nav-users');
  const navSessions = document.getElementById('nav-sessions');
  const navAuditLogs = document.getElementById('nav-audit-logs');
  const pageTitle = document.getElementById('page-title');
  
  const sections = {
    overview: document.getElementById('page-overview'),
    accounts: document.getElementById('page-accounts'),
    calendar: document.getElementById('page-calendar'),
    scheduler: document.getElementById('page-scheduler'),
    logs: document.getElementById('page-logs'),
    analytics: document.getElementById('page-analytics'),
    'ai-insights': document.getElementById('page-ai-insights'),
    health: document.getElementById('page-health'),
    'system-tools': document.getElementById('page-system-tools'),
    users: document.getElementById('page-users'),
    sessions: document.getElementById('page-sessions'),
    'audit-logs': document.getElementById('page-audit-logs')
  };

  const navItems = [navOverview, navAccounts, navCalendar, navScheduler, navLogs, navAnalytics, navAIInsights, navHealth, navSystemTools, navUsers, navSessions, navAuditLogs];

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
  let currentUser = null;
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
      if (data.success && data.user) {
        currentUser = {
          username: data.user.username,
          role: data.user.role,
          studentAccountId: data.user.student_account_id
        };
        displayUsername.textContent = data.user.username;
        
        const displayRole = document.querySelector('.user-role');
        if (displayRole) {
          displayRole.textContent = data.user.role.replace('_', ' ');
        }
        
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

    // Reset all role-restricted nav item visibility on logout
    const roleRestrictedNavs = [
      'nav-users', 'nav-sessions', 'nav-audit-logs',
      'nav-health', 'nav-system-tools', 'nav-calendar',
      'nav-analytics', 'nav-ai-insights'
    ];
    roleRestrictedNavs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Hide administrative buttons on logout
    const btnAllAbsen = document.getElementById('btn-run-all-absen');
    if (btnAllAbsen) btnAllAbsen.classList.add('hidden');
    const btnAddAccount = document.getElementById('btn-add-account-modal');
    if (btnAddAccount) btnAddAccount.classList.add('hidden');
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    appLayout.classList.remove('hidden');
    
    // Role-based visibility logic
    if (currentUser) {
      const role = currentUser.role;
      const isAdminOrSuper = (role === 'SUPER_ADMIN' || role === 'ADMIN');
      const isStaffOrAbove = (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'OPERATOR');

      // Users - SUPER_ADMIN only
      const userNav = document.getElementById('nav-users');
      if (userNav) {
        if (role === 'SUPER_ADMIN') userNav.classList.remove('hidden');
        else userNav.classList.add('hidden');
      }

      // Sessions & Audit Logs - SUPER_ADMIN and ADMIN
      const sessionNav = document.getElementById('nav-sessions');
      const auditNav = document.getElementById('nav-audit-logs');
      if (sessionNav) {
        if (isAdminOrSuper) sessionNav.classList.remove('hidden');
        else sessionNav.classList.add('hidden');
      }
      if (auditNav) {
        if (isAdminOrSuper) auditNav.classList.remove('hidden');
        else auditNav.classList.add('hidden');
      }

      // Other administrative pages
      const healthNav = document.getElementById('nav-health');
      const toolsNav = document.getElementById('nav-system-tools');
      const calendarNav = document.getElementById('nav-calendar');
      const analyticsNav = document.getElementById('nav-analytics');
      const aiNav = document.getElementById('nav-ai-insights');

      if (healthNav) {
        if (isStaffOrAbove) healthNav.classList.remove('hidden');
        else healthNav.classList.add('hidden');
      }
      if (toolsNav) {
        if (isStaffOrAbove) toolsNav.classList.remove('hidden');
        else toolsNav.classList.add('hidden');
      }
      if (calendarNav) {
        if (isStaffOrAbove) calendarNav.classList.remove('hidden');
        else calendarNav.classList.add('hidden');
      }
      if (analyticsNav) {
        if (isStaffOrAbove) analyticsNav.classList.remove('hidden');
        else analyticsNav.classList.add('hidden');
      }
      if (aiNav) {
        if (isStaffOrAbove) aiNav.classList.remove('hidden');
        else aiNav.classList.add('hidden');
      }

      // Hide administrative buttons from student role
      const btnAllAbsen = document.getElementById('btn-run-all-absen');
      if (btnAllAbsen) {
        if (isStaffOrAbove) btnAllAbsen.classList.remove('hidden');
        else btnAllAbsen.classList.add('hidden');
      }
      
      const btnAddAccount = document.getElementById('btn-add-account-modal');
      if (btnAddAccount) {
        if (isStaffOrAbove) btnAddAccount.classList.remove('hidden');
        else btnAddAccount.classList.add('hidden');
      }
    }
    
    // Load state
    loadActiveTab();
    
    // Start health monitoring checks if appropriate
    if (currentUser && (currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN' || currentUser.role === 'OPERATOR')) {
      fetchHealthData();
      healthInterval = setInterval(fetchHealthData, 10000);
    } else {
      // Simple status check without deep stats
      fetchHealthData();
      healthInterval = setInterval(fetchHealthData, 30000);
    }

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
        showToast('Login berhasil!', 'success');
        await checkAuth();
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
    
    // Check tab permissions
    if (currentUser) {
      const role = currentUser.role;
      const isAdminOrSuper = (role === 'SUPER_ADMIN' || role === 'ADMIN');
      const isStaffOrAbove = (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'OPERATOR');
      
      if (hash === 'users' && role !== 'SUPER_ADMIN') {
        window.location.hash = 'overview';
        return;
      }
      if ((hash === 'sessions' || hash === 'audit-logs') && !isAdminOrSuper) {
        window.location.hash = 'overview';
        return;
      }
      if ((hash === 'health' || hash === 'system-tools' || hash === 'calendar' || hash === 'analytics' || hash === 'ai-insights') && !isStaffOrAbove) {
        window.location.hash = 'overview';
        return;
      }
    }
    
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
        if (sections[key]) sections[key].classList.remove('hidden');
      } else {
        if (sections[key]) sections[key].classList.add('hidden');
      }
    });

    // Update title
    const titles = {
      overview: 'Ringkasan',
      accounts: 'Kelola Akun SIMKULIAH',
      calendar: 'Kalender Akademik & Hari Libur',
      scheduler: 'Auto Attendance Scheduler',
      logs: 'Riwayat Absensi',
      analytics: 'Analisis & Laporan Kehadiran',
      'ai-insights': 'AI Insights & Rekomendasi',
      health: 'Health Monitor',
      'system-tools': 'System Tools & Backups',
      users: 'Security Governance & User Management',
      sessions: 'Active Sessions Manager',
      'audit-logs': 'Security Audit Trail'
    };
    pageTitle.textContent = titles[hash] || 'Dashboard';

    // Fetch tab specific data
    if (hash === 'overview') {
      fetchOverviewData();
    } else if (hash === 'accounts') {
      fetchAccountsData();
    } else if (hash === 'calendar') {
      fetchCalendarData();
    } else if (hash === 'scheduler') {
      fetchSchedulerConfigs();
      fetchSchedulerHistory();
      pollSchedulerStatus();
    } else if (hash === 'logs') {
      fetchLogsData();
    } else if (hash === 'analytics') {
      fetchAnalyticsData();
    } else if (hash === 'ai-insights') {
      fetchAIInsightsData();
    } else if (hash === 'health') {
      fetchHealthData();
    } else if (hash === 'system-tools') {
      fetchSystemToolsData();
    } else if (hash === 'users') {
      fetchUsersData();
    } else if (hash === 'sessions') {
      fetchSessionsData();
    } else if (hash === 'audit-logs') {
      fetchAuditLogsData();
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
              <td>
                <label class="switch">
                  <input type="checkbox" class="toggle-account-active" data-id="${acc.id}" ${acc.is_active !== 0 ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </td>
              <td>
                <div class="action-buttons">
                  <button class="btn btn-secondary btn-sm btn-weekly-rules" data-id="${acc.id}">
                    <i data-lucide="calendar-range" class="btn-icon-inline"></i> Smart Rules
                  </button>
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
          document.querySelectorAll('.toggle-account-active').forEach(checkbox => {
            checkbox.addEventListener('change', async () => {
              const id = checkbox.dataset.id;
              const isActive = checkbox.checked ? 1 : 0;
              try {
                const res = await apiFetch(`/api/accounts/${id}/toggle-active`, {
                  method: 'POST',
                  body: JSON.stringify({ is_active: isActive })
                });
                if (res.success) {
                  showToast(`Akun berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
                } else {
                  showToast('Gagal mengubah status keaktifan akun.', 'error');
                  checkbox.checked = !checkbox.checked;
                }
              } catch (err) {
                showToast('Gagal mengubah status keaktifan akun.', 'error');
                checkbox.checked = !checkbox.checked;
              }
            });
          });

          document.querySelectorAll('.btn-weekly-rules').forEach(btn => {
            btn.addEventListener('click', () => openWeeklyRulesModal(btn.dataset.id));
          });

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

  // ==================== ACADEMIC CALENDAR & SMART RULES LOGIC ====================
  let localHolidays = [];
  let localBreaks = [];

  // Fetch Calendar and Holidays
  async function fetchCalendarData() {
    try {
      const res = await apiFetch('/api/calendar');
      if (res.success && res.data) {
        const { holidays, calendar } = res.data;
        localHolidays = holidays || [];
        localBreaks = (calendar && calendar.semester_breaks) || [];

        // Set inputs
        document.getElementById('cal-sem-start').value = (calendar && calendar.semester_start) || '';
        document.getElementById('cal-sem-end').value = (calendar && calendar.semester_end) || '';

        // Render lists
        renderLocalHolidays();
        renderLocalBreaks();
      }
    } catch (e) {
      showToast('Gagal memuat kalender akademik.', 'error');
    }
  }

  function renderLocalHolidays() {
    const container = document.getElementById('holidays-list-manager');
    container.innerHTML = '';

    if (localHolidays.length === 0) {
      container.innerHTML = '<div class="text-muted text-center" style="font-size:12px; padding:12px;">Belum ada hari libur nasional ditambahkan.</div>';
      return;
    }

    localHolidays.sort((a, b) => a.date.localeCompare(b.date)).forEach((h, idx) => {
      const div = document.createElement('div');
      div.className = 'list-manager-item';
      div.innerHTML = `
        <span style="flex-grow:1; font-size:13px; color: var(--text-primary);">
          <strong>${escapeHtml(h.name)}</strong> <span style="color: var(--text-secondary); margin-left: 8px;">(${escapeHtml(h.date)})</span>
        </span>
        <button type="button" class="btn btn-danger btn-xs btn-remove-holiday" data-idx="${idx}" style="padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; height: 28px; width: 28px;">
          <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
        </button>
      `;
      container.appendChild(div);
    });

    document.querySelectorAll('.btn-remove-holiday').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        localHolidays.splice(idx, 1);
        renderLocalHolidays();
      });
    });

    lucide.createIcons();
  }

  function renderLocalBreaks() {
    const container = document.getElementById('breaks-list-manager');
    container.innerHTML = '';

    if (localBreaks.length === 0) {
      container.innerHTML = '<div class="text-muted text-center" style="font-size:12px; padding:12px;">Belum ada libur semester ditambahkan.</div>';
      return;
    }

    localBreaks.sort((a, b) => a.start.localeCompare(b.start)).forEach((b, idx) => {
      const div = document.createElement('div');
      div.className = 'list-manager-item';
      div.innerHTML = `
        <span style="flex-grow:1; font-size:13px; color: var(--text-primary);">
          <strong>${escapeHtml(b.name)}</strong> <span style="color: var(--text-secondary); margin-left: 8px;">(${escapeHtml(b.start)} s/d ${escapeHtml(b.end)})</span>
        </span>
        <button type="button" class="btn btn-danger btn-xs btn-remove-break" data-idx="${idx}" style="padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; height: 28px; width: 28px;">
          <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
        </button>
      `;
      container.appendChild(div);
    });

    document.querySelectorAll('.btn-remove-break').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        localBreaks.splice(idx, 1);
        renderLocalBreaks();
      });
    });

    lucide.createIcons();
  }

  // Add holiday handler
  document.getElementById('btn-add-holiday').addEventListener('click', () => {
    const nameInput = document.getElementById('holiday-name-input');
    const dateInput = document.getElementById('holiday-date-input');

    const name = nameInput.value.trim();
    const date = dateInput.value;

    if (!name || !date) {
      showToast('Mohon isi nama libur dan tanggal dengan lengkap.', 'error');
      return;
    }

    // Check duplicate
    if (localHolidays.some(h => h.date === date)) {
      showToast('Tanggal libur ini sudah ada dalam daftar.', 'error');
      return;
    }

    localHolidays.push({ name, date });
    nameInput.value = '';
    dateInput.value = '';
    renderLocalHolidays();
    showToast('Hari libur nasional berhasil ditambahkan ke daftar lokal.', 'success');
  });

  // Add break handler
  document.getElementById('btn-add-break').addEventListener('click', () => {
    const nameInput = document.getElementById('break-name-input');
    const startInput = document.getElementById('break-start-input');
    const endInput = document.getElementById('break-end-input');

    const name = nameInput.value.trim();
    const start = startInput.value;
    const end = endInput.value;

    if (!name || !start || !end) {
      showToast('Mohon isi nama libur semester dan rentang tanggal lengkap.', 'error');
      return;
    }

    if (start > end) {
      showToast('Tanggal selesai tidak boleh sebelum tanggal mulai.', 'error');
      return;
    }

    localBreaks.push({ name, start, end });
    nameInput.value = '';
    startInput.value = '';
    endInput.value = '';
    renderLocalBreaks();
    showToast('Libur semester berhasil ditambahkan ke daftar lokal.', 'success');
  });

  // Save calendar to server
  document.getElementById('btn-save-calendar').addEventListener('click', async () => {
    const semStart = document.getElementById('cal-sem-start').value;
    const semEnd = document.getElementById('cal-sem-end').value;

    if (semStart && semEnd && semStart > semEnd) {
      showToast('Rentang tanggal semester aktif tidak valid.', 'error');
      return;
    }

    try {
      showToast('Menyimpan data kalender akademik...', 'info');
      const res = await apiFetch('/api/calendar', {
        method: 'POST',
        body: JSON.stringify({
          holidays: localHolidays,
          calendar: {
            semester_start: semStart,
            semester_end: semEnd,
            semester_breaks: localBreaks
          }
        })
      });

      if (res.success) {
        showToast('Kalender akademik dan hari libur berhasil disimpan!', 'success');
        fetchCalendarData();
      } else {
        showToast(res.message || 'Gagal menyimpan kalender akademik.', 'error');
      }
    } catch (e) {
      showToast('Gagal menyimpan kalender akademik.', 'error');
    }
  });

  // ==================== WEEKLY RULES MODAL FUNCTIONS ====================
  const rulesModal = document.getElementById('rules-modal');
  const btnRulesModalClose = document.getElementById('btn-rules-modal-close');
  const btnRulesModalCancel = document.getElementById('btn-rules-modal-cancel');
  const rulesForm = document.getElementById('rules-form');

  async function openWeeklyRulesModal(accountId) {
    document.getElementById('rules-account-id').value = accountId;
    
    // Pastikan data kalender ter-load agar local preview bekerja
    if (localHolidays.length === 0) {
      try {
        const res = await apiFetch('/api/calendar');
        if (res.success && res.data) {
          localHolidays = res.data.holidays || [];
          localBreaks = (res.data.calendar && res.data.calendar.semester_breaks) || [];
        }
      } catch (e) {
        console.warn('Gagal preload kalender untuk rules modal preview:', e);
      }
    }

    try {
      showToast('Memuat aturan mingguan...', 'info');
      const res = await apiFetch(`/api/rules/${accountId}`);
      if (res.success && res.data) {
        const rules = res.data.rules || [];
        const daysContainer = document.getElementById('rules-days-container');
        daysContainer.innerHTML = '';

        rules.forEach(day => {
          const div = document.createElement('div');
          div.className = 'rule-day-row';
          div.dataset.day = day.day_of_week;
          div.innerHTML = `
            <span class="day-label">${escapeHtml(day.day_name)}</span>
            <label class="switch">
              <input type="checkbox" class="day-enabled" ${day.is_enabled === 1 ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <input type="text" class="form-input day-slots" placeholder="Jam eksekusi, misal: 07:30, 13:40" value="${escapeHtml(day.time_slots)}">
          `;
          daysContainer.appendChild(div);
        });

        // Set up real-time live preview update on edit
        document.querySelectorAll('#rules-days-container input').forEach(input => {
          input.addEventListener('input', simulateRulesPreviewLocally);
          input.addEventListener('change', simulateRulesPreviewLocally);
        });

        simulateRulesPreviewLocally();
        rulesModal.classList.remove('hidden');
        lucide.createIcons();
      }
    } catch (e) {
      showToast('Gagal memuat aturan mingguan.', 'error');
    }
  }

  function simulateRulesPreviewLocally() {
    const rows = document.querySelectorAll('#rules-days-container .rule-day-row');
    const draftRules = [];
    rows.forEach(row => {
      const dayOfWeek = Number(row.dataset.day);
      const isEnabled = row.querySelector('.day-enabled').checked ? 1 : 0;
      const timeSlots = row.querySelector('.day-slots').value;
      draftRules.push({ day_of_week: dayOfWeek, is_enabled: isEnabled, time_slots: timeSlots });
    });

    const previewContainer = document.getElementById('rules-preview-container');
    previewContainer.innerHTML = '';

    const semStart = document.getElementById('cal-sem-start').value;
    const semEnd = document.getElementById('cal-sem-end').value;

    const now = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const previewList = [];

    const currentAccountId = Number(document.getElementById('rules-account-id').value);
    const acc = accountsData.find(a => a.id === currentAccountId);
    const isAccountInactive = acc && acc.is_active === 0;

    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const dayOfWeek = targetDate.getDay();
      
      const y = targetDate.getFullYear();
      const m = String(targetDate.getMonth() + 1).padStart(2, '0');
      const d = String(targetDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      const ruleMatch = draftRules.find(r => r.day_of_week === dayOfWeek && r.is_enabled === 1 && r.time_slots !== '');
      if (ruleMatch) {
        const slots = ruleMatch.time_slots
          .split(',')
          .map(s => s.trim())
          .filter(s => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(s));

        for (const slot of slots) {
          let skipped = false;
          let reason = '';

          if (isAccountInactive) {
            skipped = true;
            reason = 'Akun mahasiswa dinonaktifkan.';
          } else {
            const hol = localHolidays.find(h => h.date === dateStr);
            const brk = localBreaks.find(b => dateStr >= b.start && dateStr <= b.end);
            const isOutside = (semStart && dateStr < semStart) || (semEnd && dateStr > semEnd);

            if (hol) {
              skipped = true;
              reason = `Hari Libur Nasional: ${hol.name}`;
            } else if (brk) {
              skipped = true;
              reason = `Masa Libur Semester: ${brk.name}`;
            } else if (isOutside) {
              skipped = true;
              reason = 'Di luar masa aktif perkuliahan semester.';
            }
          }

          previewList.push({
            date: dateStr,
            time: slot,
            day_name: days[dayOfWeek],
            timestamp: new Date(`${dateStr}T${slot}:00`).getTime(),
            skipped,
            reason
          });
        }
      }
    }

    previewList.sort((a, b) => a.timestamp - b.timestamp);

    if (previewList.length === 0) {
      previewContainer.innerHTML = '<div class="text-muted text-center" style="font-size:12px; padding:12px;">Tidak ada jadwal eksekusi terdeteksi untuk 7 hari ke depan. Tambahkan jam pada hari aktif di atas!</div>';
    } else {
      previewList.forEach(item => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `
          <div class="preview-item-left">
            <span class="preview-item-date">${escapeHtml(item.day_name)}, ${escapeHtml(item.date)} Pukul <strong>${escapeHtml(item.time)}</strong></span>
            ${item.skipped ? `<span class="preview-item-reason">${escapeHtml(item.reason)}</span>` : ''}
          </div>
          <span class="badge ${item.skipped ? 'badge-skipped' : 'badge-run'}">${item.skipped ? 'SKIP' : 'RUN'}</span>
        `;
        previewContainer.appendChild(div);
      });
    }
  }

  // Save Rules handler
  rulesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accountId = Number(document.getElementById('rules-account-id').value);
    
    const rows = document.querySelectorAll('#rules-days-container .rule-day-row');
    const rules = [];
    rows.forEach(row => {
      const dayOfWeek = Number(row.dataset.day);
      const isEnabled = row.querySelector('.day-enabled').checked ? 1 : 0;
      const timeSlots = row.querySelector('.day-slots').value.trim();
      rules.push({ day_of_week: dayOfWeek, is_enabled: isEnabled, time_slots: timeSlots });
    });

    try {
      showToast('Menyimpan aturan penjadwalan...', 'info');
      const res = await apiFetch(`/api/rules/${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ rules })
      });

      if (res.success) {
        showToast('Aturan mingguan (Smart Rules) berhasil disimpan & disinkronkan!', 'success');
        rulesModal.classList.add('hidden');
        if (window.location.hash === '#scheduler') {
          fetchSchedulerConfigs();
        }
      } else {
        showToast(res.message || 'Gagal menyimpan aturan.', 'error');
      }
    } catch (err) {
      showToast('Gagal menyimpan aturan penjadwalan.', 'error');
    }
  });

  // Modal close handlers
  btnRulesModalClose.addEventListener('click', () => rulesModal.classList.add('hidden'));
  btnRulesModalCancel.addEventListener('click', () => rulesModal.classList.add('hidden'));

  // ==================== ATTENDANCE ANALYTICS LOGIC ====================
  let trendsChartInstance = null;
  let reasonsChartInstance = null;

  async function fetchAnalyticsData() {
    try {
      showToast('Memuat data analisis...', 'info');
      
      // 1. Fetch Overview Metrics & Warnings
      const overviewRes = await apiFetch('/api/analytics/overview');
      if (overviewRes.success && overviewRes.data) {
        const d = overviewRes.data;
        document.getElementById('analytic-total-execs').textContent = d.totalExecutions;
        document.getElementById('analytic-success-rate').textContent = `${d.successRate}%`;
        document.getElementById('analytic-failed-count').textContent = d.failedCount;
        document.getElementById('analytic-skipped-count').textContent = d.skippedCount;

        // Alerts container
        const warningPanel = document.getElementById('analytic-warning-panel');
        const alertsContainer = document.getElementById('analytic-alerts-container');
        alertsContainer.innerHTML = '';

        if (d.alerts && d.alerts.length > 0) {
          warningPanel.classList.remove('hidden');
          d.alerts.forEach(alert => {
            const div = document.createElement('div');
            div.className = `ews-alert-banner ${alert.type}`;
            div.innerHTML = `
              <i data-lucide="${alert.type === 'danger' ? 'alert-octagon' : 'alert-triangle'}" class="text-${alert.type === 'danger' ? 'red' : 'yellow'}" style="margin-top: 2px; width: 18px; height: 18px;"></i>
              <div>
                <div class="ews-alert-title ${alert.type}">${escapeHtml(alert.title)}</div>
                <div class="ews-alert-message">${escapeHtml(alert.message)}</div>
              </div>
            `;
            alertsContainer.appendChild(div);
          });
          lucide.createIcons();
        } else {
          warningPanel.classList.add('hidden');
        }
      }

      // 2. Fetch Trend Data based on Selected Range
      const range = document.getElementById('analytic-trend-range').value;
      const trendsRes = await apiFetch(`/api/analytics/trends?days=${range}`);
      if (trendsRes.success && trendsRes.data) {
        const d = trendsRes.data;
        renderTrendsChart(d.labels, d.successData, d.failedData, d.skippedData);
      }

      // 3. Fetch Failures & Reasons
      const failuresRes = await apiFetch('/api/analytics/failures');
      if (failuresRes.success && failuresRes.data) {
        const d = failuresRes.data;
        
        // Populate top failed table
        const tbody = document.getElementById('analytic-top-failures-tbody');
        tbody.innerHTML = '';
        if (d.topFailedAccounts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted" style="padding: 12px;">Tidak ada catatan kegagalan sistem.</td></tr>';
        } else {
          d.topFailedAccounts.forEach(acc => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td><strong>${escapeHtml(acc.nama)}</strong></td>
              <td><code>${escapeHtml(acc.npm)}</code></td>
              <td class="text-red" style="font-weight: 600;">${acc.failureCount} Kali</td>
            `;
            tbody.appendChild(tr);
          });
        }

        // Render Pie Chart for Reasons
        renderReasonsChart(d.failureReasons);
      }
    } catch (e) {
      showToast('Gagal memuat data analitik.', 'error');
    }
  }

  function renderTrendsChart(labels, success, failed, skipped) {
    const canvas = document.getElementById('chart-trends');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (trendsChartInstance) {
      trendsChartInstance.destroy();
    }

    trendsChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Sukses',
            data: success,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            fill: true
          },
          {
            label: 'Gagal',
            data: failed,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            fill: true
          },
          {
            label: 'Dilewati',
            data: skipped,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#9ca3af',
              font: { family: 'Inter', size: 11 }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(75, 85, 99, 0.15)' },
            ticks: { color: '#9ca3af', font: { family: 'Inter', size: 10 } }
          },
          y: {
            grid: { color: 'rgba(75, 85, 99, 0.15)' },
            ticks: { color: '#9ca3af', font: { family: 'Inter', size: 10 }, stepSize: 1 }
          }
        }
      }
    });
  }

  function renderReasonsChart(reasons) {
    const canvas = document.getElementById('chart-reasons');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (reasonsChartInstance) {
      reasonsChartInstance.destroy();
    }

    if (reasons.length === 0) {
      reasonsChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Tidak Ada Hambatan'],
          datasets: [{
            data: [1],
            backgroundColor: ['rgba(75, 85, 99, 0.2)'],
            borderWidth: 1,
            borderColor: '#1f2937'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          }
        }
      });
      return;
    }

    const labels = reasons.map(r => r.reason);
    const data = reasons.map(r => r.count);
    const colors = ['#f87171', '#fbbf24', '#60a5fa', '#f472b6', '#a78bfa', '#9ca3af'];

    reasonsChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 1,
          borderColor: '#1f2937'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#9ca3af',
              font: { family: 'Inter', size: 10 }
            }
          }
        }
      }
    });
  }

  async function downloadReportFile(format) {
    const days = document.getElementById('analytic-report-days').value;
    try {
      showToast('Menghasilkan berkas laporan...', 'info');
      const response = await fetch(`/api/analytics/reports?format=${format}&days=${days}`, {
        method: 'GET',
        headers: {
          'x-auth-token': authToken
        }
      });

      if (!response.ok) {
        throw new Error('Gagal menghasilkan laporan.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const disposition = response.headers.get('Content-Disposition');
      let filename = `Laporan_Kehadiran_Last_${days}_Hari.${format === 'pdf' ? 'pdf' : 'csv'}`;
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast('Laporan berhasil diunduh!', 'success');
    } catch (e) {
      showToast('Gagal mengunduh laporan rekap kehadiran.', 'error');
    }
  }

  // Bind dropdown & button events for Analytics
  document.getElementById('analytic-trend-range').addEventListener('change', () => {
    const range = document.getElementById('analytic-trend-range').value;
    apiFetch(`/api/analytics/trends?days=${range}`)
      .then(res => {
        if (res.success && res.data) {
          const d = res.data;
          renderTrendsChart(d.labels, d.successData, d.failedData, d.skippedData);
        }
      })
      .catch(() => showToast('Gagal memuat tren terbaru.', 'error'));
  });

  document.getElementById('btn-export-excel').addEventListener('click', () => downloadReportFile('excel'));
  document.getElementById('btn-export-pdf').addEventListener('click', () => downloadReportFile('pdf'));

  // --- AI Insights Data Fetching & Rendering ---
  let activeAICategory = 'accounts';

  async function fetchAIInsightsData() {
    try {
      const overviewRes = await apiFetch('/api/ai-insights/overview');
      if (overviewRes.success && overviewRes.data) {
        renderAIOverview(overviewRes.data);
      }
      fetchAICategoryData(activeAICategory);
    } catch (e) {
      showToast('Gagal memuat AI Insights.', 'error');
    }
  }

  function renderAIOverview(data) {
    const { riskAssessment, executiveSummary, lastUpdated, topIssues } = data;

    const timeSpan = document.getElementById('ai-cache-time');
    if (timeSpan && lastUpdated) {
      const date = new Date(lastUpdated);
      timeSpan.textContent = date.toLocaleTimeString('id-ID') + ' WIB';
    }

    const execText = document.getElementById('ai-exec-summary-text');
    if (execText) {
      execText.textContent = executiveSummary;
    }

    const riskScoreEl = document.getElementById('ai-risk-score');
    if (riskScoreEl) {
      riskScoreEl.textContent = riskAssessment.score;
      const score = riskAssessment.score;
      if (score >= 60) {
        riskScoreEl.style.color = '#ef4444';
      } else if (score >= 25) {
        riskScoreEl.style.color = '#f97316';
      } else if (score > 0) {
        riskScoreEl.style.color = '#eab308';
      } else {
        riskScoreEl.style.color = '#10b981';
      }
    }

    const riskLevelEl = document.getElementById('ai-risk-level');
    if (riskLevelEl) {
      riskLevelEl.textContent = riskAssessment.level;
      riskLevelEl.className = 'font-outfit ' + riskAssessment.statusClass;
    }

    const riskDescEl = document.getElementById('ai-risk-desc');
    if (riskDescEl) {
      riskDescEl.textContent = riskAssessment.description;
    }

    document.getElementById('ai-count-critical').textContent = riskAssessment.counts.critical;
    document.getElementById('ai-count-high').textContent = riskAssessment.counts.high;
    document.getElementById('ai-count-medium').textContent = riskAssessment.counts.medium;
    document.getElementById('ai-count-low').textContent = riskAssessment.counts.low;

    const topContainer = document.getElementById('ai-top-issues-container');
    if (topContainer) {
      topContainer.innerHTML = '';
      if (!topIssues || topIssues.length === 0) {
        topContainer.innerHTML = `
          <div class="text-muted" style="text-align: center; padding: 24px; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <i data-lucide="shield-check" style="width: 32px; height: 32px; color: #16a34a;"></i>
            <div>Tidak ada isu kritis atau tinggi aktif. Sistem dalam status optimal.</div>
          </div>
        `;
      } else {
        topIssues.forEach(issue => {
          topContainer.appendChild(createAIInsightCard(issue));
        });
      }
    }
    if (window.lucide) lucide.createIcons();
  }

  async function fetchAICategoryData(category) {
    const container = document.getElementById('ai-categorized-issues');
    if (!container) return;

    container.innerHTML = '<div class="text-muted" style="padding: 16px;">Memuat rincian kategori...</div>';

    try {
      const res = await apiFetch(`/api/ai-insights/${category}`);
      if (res.success && res.data) {
        const insights = res.data.insights || [];
        container.innerHTML = '';

        if (insights.length === 0) {
          container.innerHTML = `
            <div class="text-muted" style="padding: 24px; text-align: center; font-size: 13px;">
              Tidak ada isu atau rekomendasi dalam kategori ini.
            </div>
          `;
        } else {
          insights.forEach(issue => {
            container.appendChild(createAIInsightCard(issue));
          });
        }

        if (window.lucide) lucide.createIcons();
      }
    } catch (e) {
      container.innerHTML = '<div class="text-red" style="padding: 16px;">Gagal memuat rincian kategori.</div>';
    }
  }

  function createAIInsightCard(issue) {
    const div = document.createElement('div');
    div.className = 'ai-issue-card';

    const sevClass = String(issue.severity || 'low').toLowerCase();
    let iconName = 'info';
    if (sevClass === 'critical') iconName = 'alert-octagon';
    if (sevClass === 'high') iconName = 'alert-triangle';
    if (sevClass === 'medium') iconName = 'zap';

    div.innerHTML = `
      <div class="ai-issue-header">
        <span class="ai-issue-title">
          <i data-lucide="${iconName}" class="${
            sevClass === 'critical' ? 'text-red' : 
            sevClass === 'high' ? 'text-orange' : 
            sevClass === 'medium' ? 'text-yellow' : 'text-cyan'
          }"></i>
          ${issue.title}
        </span>
        <span class="badge-severity ${sevClass}">${issue.severity}</span>
      </div>
      <div class="ai-issue-desc">${issue.message}</div>
      <div class="ai-issue-reason">
        <strong>Bukti/Alasan:</strong> ${issue.reason}
      </div>
      <div class="ai-issue-recom">
        <i data-lucide="check-square" style="width: 15px; height: 15px; color: #06b6d4;"></i>
        <span><strong>Rekomendasi Tindakan:</strong> ${issue.recommendation}</span>
      </div>
    `;

    return div;
  }

  async function downloadAIReport(period) {
    try {
      showToast(`Mengunduh Laporan ${period.toUpperCase()}...`, 'info');
      const response = await fetch(`/api/ai-insights/reports?period=${period}`, {
        headers: { 'x-auth-token': authToken }
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const a = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      a.href = url;

      let filename = `AI_Insights_Report_${period.toUpperCase()}.md`;
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast('Laporan AI berhasil diunduh!', 'success');
    } catch (e) {
      showToast('Gagal mengunduh laporan AI.', 'error');
    }
  }

  const btnAIRefresh = document.getElementById('btn-ai-refresh');
  if (btnAIRefresh) {
    btnAIRefresh.addEventListener('click', async () => {
      btnAIRefresh.disabled = true;
      btnAIRefresh.innerHTML = '<i class="animate-spin" data-lucide="loader"></i> Memproses...';
      if (window.lucide) lucide.createIcons();

      try {
        const data = await apiFetch('/api/ai-insights/refresh', { method: 'POST' });
        
        if (data.success) {
          showToast('Analisis otomatis berhasil diperbarui!', 'success');
          renderAIOverview(data.data);
          fetchAICategoryData(activeAICategory);
        } else {
          showToast('Gagal memperbarui analisis.', 'error');
        }
      } catch (err) {
        showToast('Gagal memperbarui analisis.', 'error');
      } finally {
        btnAIRefresh.disabled = false;
        btnAIRefresh.innerHTML = '<i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Perbarui Analisis';
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  document.querySelectorAll('.tab-btn-ai').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn-ai').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeAICategory = e.target.getAttribute('data-category');
      fetchAICategoryData(activeAICategory);
    });
  });

  document.querySelectorAll('.btn-ai-report').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const period = e.currentTarget.getAttribute('data-period');
      downloadAIReport(period);
    });
  });

  // ==================== SECURITY GOVERNANCE & USER MANAGEMENT LOGIC ====================
  let auditLogsData = [];

  // --- Fetch Users ---
  async function fetchUsersData() {
    try {
      const result = await apiFetch('/api/users');
      if (result.success) {
        const users = result.data || [];
        const tbody = document.getElementById('users-list-body');
        tbody.innerHTML = '';

        if (users.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada pengguna terdaftar.</td></tr>`;
          return;
        }

        users.forEach(user => {
          const tr = document.createElement('tr');
          const isMe = currentUser && currentUser.username === user.username;
          
          tr.innerHTML = `
            <td><strong>${escapeHtml(user.username)}</strong> ${isMe ? '<span class="badge badge-outline-success">Anda</span>' : ''}</td>
            <td>${escapeHtml(user.email || '-')}</td>
            <td><span class="badge-role ${String(user.role).toLowerCase()}">${escapeHtml(user.role)}</span></td>
            <td><span class="badge-status ${String(user.status || 'ACTIVE').toLowerCase()}">${escapeHtml(user.status || 'ACTIVE')}</span></td>
            <td><code>${escapeHtml(user.student_account_npm || user.student_account_id || '-')}</code></td>
            <td style="text-align: center;">
              <div class="action-buttons" style="justify-content: center;">
                <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${user.id}">
                  <i data-lucide="edit-3" class="btn-icon-inline"></i> Edit
                </button>
                <button class="btn btn-secondary btn-sm btn-reset-user" data-id="${user.id}" data-username="${escapeHtml(user.username)}">
                  <i data-lucide="key" class="btn-icon-inline"></i> Reset
                </button>
                <button class="btn btn-danger btn-sm btn-delete-user" data-id="${user.id}" ${isMe ? 'disabled' : ''}>
                  <i data-lucide="trash-2" class="btn-icon-inline"></i> Hapus
                </button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });

        // Event listeners
        document.querySelectorAll('.btn-edit-user').forEach(btn => {
          btn.addEventListener('click', () => {
            const userId = btn.dataset.id;
            const user = users.find(u => u.id == userId);
            if (user) openEditUserModal(user);
          });
        });

        document.querySelectorAll('.btn-reset-user').forEach(btn => {
          btn.addEventListener('click', () => {
            openResetPasswordModal(btn.dataset.id, btn.dataset.username);
          });
        });

        document.querySelectorAll('.btn-delete-user').forEach(btn => {
          btn.addEventListener('click', () => {
            deleteUser(btn.dataset.id);
          });
        });

        if (window.lucide) lucide.createIcons();
      }
    } catch (e) {
      showToast('Gagal memuat daftar pengguna.', 'error');
    }
  }

  // --- Fetch Sessions ---
  async function fetchSessionsData() {
    try {
      const result = await apiFetch('/api/sessions');
      if (result.success) {
        const sessions = result.data || [];
        const tbody = document.getElementById('sessions-list-body');
        tbody.innerHTML = '';

        if (sessions.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada sesi aktif.</td></tr>`;
          return;
        }

        sessions.forEach(sess => {
          const tr = document.createElement('tr');
          const isCurrent = sess.is_current === 1;
          
          tr.innerHTML = `
            <td>
              <strong>${escapeHtml(sess.username)}</strong>
              ${isCurrent ? '<span class="badge badge-success" style="font-size: 9px; padding: 2px 6px;">Sesi Ini</span>' : ''}
            </td>
            <td><code>${escapeHtml(sess.ip_address)}</code></td>
            <td><small class="text-muted" title="${escapeHtml(sess.user_agent)}">${escapeHtml(truncateUserAgent(sess.user_agent))}</small></td>
            <td>${new Date(sess.created_at).toLocaleString('id-ID')}</td>
            <td>${formatRelativeTime(sess.last_active_at)}</td>
            <td style="text-align: center;">
              <button class="btn btn-danger btn-xs btn-revoke-session" data-token="${escapeHtml(sess.session_token)}" ${isCurrent ? 'disabled style="opacity: 0.5;"' : ''}>
                Putuskan
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        document.querySelectorAll('.btn-revoke-session').forEach(btn => {
          btn.addEventListener('click', async () => {
            const token = btn.dataset.token;
            if (confirm('Apakah Anda yakin ingin memutuskan paksa sesi pengguna ini?')) {
              try {
                const res = await apiFetch(`/api/sessions/${encodeURIComponent(token)}`, { method: 'DELETE' });
                if (res.success) {
                  showToast('Sesi berhasil diputuskan.', 'success');
                  fetchSessionsData();
                } else {
                  showToast(res.message || 'Gagal memutuskan sesi.', 'error');
                }
              } catch (err) {
                showToast('Gagal memutuskan sesi.', 'error');
              }
            }
          });
        });
      }
    } catch (e) {
      showToast('Gagal memuat sesi aktif.', 'error');
    }
  }

  function truncateUserAgent(ua) {
    if (!ua) return 'Unknown';
    if (ua.includes('Firefox/')) return 'Firefox Browser';
    if (ua.includes('Chrome/')) return 'Chrome Browser';
    if (ua.includes('Safari/')) return 'Safari Browser';
    if (ua.includes('Edge/')) return 'Edge Browser';
    return ua.substring(0, 30) + '...';
  }

  // --- Fetch Audit Logs ---
  async function fetchAuditLogsData() {
    try {
      const result = await apiFetch('/api/audit-logs');
      if (result.success) {
        auditLogsData = result.data || [];
        renderAuditLogsTable(auditLogsData);
      }
    } catch (e) {
      showToast('Gagal memuat log audit.', 'error');
    }
  }

  function renderAuditLogsTable(logs) {
    const tbody = document.getElementById('audit-logs-list-body');
    tbody.innerHTML = '';

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada log audit keamanan.</td></tr>`;
      return;
    }

    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><small>${new Date(log.created_at).toLocaleString('id-ID')}</small></td>
        <td><strong>${escapeHtml(log.username || 'SYSTEM')}</strong> <br><small class="text-muted">${escapeHtml(log.role || '-')}</small></td>
        <td><code>${escapeHtml(log.ip_address || '-')}</code></td>
        <td><span class="badge badge-outline-success">${escapeHtml(log.action)}</span></td>
        <td><code>${escapeHtml(log.component)}</code></td>
        <td><small>${escapeHtml(log.description)}</small></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Search Filter for Audit Logs
  const auditLogsSearch = document.getElementById('audit-logs-search');
  if (auditLogsSearch) {
    auditLogsSearch.addEventListener('input', () => {
      const query = auditLogsSearch.value.toLowerCase().trim();
      if (!query) {
        renderAuditLogsTable(auditLogsData);
        return;
      }

      const filtered = auditLogsData.filter(log => {
        const username = (log.username || '').toLowerCase();
        const action = (log.action || '').toLowerCase();
        const component = (log.component || '').toLowerCase();
        const description = (log.description || '').toLowerCase();
        const ip = (log.ip_address || '').toLowerCase();
        return username.includes(query) || action.includes(query) || component.includes(query) || description.includes(query) || ip.includes(query);
      });

      renderAuditLogsTable(filtered);
    });
  }

  // --- User Modals & Forms Handlers ---
  const addUserModal = document.getElementById('add-user-modal');
  const btnAddUserModal = document.getElementById('btn-add-user-modal');
  const btnUserModalClose = document.getElementById('btn-user-modal-close');
  const btnUserModalCancel = document.getElementById('btn-user-modal-cancel');
  const addUserForm = document.getElementById('add-user-form');
  const userRoleSelect = document.getElementById('user-role');
  const userStudentGroup = document.getElementById('user-student-group');
  const userStudentIdSelect = document.getElementById('user-student-id');

  // Trigger showing student account dropdown if role is STUDENT
  userRoleSelect.addEventListener('change', async () => {
    if (userRoleSelect.value === 'STUDENT') {
      userStudentGroup.classList.remove('hidden');
      await populateStudentAccountDropdown();
    } else {
      userStudentGroup.classList.add('hidden');
    }
  });

  async function populateStudentAccountDropdown(selectedId = null) {
    userStudentIdSelect.innerHTML = '<option value="">-- Hubungkan Akun SIMKULIAH --</option>';
    
    // Fetch accounts if accountsData is empty
    if (accountsData.length === 0) {
      try {
        const res = await apiFetch('/api/accounts');
        if (res.success) accountsData = res.data || [];
      } catch (err) {}
    }

    accountsData.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.nama} (${acc.npm})`;
      if (selectedId && acc.id == selectedId) {
        opt.selected = true;
      }
      userStudentIdSelect.appendChild(opt);
    });
  }

  // Open user modal for add
  btnAddUserModal.addEventListener('click', () => {
    document.getElementById('user-id').value = '';
    addUserForm.reset();
    document.getElementById('user-modal-title').innerHTML = '<i data-lucide="user-plus"></i> Tambah Pengguna Baru';
    document.getElementById('user-username').readOnly = false;
    document.getElementById('user-username').disabled = false;
    document.getElementById('user-password').required = true;
    document.getElementById('user-password-group').classList.remove('hidden');
    userStudentGroup.classList.add('hidden');
    
    addUserModal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  });

  async function openEditUserModal(user) {
    document.getElementById('user-id').value = user.id;
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-username').readOnly = true;
    document.getElementById('user-username').disabled = true;
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').required = false;
    document.getElementById('user-password-group').classList.add('hidden'); // Hide password input in edit mode (use Reset Password instead)
    
    document.getElementById('user-role').value = user.role;
    document.getElementById('user-modal-title').innerHTML = '<i data-lucide="edit-3"></i> Edit Pengguna';

    if (user.role === 'STUDENT') {
      userStudentGroup.classList.remove('hidden');
      await populateStudentAccountDropdown(user.student_account_id);
    } else {
      userStudentGroup.classList.add('hidden');
    }

    addUserModal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function closeUserModal() {
    addUserModal.classList.add('hidden');
    addUserForm.reset();
  }

  btnUserModalClose.addEventListener('click', closeUserModal);
  btnUserModalCancel.addEventListener('click', closeUserModal);
  addUserModal.addEventListener('click', (e) => {
    if (e.target === addUserModal) closeUserModal();
  });

  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-user-modal-submit');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Menyimpan...';

    const id = document.getElementById('user-id').value;
    const username = document.getElementById('user-username').value;
    const email = document.getElementById('user-email').value;
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;
    const student_account_id = role === 'STUDENT' ? document.getElementById('user-student-id').value : null;

    try {
      let result;
      if (id) {
        // Edit User
        result = await apiFetch(`/api/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ email, role, student_account_id })
        });
      } else {
        // Add User
        result = await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ username, email, password, role, student_account_id })
        });
      }

      if (result.success) {
        showToast(id ? 'Pengguna berhasil diperbarui!' : 'Pengguna baru berhasil dibuat!', 'success');
        closeUserModal();
        fetchUsersData();
      } else {
        showToast(result.message || 'Gagal menyimpan pengguna.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Gagal terhubung ke server.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Simpan';
    }
  });

  // Admin Reset User Password
  const resetPasswordModal = document.getElementById('reset-password-modal');
  const resetPasswordForm = document.getElementById('reset-password-form');
  const btnResetModalClose = document.getElementById('btn-reset-modal-close');
  const btnResetModalCancel = document.getElementById('btn-reset-modal-cancel');

  function openResetPasswordModal(id, username) {
    document.getElementById('reset-user-id').value = id;
    document.getElementById('reset-username-display').value = username;
    document.getElementById('reset-password-val').value = '';
    resetPasswordModal.classList.remove('hidden');
  }

  function closeResetModal() {
    resetPasswordModal.classList.add('hidden');
  }

  btnResetModalClose.addEventListener('click', closeResetModal);
  btnResetModalCancel.addEventListener('click', closeResetModal);
  resetPasswordModal.addEventListener('click', (e) => {
    if (e.target === resetPasswordModal) closeResetModal();
  });

  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-reset-modal-submit');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Mereset...';

    const id = document.getElementById('reset-user-id').value;
    const password = document.getElementById('reset-password-val').value;

    try {
      const result = await apiFetch(`/api/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      if (result.success) {
        showToast('Password pengguna berhasil direset!', 'success');
        closeResetModal();
      } else {
        showToast(result.message || 'Gagal mereset password.', 'error');
      }
    } catch (err) {
      showToast('Gagal mereset password.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Reset Password';
    }
  });

  async function deleteUser(id) {
    if (confirm('Apakah Anda yakin ingin menghapus pengguna ini? Semua sesi aktif milik pengguna ini juga akan ditutup secara otomatis.')) {
      try {
        const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
        if (res.success) {
          showToast('Pengguna berhasil dihapus.', 'success');
          fetchUsersData();
        } else {
          showToast(res.message || 'Gagal menghapus pengguna.', 'error');
        }
      } catch (err) {
        showToast('Gagal menghapus pengguna.', 'error');
      }
    }
  }

  // --- Change Password (Self Service) ---
  const changePasswordModal = document.getElementById('change-password-modal');
  const changePasswordForm = document.getElementById('change-password-form');
  const btnChangePasswordModal = document.getElementById('btn-change-password-modal');
  const btnChangeModalClose = document.getElementById('btn-change-modal-close');
  const btnChangeModalCancel = document.getElementById('btn-change-modal-cancel');

  if (btnChangePasswordModal) {
    btnChangePasswordModal.addEventListener('click', () => {
      changePasswordForm.reset();
      changePasswordModal.classList.remove('hidden');
    });
  }

  function closeChangeModal() {
    changePasswordModal.classList.add('hidden');
  }

  btnChangeModalClose.addEventListener('click', closeChangeModal);
  btnChangeModalCancel.addEventListener('click', closeChangeModal);
  changePasswordModal.addEventListener('click', (e) => {
    if (e.target === changePasswordModal) closeChangeModal();
  });

  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-change-modal-submit');
    
    const oldPassword = document.getElementById('change-old-password').value;
    const newPassword = document.getElementById('change-new-password').value;
    const confirmPassword = document.getElementById('change-confirm-password').value;

    if (newPassword !== confirmPassword) {
      showToast('Password baru tidak cocok dengan konfirmasi.', 'error');
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Memperbarui...';

    try {
      const result = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword })
      });

      if (result.success) {
        showToast('Password Anda berhasil diperbarui!', 'success');
        closeChangeModal();
      } else {
        showToast(result.message || 'Gagal memperbarui password.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Gagal memperbarui password.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Perbarui Password';
    }
  });

  // --- Start Auth Check ---
  checkAuth();
});
