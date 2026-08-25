document.addEventListener('DOMContentLoaded', () => {
  const orgUrlInput = document.getElementById('orgUrl');
  const patTokenInput = document.getElementById('patToken');
  const btnLoadProjects = document.getElementById('btnLoadProjects');
  const selectProject = document.getElementById('selectProject');
  const selectCategory = document.getElementById('selectCategory');
  const selectSubItem = document.getElementById('selectSubItem');
  const subSelectLabel = document.getElementById('subSelectLabel');
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

  function getCleanOrg(raw) {
    return raw.trim()
      .replace(/^(https?:\/\/)?(dev\.azure\.com\/)/i, '')
      .replace(/^(https?:\/\/)?([\w.-]+)\.visualstudio\.com\/?/i, '$2')
      .replace(/\/+$/, '');
  }

  async function adoFetch(endpoint) {
    const org = getCleanOrg(orgUrlInput.value);
    const pat = patTokenInput.value.trim();
    const res = await fetch(`https://dev.azure.com/${org}/${endpoint}`, {
      headers: {
        'Authorization': 'Basic ' + btoa(':' + pat),
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  // Load Saved Credentials
  if (localStorage.getItem('ado_remember') === 'true') {
    if (rememberCredentials) rememberCredentials.checked = true;
    orgUrlInput.value = localStorage.getItem('ado_org') || '';
    patTokenInput.value = localStorage.getItem('ado_pat') || '';
  }

  // 1 & 2. Load Projects
  btnLoadProjects.addEventListener('click', async () => {
    clearStatus();
    hideAllSections();
    const org = getCleanOrg(orgUrlInput.value);
    const pat = patTokenInput.value.trim();

    if (!org || !pat) {
      showStatus('Please enter both Organization Name and Azure DevOps PAT.', true);
      return;
    }

    if (rememberCredentials && rememberCredentials.checked) {
      localStorage.setItem('ado_remember', 'true');
      localStorage.setItem('ado_org', org);
      localStorage.setItem('ado_pat', pat);
    }

    btnLoadProjects.textContent = 'Loading...';
    btnLoadProjects.disabled = true;

    try {
      const data = await adoFetch('_apis/projects?api-version=6.0');
      const projects = data.value || [];
      projects.sort((a, b) => a.name.localeCompare(b.name));

      selectProject.innerHTML = '<option value="">-- Choose Project --</option>' +
        projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
      
      selectProject.disabled = false;
      selectCategory.disabled = true;
      selectCategory.value = '';
      resetSubSelect();
      showStatus(`Loaded ${projects.length} projects successfully.`);
    } catch (err) {
      showStatus(`Failed to load projects: ${err.message}`, true);
    } finally {
      btnLoadProjects.textContent = 'Load Projects';
      btnLoadProjects.disabled = false;
    }
  });

  // 3. Project Selection
  selectProject.addEventListener('change', () => {
    clearStatus();
    hideAllSections();
    resetSubSelect();
    if (selectProject.value) {
      selectCategory.disabled = false;
      selectCategory.value = '';
    } else {
      selectCategory.disabled = true;
      selectCategory.value = '';
    }
  });

  // 4. Category Selection -> Fetches and populates 5. Select Item
  selectCategory.addEventListener('change', async () => {
    clearStatus();
    hideAllSections();
    const category = selectCategory.value;
    const project = encodeURIComponent(selectProject.value);

    if (!category) {
      resetSubSelect();
      return;
    }

    selectSubItem.disabled = true;
    selectSubItem.innerHTML = '<option value="">Loading options...</option>';

    try {
      if (category === 'repos') {
        subSelectLabel.textContent = '5. SELECT REPOSITORY *';
        const res = await adoFetch(`${project}/_apis/git/repositories?api-version=6.0`);
        const repos = res.value || [];
        selectSubItem.innerHTML = '<option value="">-- Choose Repository --</option>' +
          repos.map(r => `<option value="${r.id}" data-name="${r.name}">${r.name}</option>`).join('');
        selectSubItem.disabled = false;

      } else if (category === 'pipelines') {
        subSelectLabel.textContent = '5. SELECT PIPELINE *';
        const res = await adoFetch(`${project}/_apis/pipelines?api-version=6.0-preview.1`);
        const pipes = res.value || [];
        selectSubItem.innerHTML = '<option value="ALL">-- All Pipelines --</option>' +
          pipes.map(p => `<option value="${p.id}" data-name="${p.name}">${p.name}</option>`).join('');
        selectSubItem.disabled = false;

      } else if (category === 'workitems') {
        subSelectLabel.textContent = '5. SELECT WORK ITEM SCOPE *';
        selectSubItem.innerHTML = `
          <option value="">-- Select Query --</option>
          <option value="recent">Recently Created (Top 50)</option>
          <option value="active">Active & In Progress</option>
        `;
        selectSubItem.disabled = false;

      } else if (category === 'access' || category === 'activity') {
        // Direct views without secondary select
        subSelectLabel.textContent = '5. VIEW SCOPE';
        selectSubItem.innerHTML = '<option value="ALL">Entire Project Scope</option>';
        selectSubItem.disabled = false;
        triggerDataLoad();
      }
    } catch (err) {
      showStatus(`Failed to load items for ${category}: ${err.message}`, true);
      resetSubSelect();
    }
  });

  // 5. Item Selection -> Displays table and loads data
  selectSubItem.addEventListener('change', triggerDataLoad);

  function triggerDataLoad() {
    const category = selectCategory.value;
    const subValue = selectSubItem.value;

    if (!subValue) {
      hideAllSections();
      return;
    }

    // Display main results container and corresponding section
    resultsContainer.classList.remove('hidden');
    categorySectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) section.classList.add('hidden');
    });

    const activeSec = document.getElementById(`section-${category}`);
    if (activeSec) activeSec.classList.remove('hidden');

    loadActiveData(category, subValue);
  }

  async function loadActiveData(category, subValue) {
    const project = encodeURIComponent(selectProject.value);

    try {
      if (category === 'repos') {
        const repoName = selectSubItem.selectedOptions[0].getAttribute('data-name');
        
        // Fetch Branches
        const branchData = await adoFetch(`${project}/_apis/git/repositories/${subValue}/stats/branches?api-version=6.0`);
        const branchList = branchData.value || [];
        const bTbody = document.getElementById('branchTableBody');
        
        bTbody.innerHTML = branchList.length ? branchList.map(b => `
          <tr>
            <td><strong>${repoName}</strong></td>
            <td>${b.name}</td>
            <td>${b.isBaseVersion ? 'Default' : 'Active'}</td>
            <td>${b.commit?.author?.name || '-'}</td>
            <td>${b.commit?.author?.date ? new Date(b.commit.author.date).toLocaleDateString() : '-'}</td>
            <td>${b.commit?.comment || '-'}</td>
          </tr>
        `).join('') : `<tr><td colspan="6" class="empty-state">No active branches found.</td></tr>`;

        // Fetch PRs
        const prData = await adoFetch(`${project}/_apis/git/repositories/${subValue}/pullrequests?searchCriteria.status=all&api-version=6.0`);
        const prList = prData.value || [];
        const prTbody = document.getElementById('prTableBody');

        prTbody.innerHTML = prList.length ? prList.map(pr => `
          <tr>
            <td>${repoName}</td>
            <td>#${pr.pullRequestId}: ${pr.title}</td>
            <td>${pr.sourceRefName?.replace('refs/heads/', '')} → ${pr.targetRefName?.replace('refs/heads/', '')}</td>
            <td>${pr.createdBy?.displayName || '-'}</td>
            <td><span class="badge">${pr.status}</span></td>
            <td>${new Date(pr.creationDate).toLocaleDateString()}</td>
          </tr>
        `).join('') : `<tr><td colspan="6" class="empty-state">No Pull Requests found.</td></tr>`;

      } else if (category === 'pipelines') {
        const runsUrl = subValue === 'ALL' 
          ? `${project}/_apis/build/builds?api-version=6.0&$top=25`
          : `${project}/_apis/build/builds?definitions=${subValue}&api-version=6.0&$top=25`;

        const runData = await adoFetch(runsUrl);
        const runs = runData.value || [];
        const runTbody = document.getElementById('buildRunsTableBody');

        runTbody.innerHTML = runs.length ? runs.map(r => `
          <tr>
            <td>${r.definition?.name || '-'}</td>
            <td>${r.buildNumber}</td>
            <td>${r.sourceBranch?.replace('refs/heads/', '') || '-'}</td>
            <td>${r.reason || 'manual'}</td>
            <td>${r.requestedFor?.displayName || '-'}</td>
            <td>${r.result || r.status}</td>
            <td>${r.finishTime ? new Date(r.finishTime).toLocaleString() : 'Running/Pending'}</td>
          </tr>
        `).join('') : `<tr><td colspan="7" class="empty-state">No pipeline runs recorded.</td></tr>`;

      } else if (category === 'workitems') {
        const wiql = { query: `Select [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.ChangedDate] From WorkItems Where [System.TeamProject] = '${selectProject.value}' order by [System.ChangedDate] desc` };
        const org = getCleanOrg(orgUrlInput.value);
        const pat = patTokenInput.value.trim();

        const queryRes = await fetch(`https://dev.azure.com/${org}/${project}/_apis/wit/wiql?api-version=6.0&$top=20`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(':' + pat),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(wiql)
        });
        const queryJson = await queryRes.json();
        const ids = (queryJson.workItems || []).map(i => i.id).slice(0, 20);

        const wTbody = document.getElementById('workItemsTableBody');
        if (!ids.length) {
          wTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No work items found.</td></tr>`;
          return;
        }

        const details = await adoFetch(`${project}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=6.0`);
        const items = details.value || [];

        wTbody.innerHTML = items.map(w => `
          <tr>
            <td><strong>#${w.id}</strong></td>
            <td>${w.fields['System.Title']}</td>
            <td>${w.fields['System.WorkItemType']}</td>
            <td>${w.fields['System.State']}</td>
            <td>${w.fields['System.AssignedTo']?.displayName || 'Unassigned'}</td>
            <td>${new Date(w.fields['System.ChangedDate']).toLocaleDateString()}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      showStatus(`Error loading details: ${err.message}`, true);
    }
  }

  function resetSubSelect() {
    subSelectLabel.textContent = '5. SELECT ITEM *';
    selectSubItem.innerHTML = '<option value="">-- Select Category first --</option>';
    selectSubItem.disabled = true;
  }

  function hideAllSections() {
    resultsContainer.classList.add('hidden');
    categorySectionIds.forEach(id => {
      const sec = document.getElementById(id);
      if (sec) sec.classList.add('hidden');
    });
  }

  // Quick search filter across rows
  if (quickFilterInput) {
    quickFilterInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const visibleRows = resultsContainer.querySelectorAll('div:not(.hidden) tbody tr');
      visibleRows.forEach(row => {
        if (row.classList.contains('empty-state')) return;
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });
  }
});
