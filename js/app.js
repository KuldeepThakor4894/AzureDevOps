document.addEventListener('DOMContentLoaded', () => {
  const orgUrlInput = document.getElementById('orgUrl');
  const patTokenInput = document.getElementById('patToken');
  const btnLoadProjects = document.getElementById('btnLoadProjects');
  const selectProject = document.getElementById('selectProject');
  const selectCategory = document.getElementById('selectCategory');
  const activeDevOpsPath = document.getElementById('activeDevOpsPath');
  const resultsContainer = document.getElementById('resultsContainer');
  const quickFilterInput = document.getElementById('quickFilterInput');
  const rememberCredentials = document.getElementById('rememberCredentials');
  const statusBanner = document.getElementById('statusBanner');

  const categorySectionIds = [
    'section-repos',
    'section-pipelines',
    'section-workitems',
    'section-access',
    'section-activity'
  ];

  function showStatus(msg, isError = false) {
    if (!statusBanner) return;
    statusBanner.textContent = msg;
    statusBanner.className = `status-banner ${isError ? 'status-error' : 'status-success'}`;
    statusBanner.classList.remove('hidden');
  }

  function clearStatus() {
    if (statusBanner) {
      statusBanner.textContent = '';
      statusBanner.classList.add('hidden');
    }
  }

  function getCleanOrgName(rawInput) {
    let org = rawInput.trim();
    org = org.replace(/^(https?:\/\/)?(dev\.azure\.com\/)/i, '')
             .replace(/^(https?:\/\/)?([\w.-]+)\.visualstudio\.com\/?/i, '$2')
             .replace(/\/+$/, '');
    return org;
  }

  // Load saved credentials
  if (localStorage.getItem('ado_remember') === 'true') {
    if (rememberCredentials) rememberCredentials.checked = true;
    orgUrlInput.value = localStorage.getItem('ado_org') || '';
    patTokenInput.value = localStorage.getItem('ado_pat') || '';
    updateOrgPreview(orgUrlInput.value);
  }

  function updateOrgPreview(val) {
    const cleanOrg = getCleanOrgName(val);
    if (cleanOrg) {
      activeDevOpsPath.href = `https://dev.azure.com/${cleanOrg}`;
      activeDevOpsPath.textContent = `https://dev.azure.com/${cleanOrg}`;
    } else {
      activeDevOpsPath.href = 'https://dev.azure.com/';
      activeDevOpsPath.textContent = 'https://dev.azure.com/';
    }
  }

  orgUrlInput.addEventListener('input', (e) => {
    updateOrgPreview(e.target.value);
  });

  // Handle Load Projects
  btnLoadProjects.addEventListener('click', async () => {
    clearStatus();
    const cleanOrg = getCleanOrgName(orgUrlInput.value);
    const pat = patTokenInput.value.trim();

    if (!cleanOrg || !pat) {
      showStatus('Please enter both Organization Name and Azure DevOps PAT.', true);
      return;
    }

    if (rememberCredentials && rememberCredentials.checked) {
      localStorage.setItem('ado_remember', 'true');
      localStorage.setItem('ado_org', cleanOrg);
      localStorage.setItem('ado_pat', pat);
    } else {
      localStorage.removeItem('ado_remember');
      localStorage.removeItem('ado_org');
      localStorage.removeItem('ado_pat');
    }

    btnLoadProjects.textContent = 'Loading...';
    btnLoadProjects.disabled = true;

    try {
      const apiUrl = `https://dev.azure.com/${cleanOrg}/_apis/projects?api-version=6.0`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + btoa(':' + pat),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText}). Check Organization and PAT permissions.`);
      }

      const data = await response.json();
      const projects = data.value || [];

      if (projects.length === 0) {
        selectProject.innerHTML = '<option value="">-- No Projects Found --</option>';
        selectProject.disabled = true;
        showStatus('No projects found in this organization.', true);
      } else {
        projects.sort((a, b) => a.name.localeCompare(b.name));
        selectProject.innerHTML = '<option value="">-- Select Project --</option>' +
          projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        selectProject.disabled = false;
        showStatus(`Successfully loaded ${projects.length} project(s).`);
      }

      selectCategory.value = '';
      selectCategory.disabled = true;
      hideAllSections();

    } catch (err) {
      console.error('Project fetch error:', err);
      selectProject.innerHTML = '<option value="">-- Load Failed --</option>';
      selectProject.disabled = true;
      showStatus(`Failed to load projects: ${err.message}. If running locally, check browser CORS restrictions.`, true);
    } finally {
      btnLoadProjects.textContent = 'Load Projects';
      btnLoadProjects.disabled = false;
    }
  });

  // Project Selection Handler
  selectProject.addEventListener('change', () => {
    clearStatus();
    if (selectProject.value) {
      selectCategory.disabled = false;
      selectCategory.value = '';
    } else {
      selectCategory.disabled = true;
      selectCategory.value = '';
    }
    hideAllSections();
  });

  // Category Selection Handler
  selectCategory.addEventListener('change', (e) => {
    const selected = e.target.value;
    const cleanOrg = getCleanOrgName(orgUrlInput.value);
    const pat = patTokenInput.value.trim();
    const project = selectProject.value;

    if (!selected) {
      hideAllSections();
      return;
    }

    resultsContainer.classList.remove('hidden');

    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });

    const activeSection = document.getElementById(`section-${selected}`);
    if (activeSection) {
      activeSection.classList.remove('hidden');
      loadCategoryData(selected, cleanOrg, project, pat);
    }
  });

  function hideAllSections() {
    resultsContainer.classList.add('hidden');
    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });
  }

  function loadCategoryData(category, org, project, pat) {
    if (category === 'repos' && typeof loadRepositoriesModule === 'function') {
      loadRepositoriesModule(org, project, pat);
    } else if (category === 'pipelines' && typeof loadPipelinesModule === 'function') {
      loadPipelinesModule(org, project, pat);
    } else if (category === 'workitems' && typeof loadWorkItemsModule === 'function') {
      loadWorkItemsModule(org, project, pat);
    } else if (category === 'access' && typeof loadAccessModule === 'function') {
      loadAccessModule(org, project, pat);
    } else if (category === 'activity' && typeof loadActivityModule === 'function') {
      loadActivityModule(org, project, pat);
    }
  }

  if (quickFilterInput) {
    quickFilterInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const visibleRows = resultsContainer.querySelectorAll('div:not(.hidden) tbody tr');
      
      visibleRows.forEach(row => {
        if (row.classList.contains('empty-state')) return;
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
      });
    });
  }
});
