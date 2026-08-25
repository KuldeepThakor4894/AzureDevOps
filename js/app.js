document.addEventListener('DOMContentLoaded', () => {
  const orgUrlInput = document.getElementById('orgUrl');
  const patTokenInput = document.getElementById('patToken');
  const btnLoadProjects = document.getElementById('btnLoadProjects');
  const selectProject = document.getElementById('selectProject');
  const selectCategory = document.getElementById('selectCategory');
  const activeDevOpsPath = document.getElementById('activeDevOpsPath');
  const resultsContainer = document.getElementById('resultsContainer');
  const quickFilterInput = document.getElementById('quickFilterInput');

  const categorySectionIds = [
    'section-repos',
    'section-pipelines',
    'section-workitems',
    'section-access',
    'section-activity'
  ];

  // Update Org link live
  orgUrlInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.startsWith('http://') || val.startsWith('https://')) {
      activeDevOpsPath.href = val;
      activeDevOpsPath.textContent = val;
    } else if (val) {
      activeDevOpsPath.href = `https://dev.azure.com/${val}`;
      activeDevOpsPath.textContent = `https://dev.azure.com/${val}`;
    } else {
      activeDevOpsPath.href = 'https://dev.azure.com/';
      activeDevOpsPath.textContent = 'https://dev.azure.com/';
    }
  });

  // Handle Loading Projects
  btnLoadProjects.addEventListener('click', async () => {
    const org = orgUrlInput.value.trim();
    const pat = patTokenInput.value.trim();

    if (!org || !pat) {
      alert('Please fill both Organization URL/Name and Azure DevOps PAT.');
      return;
    }

    btnLoadProjects.textContent = 'Loading...';
    btnLoadProjects.disabled = true;

    try {
      // Example Azure DevOps API integration:
      // const orgName = org.replace('https://dev.azure.com/', '').replace('/', '');
      // const res = await fetch(`https://dev.azure.com/${orgName}/_apis/projects?api-version=6.0`, {
      //   headers: { 'Authorization': 'Basic ' + btoa(':' + pat) }
      // });
      // const data = await res.json();

      // Mock population for demonstration:
      selectProject.innerHTML = `
        <option value="">-- Choose Project --</option>
        <option value="DemoProject1">DemoProject1</option>
        <option value="DemoProject2">DemoProject2</option>
      `;
      selectProject.disabled = false;
      
      hideAllSections();
      selectCategory.value = '';
      selectCategory.disabled = true;

    } catch (err) {
      console.error('Failed to load projects:', err);
      alert('Failed to load projects. Please verify your credentials and network.');
    } finally {
      btnLoadProjects.textContent = 'Load Projects';
      btnLoadProjects.disabled = false;
    }
  });

  // Project Selection Handler
  selectProject.addEventListener('change', () => {
    if (selectProject.value) {
      selectCategory.disabled = false;
    } else {
      selectCategory.disabled = true;
      selectCategory.value = '';
      hideAllSections();
    }
  });

  // Category Selection Handler (Toggles visibility of specific sections)
  selectCategory.addEventListener('change', (e) => {
    const selected = e.target.value;

    if (!selected) {
      hideAllSections();
      return;
    }

    // Show container
    resultsContainer.classList.remove('hidden');

    // Hide all category subsections first
    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });

    // Display the matching section
    const activeSection = document.getElementById(`section-${selected}`);
    if (activeSection) {
      activeSection.classList.remove('hidden');
      loadCategoryData(selected, selectProject.value);
    }
  });

  function hideAllSections() {
    resultsContainer.classList.add('hidden');
    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });
  }

  function loadCategoryData(category, project) {
    switch (category) {
      case 'repos':
        if (typeof loadRepositoriesModule === 'function') loadRepositoriesModule(project);
        break;
      case 'pipelines':
        if (typeof loadPipelinesModule === 'function') loadPipelinesModule(project);
        break;
      case 'workitems':
        if (typeof loadWorkItemsModule === 'function') loadWorkItemsModule(project);
        break;
      case 'access':
        if (typeof loadAccessModule === 'function') loadAccessModule(project);
        break;
      case 'activity':
        if (typeof loadActivityModule === 'function') loadActivityModule(project);
        break;
    }
  }

  // Quick search filter functionality across visible rows
  quickFilterInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const visibleTables = resultsContainer.querySelectorAll('div:not(.hidden) tbody tr');
    
    visibleTables.forEach(row => {
      if (row.classList.contains('empty-state')) return;
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  });
});
