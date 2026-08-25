window.HubApp = {
  chart: null,
  cachedRepos: [],
  chartType: 'bar',
  currentData: { labels: [], values: [], label: '' },

  init() {
    this.bindEvents();
    if (localStorage.getItem('ado_saved') === 'true') {
      document.getElementById('chkRememberCreds').checked = true;
      document.getElementById('targetOrg').value = localStorage.getItem('ado_org') || '';
      document.getElementById('targetPat').value = localStorage.getItem('ado_pat') || '';
      this.updateOrgPath();
    }
  },

  bindEvents() {
    const self = this;
    document.getElementById('targetOrg').addEventListener('input', () => self.updateOrgPath());
    document.getElementById('btnLoadProjects').addEventListener('click', () => self.loadProjects());
    document.getElementById('projectSelect').addEventListener('change', () => self.handleProjectSelect());
    document.getElementById('categorySelect').addEventListener('change', () => self.handleCategorySelect());
    document.getElementById('btnModalClose').addEventListener('click', () => self.closeModal());

    // Step 5 Trigger Actions
    document.getElementById('btnInspectRepo').addEventListener('click', () => self.execRepoInspect());
    document.getElementById('btnFetchAccess').addEventListener('click', () => self.execAccessFetch());
    document.getElementById('btnFetchActivity').addEventListener('click', () => self.execActivityFetch());
    document.getElementById('btnFetchPipelines').addEventListener('click', () => self.execPipelineFetch());
    document.getElementById('btnFetchWorkItems').addEventListener('click', () => self.execWorkItemsFetch());

    // Pagination Click Listeners
    document.getElementById('btnMoreRepos').addEventListener('click', () => window.RepoModule.renderBranches(true));
    document.getElementById('btnMorePrs').addEventListener('click', () => window.RepoModule.renderPrs(true));
    document.getElementById('btnMoreAccess').addEventListener('click', () => window.AccessModule.render(true));
    document.getElementById('btnMoreCommits').addEventListener('click', () => window.ActivityModule.render(true));
    document.getElementById('btnMorePipelines').addEventListener('click', () => window.PipelineModule.render(true));
    document.getElementById('btnMoreWorkItems').addEventListener('click', () => window.WorkItemModule.render(true));

    // Chart Switchers
    document.querySelectorAll('.btn-chart').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-chart').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        self.chartType = e.target.dataset.chart;
        self.renderChart(self.currentData.labels, self.currentData.values, self.currentData.label);
      });
    });

    // Search filter
    document.getElementById('tableFilterInput').addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('#mainDashboard tbody tr').forEach(r => {
        r.style.display = r.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });

    // CSV Export
    document.getElementById('btnExportCSV').addEventListener('click', () => self.exportActiveCSV());
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
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' }
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

  async loadProjects() {
    const org = this.getOrg();
    const pat = this.getPat();
    if (!org || !pat) return this.showModal('Please provide both Organization Name and PAT.');

    if (document.getElementById('chkRememberCreds').checked) {
      localStorage.setItem('ado_saved', 'true');
      localStorage.setItem('ado_org', org);
      localStorage.setItem('ado_pat', pat);
    }

    const btn = document.getElementById('btnLoadProjects');
    btn.textContent = 'Loading...';
    btn.disabled = true;

    try {
      const auth = 'Basic ' + btoa(':' + pat);
      const data = await this.fetchAdo(org, '_apis/projects?api-version=7.1-preview.1&$top=500', auth);
      const projects = data.value || [];

      const select = document.getElementById('projectSelect');
      select.innerHTML = '<option value="">-- Choose Project --</option>' +
        projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
      select.disabled = false;

      document.getElementById('categorySelect').disabled = true;
      document.getElementById('categorySelect').value = '';
      document.getElementById('step5Container').classList.add('hidden');
      document.getElementById('mainDashboard').classList.add('hidden');
      this.setStatus(`Loaded ${projects.length} projects successfully.`, 'success');
    } catch (e) {
      this.setStatus(`Error loading projects: ${e.message}`, 'error');
    } finally {
      btn.textContent = 'Load Projects';
      btn.disabled = false;
    }
  },

  async handleProjectSelect() {
    const project = document.getElementById('projectSelect').value;
    const catSelect = document.getElementById('categorySelect');
    document.getElementById('step5Container').classList.add('hidden');
    document.getElementById('mainDashboard').classList.add('hidden');

    if (!project) {
      catSelect.disabled = true;
      catSelect.value = '';
      return;
    }

    catSelect.disabled = false;
    catSelect.value = '';

    // Prefetch Repos
    const auth = 'Basic ' + btoa(':' + this.getPat());
    try {
      const data = await this.fetchAdo(this.getOrg(), `${project}/_apis/git/repositories?api-version=7.1-preview.1`, auth);
      this.cachedRepos = data.value || [];
    } catch (e) { this.cachedRepos = []; }
  },

  handleCategorySelect() {
    const cat = document.getElementById('categorySelect').value;
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
      const list = document.getElementById('repoDatalist');
      list.innerHTML = '<option value="-- All Repositories --"></option>' +
        this.cachedRepos.map(r => `<option value="${r.name}"></option>`).join('');
      document.getElementById('repoSelect').value = '-- All Repositories --';
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
      this.setStatus('Inspecting repository branches and PRs...', 'info');
      await window.RepoModule.inspect(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('repoSelect').value, this.cachedRepos);
      this.setStatus('Loaded repository matrix.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execAccessFetch() {
    try {
      this.showDashboard('access');
      this.setStatus('Scanning security groups...', 'info');
      await window.AccessModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetAccessUserQuery').value.trim());
      this.setStatus('Security permissions loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execActivityFetch() {
    try {
      this.showDashboard('activity');
      this.setStatus('Scanning activity & commits...', 'info');
      await window.ActivityModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetUserQuery').value.trim(), parseInt(document.getElementById('userTimeframeDays').value, 10), this.cachedRepos);
      this.setStatus('User activity loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execPipelineFetch() {
    try {
      this.showDashboard('pipelines');
      this.setStatus('Fetching pipeline runs...', 'info');
      await window.PipelineModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('pipelineRunsTop').value);
      this.setStatus('Pipeline metrics loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  async execWorkItemsFetch() {
    try {
      this.showDashboard('workitems');
      this.setStatus('Querying work items...', 'info');
      await window.WorkItemModule.fetch(this.getOrg(), document.getElementById('projectSelect').value, this.getPat(), document.getElementById('targetWorkItemUser').value.trim());
      this.setStatus('Work items loaded.', 'success');
    } catch (e) { this.setStatus(e.message, 'error'); }
  },

  renderChart(labels, values, label) {
    this.currentData = { labels, values, label };
    const ctx = document.getElementById('analyticsChart').getContext('2d');
    if (this.chart) this.chart.destroy();

    const isPie = this.chartType === 'pie';
    this.chart = new Chart(ctx, {
      type: this.chartType,
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          label,
          data: values.length ? values : [0],
          backgroundColor: isPie ? ['#2563eb', '#16a34a', '#9333ea', '#f59e0b', '#ec4899'] : '#2563eb',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: isPie } }
      }
    });
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
    a.download = `ADO_Export_${Date.now()}.csv`;
    a.click();
  }
};

document.addEventListener('DOMContentLoaded', () => window.HubApp.init());
