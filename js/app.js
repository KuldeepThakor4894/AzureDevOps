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
        window.open(`https://dev.azure.com/${org}`, '_blank', 'noopener,noreferrer');
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
  chartType: 'bar',
  currentTheme: 'light',
  currentData: { labels: [], values: [], label: '' },

  init() {
    window.BladeController.init();
    this.initTheme();
    this.bindEvents();

    if (localStorage.getItem('ado_saved') === 'true') {
      document.getElementById('chkRememberCreds').checked = true;
      document.getElementById('targetOrg').value = localStorage.getItem('ado_org') || '';
      document.getElementById('targetPat').value = localStorage.getItem('ado_pat') || '';
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
      if (textSpan) textSpan.textContent = 'Executive Bright';
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
    
    // Step Navigation
    document.getElementById('btnStartWizard').addEventListener('click', () => {
      self.goToScreen(2);
    });

    document.getElementById('btnBackToStep1').addEventListener('click', () => {
      self.goToScreen(1);
    });

    document.getElementById('btnSwitchOrg').addEventListener('click', () => {
      self.goToScreen(2);
    });

    document.getElementById('btnTopSwitchOrg')?.addEventListener('click', () => {
      self.goToScreen(2);
    });

    document.getElementById('btnLogoHome')?.addEventListener('click', () => {
      self.goToScreen(1);
    });

    document.getElementById('targetOrg').addEventListener('input', () => self.updateOrgPath());
    document.getElementById('btnConnect').addEventListener('click', () => self.connectAndGoToStep3());
    document.getElementById('projectSelect').addEventListener('change', () => self.handleProjectSelect());
    document.getElementById('categorySelect').addEventListener('change', () => self.handleCategorySelect());
    document.getElementById('btnModalClose').addEventListener('click', () => self.closeModal());

    // Step 5 Execution Buttons
    document.getElementById('btnInspectRepo').addEventListener('click', () => self.execRepoInspect());
    document.getElementById('btnFetchAccess').addEventListener('click', () => self.execAccessFetch());
    document.getElementById('btnFetchActivity').addEventListener('click', () => self.execActivityFetch());
    document.getElementById('btnFetchPipelines').addEventListener('click', () => self.execPipelineFetch());
    document.getElementById('btnFetchWorkItems').addEventListener('click', () => self.execWorkItemsFetch());

    // Pagination Listeners
    document.getElementById('btnMoreRepos')?.addEventListener('click', () => window.RepoModule.renderBranches(true));
    document.getElementById('btnMorePrs')?.addEventListener('click', () => window.RepoModule.renderPrs(true));
    document.getElementById('btnMoreAccess')?.addEventListener('click', () => window.AccessModule.render(true));
    document.getElementById('btnMoreCommits')?.addEventListener('click', () => window.ActivityModule.renderCommits(true));
    document.getElementById('btnMorePipelines')?.addEventListener('click', () => window.PipelineModule.render(true));
    document.getElementById('btnMoreWorkItems')?.addEventListener('click', () => window.WorkItemModule.render(true));

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
    document.getElementById('tableFilterInput').addEventListener('input', (e) => {
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
    document.getElementById('screen-step1').classList.toggle('hidden', stepNumber !== 1);
    document.getElementById('screen-step2').classList.toggle('hidden', stepNumber !== 2);
    document.getElementById('screen-step3').classList.toggle('hidden', stepNumber !== 3);
    document.getElementById('btnTopSwitchOrg')?.classList.toggle('hidden', stepNumber !== 3);
    
    window.BladeController.closeBlade();
  },

  getOrg() {
    return document.getElementById('targetOrg').value.trim().replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '').split('/')[0] || '';
  },

  getPat() {
    return document.getElementById('targetPat').value.trim();
  },

  updateOrgPath() {
    const org = this.getOrg();
    const link = document.getElementById('generatedUrlLink');
    link.href = org ? `https://dev.azure.com/${org}` : 'javascript:void(0)';
    link.textContent = org ? `https://dev.azure.com/${org}` : 'https://dev.azure.com/';
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
    document.getElementById('validationModal').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('validationModal').classList.add('hidden');
  },

  setStatus(msg, type = 'info') {
    const bar = document.getElementById('statusBar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = `status-banner status-${type}`;
    bar.classList.remove('hidden');
  },

  setKpis(scope, l2, v2, l3, v3, l4, v4) {
    document.getElementById('kpi-1-val').textContent = scope;
    document.getElementById('kpi-2-label').textContent = l2;
    document.getElementById('kpi-2-val').textContent = v2;
    document.getElementById('kpi-3-label').textContent = l3;
    document.getElementById('kpi-3-val').textContent = v3;
    document.getElementById('kpi-4-label').textContent = l4;
    document.getElementById('kpi-4-val').textContent = v4;
  },

  async connectAndGoToStep3() {
    const org = this.getOrg();
    const pat = this.getPat();
    if (!org || !pat) return this.showModal('Please enter both Organization Name and Personal Access Token (PAT).');

    if (document.getElementById('chkRememberCreds').checked) {
      localStorage.setItem('ado_saved', 'true');
      localStorage.setItem('ado_org', org);
      localStorage.setItem('ado_pat', pat);
    }

    const btn = document.getElementById('btnConnect');
    btn.innerHTML = `
      <span class="pulse-dot pulse-blue"></span>
      Authenticating...
    `;
    btn.disabled = true;

    try {
      const auth = 'Basic ' + btoa(':' + pat);
      const data = await this.fetchAdo(org, '_apis/projects?api-version=7.1-preview.1&$top=500', auth);
      const projects = data.value || [];

      const select = document.getElementById('projectSelect');
      select.innerHTML = '<option value="">-- Choose Project --</option>' +
        projects.sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.name}">${p.name}</option>`).join('');
      select.disabled = false;

      const orgCrumb = document.getElementById('suiteBreadcrumbOrg');
      if (orgCrumb) orgCrumb.textContent = org;
      
      const connText = document.getElementById('suiteConnectionText');
      if (connText) connText.textContent = `Connected (${projects.length} Projects)`;

      document.getElementById('topBarOrgSubtitle').textContent = `Connected Endpoint: https://dev.azure.com/${org}`;
      document.getElementById('categorySelect').disabled = true;
      document.getElementById('categorySelect').value = '';
      document.getElementById('step5Container').classList.add('hidden');
      document.getElementById('mainDashboard').classList.add('hidden');

      this.goToScreen(3);
      this.setStatus(`Connected to ${org} successfully (${projects.length} projects discovered).`, 'success');
    } catch (e) {
      this.showModal(`Azure DevOps Authentication Error: ${e.message}`);
    } finally {
      btn.innerHTML = `
        Connect Workspace
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;
      btn.disabled = false;
    }
  },

  handleProjectSelect() {
    const project = document.getElementById('projectSelect').value;
    const catSelect = document.getElementById('categorySelect');
    document.getElementById('step5Container').classList.add('hidden');
    document.getElementById('mainDashboard').classList.add('hidden');

    const projCrumb = document.getElementById('suiteBreadcrumbProject');
    if (projCrumb) projCrumb.textContent = project || 'Overview';

    if (!project) {
      catSelect.disabled = true;
      catSelect.value = '';
      return;
    }

    catSelect.disabled = false;
    catSelect.value = '';
  },

  async handleCategorySelect() {
    const cat = document.getElementById('categorySelect').value;
    const project = document.getElementById('projectSelect').value;
    const step5 = document.getElementById('step5Container');
    document.getElementById('mainDashboard').classList.add('hidden');

    if (!cat) {
      step5.classList.add('hidden');
      return;
    }

    step5.classList.remove('hidden');
    ['substepRepo', 'substepAccess', 'substepActivity', 'substepPipelines', 'substepWorkItems'].forEach(id => {
      document.getElementById(id).classList.add('hidden');
    });

    if (cat === 'repositories') {
      document.getElementById('substepRepo').classList.remove('hidden');
      const repoDropdown = document.getElementById('repoSelect');
      repoDropdown.innerHTML = '<option value="">Loading repositories...</option>';
      repoDropdown.disabled = true;

      try {
        const auth = 'Basic ' + btoa(':' + this.getPat());
        const data = await this.fetchAdo(this.getOrg(), `${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1-preview.1`, auth);
        this.cachedRepos = data.value || [];
        this.cachedRepos.sort((a, b) => a.name.localeCompare(b.name));

        repoDropdown.innerHTML = '<option value="-- All Repositories --">-- All Repositories --</option>' +
          this.cachedRepos.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
        repoDropdown.disabled = false;
      } catch (err) {
        repoDropdown.innerHTML = '<option value="-- All Repositories --">-- All Repositories --</option>';
        repoDropdown.disabled = false;
      }
    } else if (cat === 'user_access') {
      document.getElementById('substepAccess').classList.remove('hidden');
    } else if (cat === 'user_activity') {
      document.getElementById('substepActivity').classList.remove('hidden');
    } else if (cat === 'pipelines') {
      document.getElementById('substepPipelines').classList.remove('hidden');
    } else if (cat === 'work_items') {
      document.getElementById('substepWorkItems').classList.remove('hidden');
    }
  },

  showDashboard(viewId) {
    document.getElementById('mainDashboard').classList.remove('hidden');
    ['view-repositories', 'view-access', 'view-activity', 'view-pipelines', 'view-workitems'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== `view-${viewId}`);
    });
  },

  async execRepoInspect() {
    try {
      this.showDashboard('repositories');
      this.setStatus('Inspecting repository branches and branch policies...', 'info');
      await window.RepoModule.inspect(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('repoSelect').value, this.cachedRepos);
      this.setStatus('Repository matrix & branch policies loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execAccessFetch() {
    try {
      this.showDashboard('access');
      await window.AccessModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetAccessUserQuery').value.trim());
      this.setStatus('Security groups & permissions loaded successfully.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execActivityFetch() {
    try {
      this.showDashboard('activity');
      this.setStatus('Scanning user activity and commit history...', 'info');
      if (!this.cachedRepos.length) {
        const auth = 'Basic ' + btoa(':' + this.getPat());
        const data = await this.fetchAdo(this.getOrg(), `${encodeURIComponent(document.getElementById('projectSelect').value)}/_apis/git/repositories?api-version=7.1-preview.1`, auth);
        this.cachedRepos = data.value || [];
      }
      await window.ActivityModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetUserQuery').value.trim(), parseInt(document.getElementById('userTimeframeDays').value, 10), this.cachedRepos);
      this.setStatus('User commit activity and PRs loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execPipelineFetch() {
    try {
      this.showDashboard('pipelines');
      this.setStatus('Fetching pipeline runs & build telemetry...', 'info');
      await window.PipelineModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('pipelineRunsTop').value);
      this.setStatus('Pipeline metrics loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execWorkItemsFetch() {
    try {
      this.showDashboard('workitems');
      this.setStatus('Querying work items with WIQL engine...', 'info');
      await window.WorkItemModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetWorkItemUser').value.trim());
      this.setStatus('Work items & backlog status loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  renderChart(labels, values, label) {
    this.currentData = { labels, values, label };
    const ctx = document.getElementById('analyticsChart').getContext('2d');
    if (this.chart) this.chart.destroy();

    const isDark = this.currentTheme === 'dark';
    const isPie = this.chartType === 'pie';

    // Vibrant High-Contrast Palette for Stakeholders
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
    if (!window.AccessModule.items || !window.AccessModule.items.length) {
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
      XLSX.writeFile(wb, `${document.getElementById('projectSelect').value || 'Project'}_Permissions.xlsx`);
    } else {
      this.exportActiveCSV();
    }
  },

  exportActiveCSV() {
    const visibleTable = document.querySelector('#mainDashboard section:not(.hidden) table');
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
  }
};

document.addEventListener('DOMContentLoaded', () => window.HubApp.init());
