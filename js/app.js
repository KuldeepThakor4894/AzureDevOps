// Azure DevOps Intelligence Hub - Master Controller & Blade Engine
window.BladeController = {
  currentData: null,
  activeTab: 'overview',
  tabRenderers: {},

  init() {
    const backdrop = document.getElementById('bladeBackdrop');
    const panel = document.getElementById('azureBladePanel');
    const closeBtn = document.getElementById('btnBladeClose');

    backdrop?.addEventListener('click', () => this.closeBlade());
    closeBtn?.addEventListener('click', () => this.closeBlade());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel?.classList.contains('active')) {
        this.closeBlade();
      }
    });

    // Tab buttons
    document.querySelectorAll('.blade-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Copy JSON Payload
    document.getElementById('btnBladeCopyJson')?.addEventListener('click', () => {
      if (this.currentData?.rawData) {
        navigator.clipboard.writeText(JSON.stringify(this.currentData.rawData, null, 2))
          .then(() => alert('Resource telemetry JSON copied to clipboard!'))
          .catch(() => alert('Unable to copy to clipboard.'));
      }
    });

    // Open in Azure DevOps
    document.getElementById('btnBladeOpenAdo')?.addEventListener('click', () => {
      if (this.currentData?.adoUrl) {
        window.open(this.currentData.adoUrl, '_blank', 'noopener,noreferrer');
      } else {
        const org = window.HubApp.getOrg();
        const project = document.getElementById('projectSelect')?.value || '';
        const url = project ? `https://dev.azure.com/${org}/${encodeURIComponent(project)}` : `https://dev.azure.com/${org}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  },

  openBlade(config) {
    this.currentData = config;
    this.tabRenderers = config.renderers || {};

    const panel = document.getElementById('azureBladePanel');
    const backdrop = document.getElementById('bladeBackdrop');

    // Set Header Data
    document.getElementById('bladeTitle').textContent = config.title || 'Resource Details';
    document.getElementById('bladeSubtitle').textContent = config.subtitle || 'Azure DevOps Telemetry';
    
    if (config.iconSvg) {
      document.getElementById('bladeTitleIcon').innerHTML = config.iconSvg;
    }

    const crumbProject = document.getElementById('bladeCrumbProject');
    const crumbCategory = document.getElementById('bladeCrumbCategory');
    if (crumbProject) crumbProject.textContent = config.breadcrumbProject || 'Project';
    if (crumbCategory) crumbCategory.textContent = config.breadcrumbResource || 'Resource';

    // Show/Hide Tabs based on config
    const showStages = !!this.tabRenderers.stages;
    const showLogs = !!this.tabRenderers.logs;
    
    document.getElementById('bladeTabStages')?.classList.toggle('hidden', !showStages);
    document.getElementById('bladeTabLogs')?.classList.toggle('hidden', !showLogs);

    this.switchTab('overview');

    backdrop?.classList.add('active');
    panel?.classList.add('active');
    panel?.setAttribute('aria-hidden', 'false');
  },

  closeBlade() {
    const panel = document.getElementById('azureBladePanel');
    const backdrop = document.getElementById('bladeBackdrop');

    panel?.classList.remove('active');
    backdrop?.classList.remove('active');
    panel?.setAttribute('aria-hidden', 'true');
  },

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.blade-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });

    const body = document.getElementById('bladeBody');
    if (!body) return;

    if (tabId === 'raw') {
      const jsonStr = this.currentData?.rawData ? JSON.stringify(this.currentData.rawData, null, 2) : '{\n  "status": "No raw telemetry payload available"\n}';
      body.innerHTML = `
        <div class="blade-section">
          <div class="blade-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            Raw Azure Resource JSON
          </div>
          <div class="log-console-wrapper">
            <div class="log-console-header">
              <span>application/json</span>
              <span>UTF-8</span>
            </div>
            <pre class="log-console-content">${this.escapeHtml(jsonStr)}</pre>
          </div>
        </div>
      `;
      return;
    }

    if (this.tabRenderers[tabId]) {
      body.innerHTML = this.tabRenderers[tabId]();
    } else {
      body.innerHTML = `
        <div class="blade-section">
          <p class="text-muted" style="font-size:13px;">No telemetry content available for tab "${tabId}".</p>
        </div>
      `;
    }
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// Main Hub Application
window.HubApp = {
  chart: null,
  cachedRepos: [],
  cachedProjects: [],
  chartType: 'bar',
  currentTheme: 'light',
  currentView: 'dashboard',
  currentData: { labels: [], values: [], label: '' },

  viewConfigs: {
    dashboard: {
      title: 'Executive Intelligence Hub',
      subtitle: 'Unified repository matrix, branch policies, CI/CD telemetry and security analysis',
      cardTitle: 'Telemetry & Insights Overview',
      path: '/dev.azure.com/overview',
      substepId: null
    },
    repositories: {
      title: 'Repositories & Active Branch Matrix',
      subtitle: 'Inspect Git repositories, active branches, commit recency, and branch health flags',
      cardTitle: 'Repositories & Branches',
      path: '/dev.azure.com/repositories',
      substepId: 'substepRepo'
    },
    policies: {
      title: 'Branch Policy Enforcement & Governance',
      subtitle: 'Review branch protection rules, required reviewers, and automated build gates',
      cardTitle: 'Policy Enforcement Rules',
      path: '/dev.azure.com/policies',
      substepId: 'substepRepo'
    },
    prs: {
      title: 'Pull Requests Matrix',
      subtitle: 'Monitor active, completed, and abandoned pull requests across all repositories',
      cardTitle: 'Pull Requests',
      path: '/dev.azure.com/pullrequests',
      substepId: 'substepRepo'
    },
    pipelines: {
      title: 'Pipeline Builds & Release Deployment Matrix',
      subtitle: 'Inspect CI/CD pipeline runs, linked release environments, and gate statuses',
      cardTitle: 'Build & Release Runs',
      path: '/dev.azure.com/pipelines',
      substepId: 'substepPipelines'
    },
    agentpools: {
      title: 'Project Agent Pools & Queues',
      subtitle: 'Audit Microsoft-hosted and self-hosted private compute pools',
      cardTitle: 'Agent Pools & Queues',
      path: '/dev.azure.com/agentpools',
      substepId: 'substepAgentPools'
    },
    serviceconnections: {
      title: 'Service Connections & Cloud Endpoints',
      subtitle: 'Inspect cloud endpoint authorizations, service principals, and ARM scopes',
      cardTitle: 'Service Connections',
      path: '/dev.azure.com/serviceconnections',
      substepId: 'substepServiceConnections'
    },
    access: {
      title: 'Project Security Groups, Roles & Member Permissions',
      subtitle: 'Inspect security identities, explicit roles, and group memberships',
      cardTitle: 'Security Groups & Permissions',
      path: '/dev.azure.com/security',
      substepId: 'substepAccess'
    },
    activity: {
      title: 'User Activity & Commit History',
      subtitle: 'Track commit activity, timeline frequency, and code contribution',
      cardTitle: 'Commit History & Changes',
      path: '/dev.azure.com/activity',
      substepId: 'substepActivity'
    },
    workitems: {
      title: 'Active Work Items & Backlog Status',
      subtitle: 'Inspect agile backlog items, assigned bugs, and sprint status',
      cardTitle: 'Work Items & Backlog',
      path: '/dev.azure.com/workitems',
      substepId: 'substepWorkItems'
    }
  },

  init() {
    window.BladeController.init();
    this.initTheme();
    this.bindEvents();
    this.bindProjectPickerEvents();
    this.goToScreen(1);

    if (localStorage.getItem('ado_saved') === 'true') {
      const chk = document.getElementById('chkRememberCreds');
      if (chk) chk.checked = true;
      const org = document.getElementById('targetOrg');
      const pat = document.getElementById('targetPat');
      if (org) org.value = localStorage.getItem('ado_org') || '';
      if (pat) pat.value = localStorage.getItem('ado_pat') || '';
      this.updateOrgPath();
    }
  },

  initTheme() {
    const savedTheme = localStorage.getItem('hub_theme') || 'light';
    this.setTheme(savedTheme);

    const themeToggleBtn = document.getElementById('btnThemeToggle');
    themeToggleBtn?.addEventListener('click', () => {
      const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
      this.setTheme(nextTheme);
    });
  },

  setTheme(themeName) {
    this.currentTheme = themeName;
    localStorage.setItem('hub_theme', themeName);

    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    body.classList.add(`theme-${themeName}`);

    const iconSpan = document.getElementById('themeToggleIcon');
    const textSpan = document.getElementById('themeToggleText');

    if (themeName === 'dark') {
      if (iconSpan) iconSpan.textContent = '☀️';
      if (textSpan) textSpan.textContent = 'Light Mode';
    } else {
      if (iconSpan) iconSpan.textContent = '🌙';
      if (textSpan) textSpan.textContent = 'Dark Mode';
    }

    // Re-render chart if active
    if (this.currentData.labels.length) {
      this.renderChart(this.currentData.labels, this.currentData.values, this.currentData.label);
    }
  },

  bindEvents() {
    const self = this;
    
    // Sidebar toggle (collapse / expand)
    document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
      document.getElementById('appLayout')?.classList.toggle('sidebar-collapsed');
    });

    // Step Navigation
    document.getElementById('btnStartWizard')?.addEventListener('click', () => self.goToScreen(2));
    document.getElementById('btnBackToStep1')?.addEventListener('click', () => self.goToScreen(1));
    document.getElementById('btnSwitchOrg')?.addEventListener('click', () => self.goToScreen(2));
    document.getElementById('btnLogout')?.addEventListener('click', () => self.goToScreen(2));
    document.getElementById('btnLogoHome')?.addEventListener('click', () => self.goToScreen(1));

    document.getElementById('targetOrg')?.addEventListener('input', () => self.updateOrgPath());
    document.getElementById('btnConnect')?.addEventListener('click', () => self.connectAndGoToStep3());
    document.getElementById('projectSelect')?.addEventListener('change', () => self.handleProjectSelect());
    document.getElementById('btnModalClose')?.addEventListener('click', () => self.closeModal());

    // Sidebar Navigation Links
    document.querySelectorAll('.portal-sidebar .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        if (view) {
          self.switchView(view);
          self.triggerActiveInspect();
        }
      });
    });

    // Step 5 Execution Buttons
    document.getElementById('btnInspectRepo')?.addEventListener('click', () => self.execRepoInspect());
    document.getElementById('btnFetchAccess')?.addEventListener('click', () => self.execAccessFetch());
    document.getElementById('btnFetchActivity')?.addEventListener('click', () => self.execActivityFetch());
    document.getElementById('btnFetchPipelines')?.addEventListener('click', () => self.execPipelineFetch());
    document.getElementById('btnFetchWorkItems')?.addEventListener('click', () => self.execWorkItemsFetch());
    document.getElementById('btnFetchAgentPools')?.addEventListener('click', () => self.execAgentPoolsFetch());
    document.getElementById('btnMoreServiceConnections')?.addEventListener('click', () => window.ServiceConnectionModule.render(true));

    // Quick Action Bar Buttons in Card Header
    document.getElementById('btnQuickInspect')?.addEventListener('click', () => {
      if (self.currentView === 'pipelines') {
        self.execPipelineFetch();
      } else {
        self.triggerActiveInspect();
      }
    });
    document.getElementById('btnOpenAdoPortal')?.addEventListener('click', () => {
      const org = self.getOrg();
      const project = document.getElementById('projectSelect')?.value || '';
      const url = project ? `https://dev.azure.com/${org}/${encodeURIComponent(project)}` : `https://dev.azure.com/${org}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    // Azure DevOps Dashboard Widget Controls
    document.getElementById('btnRefreshDashboard')?.addEventListener('click', () => self.execDashboardFetch());
    document.getElementById('btnEditDashboard')?.addEventListener('click', () => self.showModal('Dashboard editing mode enabled. You can rearrange and customize Azure DevOps widgets.'));
    document.getElementById('btnDashSettings')?.addEventListener('click', () => self.showModal('Dashboard Settings: Connected to Azure DevOps Live REST API v7.1.'));
    document.getElementById('btnDashFullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Query Tiles Quick Navigation
    document.getElementById('tileActiveTasks')?.addEventListener('click', () => {
      self.switchView('workitems');
      self.triggerActiveInspect();
    });
    document.getElementById('tileReadyTesting')?.addEventListener('click', () => {
      self.switchView('workitems');
      self.triggerActiveInspect();
    });
    document.getElementById('tileCompletedStories')?.addEventListener('click', () => {
      self.switchView('pipelines');
      self.triggerActiveInspect();
    });
    document.getElementById('tileOpenStories')?.addEventListener('click', () => {
      self.switchView('workitems');
      self.triggerActiveInspect();
    });
    document.getElementById('tileActiveBugs')?.addEventListener('click', () => {
      self.switchView('workitems');
      self.triggerActiveInspect();
    });
    document.getElementById('tileSprintCapacity')?.addEventListener('click', () => {
      self.switchView('pipelines');
      self.triggerActiveInspect();
    });

    // Feedback Modal Handlers
    document.getElementById('btnOpenFeedback')?.addEventListener('click', () => {
      document.getElementById('feedbackModal')?.classList.remove('hidden');
    });
    document.getElementById('btnFeedbackCancel')?.addEventListener('click', () => {
      document.getElementById('feedbackModal')?.classList.add('hidden');
    });
    document.getElementById('btnFeedbackSubmit')?.addEventListener('click', () => {
      document.getElementById('feedbackModal')?.classList.add('hidden');
      alert('Thank you for your feedback! It has been submitted.');
    });

    // Chart Switchers
    document.querySelectorAll('.btn-chart').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-chart').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        self.chartType = e.currentTarget.dataset.chart;
        self.renderChart(self.currentData.labels, self.currentData.values, self.currentData.label);
      });
    });

    // Instant Search filter
    document.getElementById('tableFilterInput')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('#mainDashboard tbody tr').forEach(r => {
        r.style.display = r.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });

    // Exports
    document.getElementById('btnExportCSV')?.addEventListener('click', () => self.exportActiveCSV());
    document.getElementById('btnExportAccessXlsx')?.addEventListener('click', () => self.exportAccessXLSX());
  },

  goToScreen(stepNumber) {
    document.getElementById('screen-step1')?.classList.toggle('hidden', stepNumber !== 1);
    document.getElementById('screen-step2')?.classList.toggle('hidden', stepNumber !== 2);
    document.getElementById('screen-step3')?.classList.toggle('hidden', stepNumber !== 3);
    
    const isStep3 = stepNumber === 3;
    document.getElementById('portalSidebar')?.classList.toggle('hidden', !isStep3);
    document.getElementById('btnToggleSidebar')?.classList.toggle('hidden', !isStep3);
    document.getElementById('btnSwitchOrg')?.classList.toggle('hidden', !isStep3);
    document.getElementById('btnLogout')?.classList.toggle('hidden', !isStep3);
    document.getElementById('suiteEnvBadge')?.classList.toggle('hidden', !isStep3);

    window.BladeController.closeBlade();
  },

  getOrg() {
    return document.getElementById('targetOrg')?.value.trim().replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '').split('/')[0] || '';
  },

  getPat() {
    return document.getElementById('targetPat')?.value.trim() || '';
  },

  updateOrgPath() {
    const org = this.getOrg();
    const link = document.getElementById('generatedUrlLink');
    if (link) {
      link.href = org ? `https://dev.azure.com/${org}` : 'javascript:void(0)';
      link.textContent = org ? `https://dev.azure.com/${org}` : 'https://dev.azure.com/';
    }
  },

  async fetchAdo(org, path, auth) {
    const res = await fetch(`https://dev.azure.com/${org}/${path}`, {
      headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  },

  showModal(msg) {
    document.getElementById('modalMessage').textContent = msg;
    document.getElementById('validationModal')?.classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('validationModal')?.classList.add('hidden');
  },

  setStatus(msg, type = 'info') {
    const bar = document.getElementById('statusBar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = `status-banner status-${type}`;
    bar.classList.remove('hidden');
  },

  setKpis(scope, l2, v2, l3, v3, l4, v4) {
    const k1 = document.getElementById('kpi-1-val');
    const k2l = document.getElementById('kpi-2-label');
    const k2v = document.getElementById('kpi-2-val');
    const k3l = document.getElementById('kpi-3-label');
    const k3v = document.getElementById('kpi-3-val');
    const k4l = document.getElementById('kpi-4-label');
    const k4v = document.getElementById('kpi-4-val');

    if (k1) k1.textContent = scope;
    if (k2l) k2l.textContent = l2;
    if (k2v) k2v.textContent = v2;
    if (k3l) k3l.textContent = l3;
    if (k3v) k3v.textContent = v3;
    if (k4l) k4l.textContent = l4;
    if (k4v) k4v.textContent = v4;
  },

  async connectAndGoToStep3() {
    const org = this.getOrg();
    const pat = this.getPat();
    if (!org || !pat) return this.showModal('Please enter both Organization Name and Personal Access Token (PAT).');

    if (document.getElementById('chkRememberCreds')?.checked) {
      localStorage.setItem('ado_saved', 'true');
      localStorage.setItem('ado_org', org);
      localStorage.setItem('ado_pat', pat);
    }

    const btn = document.getElementById('btnConnect');
    if (btn) {
      btn.innerHTML = `<span class="pulse-dot pulse-blue"></span> Authenticating...`;
      btn.disabled = true;
    }

    try {
      const auth = 'Basic ' + btoa(':' + pat);
      const data = await this.fetchAdo(org, '_apis/projects?api-version=7.1-preview.1&$top=500', auth);
      this.cachedProjects = (data.value || []).sort((a, b) => a.name.localeCompare(b.name));
      const projects = this.cachedProjects;

      const select = document.getElementById('projectSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Choose Project --</option>' +
          projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        select.disabled = false;
      }

      this.populateDashboardProjectMenu();

      const orgCrumb = document.getElementById('suiteBreadcrumbOrg');
      if (orgCrumb) orgCrumb.textContent = `dev.azure.com/${org}`;

      const orgCode = document.getElementById('portalOrgCode');
      if (orgCode) orgCode.textContent = `dev.azure.com/${org}`;
      
      const connText = document.getElementById('suiteConnectionText');
      if (connText) connText.textContent = `Connected (${projects.length} Projects)`;

      this.goToScreen(3);
      this.switchView('dashboard');
      if (window.DashboardModule) window.DashboardModule.reset();
      this.setStatus(`Connected to ${org} successfully (${projects.length} projects discovered). Select a project to load dashboard metrics.`, 'success');
    } catch (e) {
      this.showModal(`Azure DevOps Authentication Error: ${e.message}`);
    } finally {
      if (btn) {
        btn.innerHTML = `Connect Workspace <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
        btn.disabled = false;
      }
    }
  },

  async handleProjectSelect() {
    const project = document.getElementById('projectSelect')?.value || '';
    const activeLabel = document.getElementById('activeProjectLabel');
    if (activeLabel) activeLabel.textContent = project || 'Select Project';

    const projCrumb = document.getElementById('suiteBreadcrumbProject');
    if (projCrumb) projCrumb.textContent = project || 'Overview';

    // Sync dashboard team name header
    const teamNameEl = document.getElementById('azDashTeamName');
    if (teamNameEl) teamNameEl.textContent = project ? `${project} Team` : 'Select a Project';

    this.populateDashboardProjectMenu();

    if (!project) {
      if (window.DashboardModule) window.DashboardModule.reset();
      this.setStatus('Please select an Azure DevOps Project from the dropdown above.', 'info');
      return;
    }

    this.setStatus(`Active Project set to: ${project}`, 'info');

    // Pre-fetch repos for the selected project
    try {
      const auth = 'Basic ' + btoa(':' + this.getPat());
      const data = await this.fetchAdo(this.getOrg(), `${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1-preview.1`, auth);
      this.cachedRepos = data.value || [];
      this.cachedRepos.sort((a, b) => a.name.localeCompare(b.name));

      const repoDropdown = document.getElementById('repoSelect');
      if (repoDropdown) {
        repoDropdown.innerHTML = '<option value="-- All Repositories --">-- All Repositories --</option>' +
          this.cachedRepos.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
      }
    } catch (err) {
      console.warn('Repository caching notice:', err);
    }

    // Auto-inspect or refresh currently selected view
    this.switchView(this.currentView, true);
  },

  switchView(viewKey, forceReload = false) {
    this.currentView = viewKey;
    const config = this.viewConfigs[viewKey] || this.viewConfigs.dashboard;

    // Update Sidebar active state
    document.querySelectorAll('.portal-sidebar .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewKey);
    });

    // Update Page Header & Card Header
    const pageTitle = document.getElementById('portalPageTitle');
    const pageSubtitle = document.getElementById('portalPageSubtitle');
    const cardTitle = document.getElementById('cardTabTitle');
    const activePath = document.getElementById('portalActivePath');

    const project = document.getElementById('projectSelect')?.value || '';
    const org = this.getOrg() || 'dev.azure.com';

    if (pageTitle) pageTitle.textContent = config.title;
    if (pageSubtitle) pageSubtitle.textContent = config.subtitle;
    if (cardTitle) cardTitle.textContent = config.cardTitle;
    if (activePath) {
      activePath.textContent = project ? `/dev.azure.com/${org}/${project}/${viewKey}` : `/dev.azure.com/${org}/${viewKey}`;
    }

    // Update Step 5 substep filters
    const filterContainer = document.getElementById('step5Container');
    if (filterContainer) {
      if (config.substepId) {
        filterContainer.classList.remove('hidden');
        ['substepRepo', 'substepAccess', 'substepActivity', 'substepPipelines', 'substepWorkItems', 'substepAgentPools', 'substepServiceConnections'].forEach(id => {
          document.getElementById(id)?.classList.toggle('hidden', id !== config.substepId);
        });
      } else {
        filterContainer.classList.add('hidden');
      }
    }

    // Show corresponding section in main dashboard
    const allViews = [
      'view-dashboard',
      'view-repositories',
      'view-policies',
      'view-prs',
      'view-access',
      'view-activity',
      'view-pipelines',
      'view-workitems',
      'view-agentpools',
      'view-serviceconnections'
    ];

    allViews.forEach(id => {
      document.getElementById(id)?.classList.toggle('hidden', id !== `view-${viewKey}`);
    });

    // Trigger auto-fetch if project is selected
    if (project && forceReload) {
      this.triggerActiveInspect();
    }
  },

  triggerActiveInspect() {
    const project = document.getElementById('projectSelect')?.value;
    if (!project) {
      return this.showModal('Please select an Azure DevOps Project first using the Project selector.');
    }

    switch (this.currentView) {
      case 'overallwork':
        this.execOverallWorkFetch();
        break;
      case 'repositories':
      case 'policies':
      case 'prs':
        this.execRepoInspect();
        break;
      case 'access':
        this.execAccessFetch();
        break;
      case 'activity':
        this.execActivityFetch();
        break;
      case 'pipelines':
        // Only load when user explicitly clicks "Fetch Runs" button
        break;
      case 'workitems':
        this.execWorkItemsFetch();
        break;
      case 'agentpools':
        this.execAgentPoolsFetch();
        break;
      case 'serviceconnections':
        this.execServiceConnectionsFetch();
        break;
      case 'dashboard':
        this.execDashboardFetch();
        break;
    }
  },

  async execRepoInspect() {
    try {
      this.setStatus('Inspecting repository branches and branch policies...', 'info');
      await window.RepoModule.inspect(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('repoSelect')?.value || '-- All Repositories --',
        this.cachedRepos
      );
      this.setStatus('Repository matrix & branch policies loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execAccessFetch() {
    try {
      this.setStatus('Scanning security groups and identities...', 'info');
      await window.AccessModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('targetAccessUserQuery')?.value.trim() || ''
      );
      this.setStatus('Security groups & permissions loaded successfully.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execActivityFetch() {
    try {
      this.setStatus('Scanning user activity and commit history...', 'info');
      if (!this.cachedRepos.length) {
        const auth = 'Basic ' + btoa(':' + this.getPat());
        const data = await this.fetchAdo(this.getOrg(), `${encodeURIComponent(document.getElementById('projectSelect').value)}/_apis/git/repositories?api-version=7.1-preview.1`, auth);
        this.cachedRepos = data.value || [];
      }
      await window.ActivityModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('targetUserQuery')?.value.trim() || '',
        parseInt(document.getElementById('userTimeframeDays')?.value || '90', 10),
        this.cachedRepos
      );
      this.setStatus('User commit activity and PRs loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execPipelineFetch() {
    try {
      this.setStatus('Fetching pipeline runs & linked release deployments...', 'info');
      await window.PipelineModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('pipelineRunsTop')?.value || '50',
        document.getElementById('pipelineDeploymentFilter')?.value || 'all'
      );
      this.setStatus('Pipeline build & release deployment metrics loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execWorkItemsFetch() {
    try {
      this.setStatus('Querying work items with WIQL engine...', 'info');
      await window.WorkItemModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('targetWorkItemUser')?.value.trim() || ''
      );
      this.setStatus('Work items & backlog status loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execAgentPoolsFetch() {
    try {
      this.setStatus('Scanning agent pools & queues for project...', 'info');
      await window.AgentPoolModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('agentPoolTypeSelect')?.value || 'all'
      );
      this.setStatus('Agent pools & infrastructure telemetry loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execServiceConnectionsFetch() {
    try {
      this.setStatus('Scanning service connections & endpoints for project...', 'info');
      await window.ServiceConnectionModule.fetch(
        this.getOrg(),
        document.getElementById('projectSelect').value,
        this.getPat(),
        document.getElementById('scTypeSelect')?.value || 'all',
        document.getElementById('targetScQuery')?.value.trim() || ''
      );
      this.setStatus('Service connections & cloud integrations loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },



  async execDashboardFetch() {
    const project = document.getElementById('projectSelect')?.value;
    if (!project) {
      if (window.DashboardModule) window.DashboardModule.reset();
      this.setStatus('Please select an Azure DevOps Project from the dropdown above to load the Dashboard.', 'warning');
      return;
    }
    try {
      this.setStatus('Loading Azure DevOps Widget Dashboard...', 'info');
      await window.DashboardModule.init(
        this.getOrg(),
        project,
        this.getPat()
      );
      this.setStatus('Azure DevOps Widget Dashboard loaded successfully.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  renderChart(labels, values, label) {
    this.currentData = { labels, values, label };
    const chartCanvas = document.getElementById('analyticsChart');
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext('2d');
    if (this.chart) this.chart.destroy();

    const isDark = this.currentTheme === 'dark';
    const isPie = this.chartType === 'pie';

    const executivePalette = ['#0078d4', '#107c10', '#0284c7', '#7c3aed', '#ea580c', '#d13438', '#059669', '#64748b'];
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(40, 54, 72, 0.4)' : 'rgba(203, 213, 225, 0.5)';

    this.chart = new Chart(ctx, {
      type: this.chartType,
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          label,
          data: values.length ? values : [0],
          backgroundColor: isPie ? executivePalette : '#0078d4',
          borderColor: isPie ? (isDark ? '#16202b' : '#ffffff') : '#005a9e',
          borderWidth: isPie ? 2 : 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isPie,
            labels: { color: textColor, font: { family: 'Segoe UI', size: 11.5, weight: '600' } }
          }
        },
        scales: isPie ? {} : {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              maxRotation: 20,
              minRotation: 15,
              font: { family: 'Segoe UI', size: 11, weight: '600' }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              stepSize: 1,
              font: { family: 'Segoe UI', size: 11, weight: '600' }
            }
          }
        }
      }
    });
  },

  exportAccessXLSX() {
    if (!window.AccessModule?.items || !window.AccessModule.items.length) {
      alert('No permissions data available to export.');
      return;
    }
    const exportData = window.AccessModule.items.map(r => ({
      'Project': r.ProjectName,
      'Security Group Name': r.GroupName,
      'Role': r.GroupRole,
      'User Display Name': r.UserDisplayName,
      'User Principal / Email': r.MailAddress || r.UserPrincipal
    }));

    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws, 'Permissions');
      XLSX.writeFile(wb, `${document.getElementById('projectSelect')?.value || 'Project'}_Permissions.xlsx`);
    } else {
      this.exportActiveCSV();
    }
  },

  exportActiveCSV() {
    const visibleTable = document.querySelector('#mainDashboard section:not(.hidden) table') || document.querySelector('#mainDashboard table');
    if (!visibleTable) return;
    let csv = [];
    visibleTable.querySelectorAll('tr').forEach(row => {
      let cols = [];
      row.querySelectorAll('th, td').forEach(c => cols.push(`"${c.innerText.replace(/"/g, '""')}"`));
      csv.push(cols.join(','));
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AzureDevOps_Export_${Date.now()}.csv`;
    a.click();
  },

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  bindProjectPickerEvents() {
    const self = this;
    const picker = document.getElementById('azDashTeamPicker');
    const menu = document.getElementById('azDashProjectMenu');
    const searchInput = document.getElementById('azDashProjectSearch');

    picker?.addEventListener('click', (e) => {
      e.stopPropagation();
      self.toggleDashboardProjectMenu();
    });

    document.getElementById('btnBannerSelectProject')?.addEventListener('click', (e) => {
      e.stopPropagation();
      self.openDashboardProjectMenu();
    });

    searchInput?.addEventListener('click', (e) => e.stopPropagation());
    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#azDashProjectList .az-dash-project-item').forEach(item => {
        const name = (item.dataset.project || '').toLowerCase();
        item.style.display = !q || name.includes(q) ? 'flex' : 'none';
      });
    });

    document.addEventListener('click', (e) => {
      if (!menu?.contains(e.target) && !picker?.contains(e.target)) {
        self.closeDashboardProjectMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu?.classList.contains('hidden')) {
        self.closeDashboardProjectMenu();
      }
    });
  },

  toggleDashboardProjectMenu() {
    const menu = document.getElementById('azDashProjectMenu');
    if (menu?.classList.contains('hidden')) {
      this.openDashboardProjectMenu();
    } else {
      this.closeDashboardProjectMenu();
    }
  },

  openDashboardProjectMenu() {
    const menu = document.getElementById('azDashProjectMenu');
    const picker = document.getElementById('azDashTeamPicker');
    const searchInput = document.getElementById('azDashProjectSearch');

    this.populateDashboardProjectMenu();
    menu?.classList.remove('hidden');
    picker?.classList.add('active');
    if (searchInput) {
      searchInput.value = '';
      setTimeout(() => searchInput.focus(), 50);
    }
  },

  closeDashboardProjectMenu() {
    const menu = document.getElementById('azDashProjectMenu');
    const picker = document.getElementById('azDashTeamPicker');
    menu?.classList.add('hidden');
    picker?.classList.remove('active');
  },

  populateDashboardProjectMenu() {
    const listEl = document.getElementById('azDashProjectList');
    if (!listEl) return;

    const currentProject = document.getElementById('projectSelect')?.value || '';
    const projects = this.cachedProjects || [];

    if (projects.length === 0) {
      listEl.innerHTML = `<div class="az-dash-project-empty">No projects discovered. Connect workspace first.</div>`;
      return;
    }

    const self = this;
    const html = projects.map(p => {
      const isSelected = p.name === currentProject;
      return `
        <div class="az-dash-project-item ${isSelected ? 'selected' : ''}" data-project="${self.escapeHtml(p.name)}">
          <svg class="az-dash-project-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          <span class="az-dash-project-item-name" title="${self.escapeHtml(p.name)}">${self.escapeHtml(p.name)}</span>
          ${isSelected ? '<span class="az-dash-project-item-check">✓</span>' : ''}
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    listEl.querySelectorAll('.az-dash-project-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const projName = item.dataset.project;
        const select = document.getElementById('projectSelect');
        if (select) {
          select.value = projName;
        }
        self.closeDashboardProjectMenu();
        self.handleProjectSelect();
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => window.HubApp.init());
