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

  const categorySectionIds = [
    'section-repos',
    'section-pipelines',
    'section-workitems',
    'section-access',
    'section-activity'
  ];

  // Helper to extract clean organization name
  function getCleanOrgName(rawInput) {
    let org = rawInput.trim();
    org = org.replace(/^(https?:\/\/)?(dev\.azure\.com\/)/i, '')
             .replace(/^(https?:\/\/)?([\w.-]+)\.visualstudio\.com\/?/i, '$2')
             .replace(/\/+$/, '');
    return org;
  }

  // Load saved credentials from localStorage if available
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

  // Live Org URL link update
  orgUrlInput.addEventListener('input', (e) => {
    updateOrgPreview(e.target.value);
  });

  // Fetch real projects from Azure DevOps REST API
  btnLoadProjects.addEventListener('click', async () => {
    const cleanOrg = getCleanOrgName(orgUrlInput.value);
    const pat = patTokenInput.value.trim();

    if (!cleanOrg || !pat) {
      alert('Please provide both an Organization Name/URL and an Azure DevOps PAT.');
      return;
    }

    // Save or clear credentials based on checkbox
    if (rememberCredentials && rememberCredentials.checked) {
      localStorage.setItem('ado_remember', 'true');
      localStorage.setItem('ado_org', orgUrlInput.value.trim());
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
        throw new Error(`Status ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const projects = data.value || [];

      if (projects.length === 0) {
        selectProject.innerHTML = '<option value="">-- No Projects Found --</option>';
        selectProject.disabled = true;
      } else {
        // Populate dropdown with real project names sorted alphabetically
        projects.sort((a, b) => a.name.localeCompare(b.name));
        selectProject.innerHTML = '<option value="">-- Choose Project --</option>' +
          projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        selectProject.disabled = false;
      }

      // Reset subsequent controls
      selectCategory.value = '';
      selectCategory.disabled = true;
      hideAllSections();

    } catch (err) {
      console.error('Azure DevOps API Error:', err);
      alert('Failed to fetch projects. Please verify:\n1. The Organization Name is correct.\n2. The PAT has "Project and Team (Read)" permissions.\n3. Your network allows direct calls to dev.azure.com.');
    } finally {
      btnLoadProjects.textContent = 'Load Projects';
      btnLoadProjects.disabled = false;
    }
  });

  // Project Selection Handler
  selectProject.addEventListener('change', () => {
    if (selectProject.value) {
      selectCategory.disabled = false;
      selectCategory.value = '';
    } else {
      selectCategory.disabled = true;
      selectCategory.value = '';
    }
    hideAllSections();
  });

  // Category Selection Handler (Toggles visibility of specific sections)
  selectCategory.addEventListener('change', (e) => {
    const selected = e.target.value;
    const cleanOrg = getCleanOrgName(orgUrlInput.value);
    const pat = patTokenInput.value.trim();
    const project = selectProject.value;

    if (!selected) {
      hideAllSections();
      return;
    }

    // Reveal main container and hide all sub-sections
    resultsContainer.classList.remove('hidden');
    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });

    // Show only the selected category section
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

  // Dispatch data loading calls to category-specific modules
  function loadCategoryData(category, org, project, pat) {
    switch (category) {
      case 'repos':
        if (typeof loadRepositoriesModule === 'function') {
          loadRepositoriesModule(org, project, pat);
        }
        break;
      case 'pipelines':
        if (typeof loadPipelinesModule === 'function') {
          loadPipelinesModule(org, project, pat);
        }
        break;
      case 'workitems':
        if (typeof loadWorkItemsModule === 'function') {
          loadWorkItemsModule(org, project, pat);
        }
        break;
      case 'access':
        if (typeof loadAccessModule === 'function') {
          loadAccessModule(org, project, pat);
        }
        break;
      case 'activity':
        if (typeof loadActivityModule === 'function') {
          loadActivityModule(org, project, pat);
        }
        break;
    }
  }

  // Quick search filter functionality across all visible table rows
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
