// Azure DevOps Intelligence Hub - Work Items & Backlog Module
window.WorkItemModule = {
  items: [],
  allItems: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',
  currentPat: '',
  currentUserQuery: '',
  searchTerm: '',
  filterType: 'all',
  filterStatus: 'all',
  eventsBound: false,

  initEvents() {
    if (this.eventsBound) return;
    this.eventsBound = true;

    document.getElementById('workItemsSearchInput')?.addEventListener('input', (e) => {
      this.searchTerm = (e.target.value || '').trim().toLowerCase();
      this.filterAndRender();
    });

    document.getElementById('wiTypeFilter')?.addEventListener('change', (e) => {
      this.filterType = e.target.value || 'all';
      this.filterAndRender();
    });

    document.getElementById('wiStatusFilter')?.addEventListener('change', (e) => {
      this.filterStatus = e.target.value || 'all';
      this.filterAndRender();
    });

    document.getElementById('wiProjectSelect')?.addEventListener('change', (e) => {
      const topSelect = document.getElementById('projectSelect');
      if (topSelect && topSelect.value !== e.target.value) {
        topSelect.value = e.target.value;
        window.HubApp.handleProjectSelect();
      }
    });

    document.getElementById('btnRefreshWorkItems')?.addEventListener('click', () => {
      this.refreshCurrent();
    });

    document.getElementById('btnMoreWorkItems')?.addEventListener('click', () => {
      this.render(true);
    });

    document.getElementById('targetWorkItemUser')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.refreshCurrent();
      }
    });
  },

  refreshCurrent() {
    const org = window.HubApp.getOrg();
    const project = document.getElementById('projectSelect')?.value || '';
    const pat = window.HubApp.getPat();
    const userQuery = document.getElementById('targetWorkItemUser')?.value || '';
    if (org && project && pat) {
      this.fetch(org, project, pat, userQuery);
    }
  },

  syncProjectDropdowns(project) {
    const el = document.getElementById('wiProjectSelect');
    const topSelect = document.getElementById('projectSelect');
    if (el && topSelect) {
      el.innerHTML = topSelect.innerHTML;
      el.value = project;
    }
  },

  async fetch(org, project, pat, userQuery) {
    this.currentOrg = org;
    this.currentProject = project;
    this.currentPat = pat;
    this.currentUserQuery = userQuery;
    const auth = 'Basic ' + btoa(':' + pat);
    const cleanProject = project.trim();
    const cleanUserQuery = (userQuery || '').trim();

    this.initEvents();
    this.syncProjectDropdowns(project);

    // 1. Construct WIQL Query with Fallback
    let wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.CreatedDate], [System.ChangedDate], [System.IterationPath] FROM WorkItems WHERE [System.TeamProject] = @project`;
    if (cleanUserQuery) {
      wiql += ` AND [System.AssignedTo] CONTAINS '${cleanUserQuery.replace(/'/g, "''")}'`;
    }
    wiql += ` ORDER BY [System.ChangedDate] DESC`;

    // 2. Execute WIQL Query POST
    let ids = [];
    try {
      const wiqlUrl = `https://dev.azure.com/${org}/${encodeURIComponent(cleanProject)}/_apis/wit/wiql?$top=100&api-version=6.0`;
      let qRes = await fetch(wiqlUrl, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: wiql })
      });

      if (!qRes.ok) {
        let fallbackWiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${cleanProject.replace(/'/g, "''")}'`;
        if (cleanUserQuery) {
          fallbackWiql += ` AND [System.AssignedTo] CONTAINS '${cleanUserQuery.replace(/'/g, "''")}'`;
        }
        fallbackWiql += ` ORDER BY [System.ChangedDate] DESC`;

        qRes = await fetch(wiqlUrl, {
          method: 'POST',
          headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: fallbackWiql })
        });
      }

      if (qRes.ok) {
        const qData = await qRes.json();
        ids = (qData.workItems || []).map(w => w.id).slice(0, 100);
      }
    } catch (wiqlErr) {
      console.warn('WIQL query error:', wiqlErr);
    }

    // 3. Handle Empty Query Results
    if (!ids || ids.length === 0) {
      this.allItems = [];
      this.items = [];
      this.index = 0;
      this.updateSummaryCards([]);
      this.render(false);
      window.HubApp.setKpis(cleanUserQuery || cleanProject, 'Work Items', 0, 'Types', 0, 'Mode', 'WIQL Query');
      window.HubApp.renderChart(['No Items'], [0], 'Work Items by Type');
      return;
    }

    // 4. Batch Fetch Work Item Details in chunks of 50
    let allWorkItems = [];
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkIds = ids.slice(i, i + chunkSize);
      try {
        const detailsData = await window.HubApp.fetchAdo(
          org,
          `${encodeURIComponent(cleanProject)}/_apis/wit/workitems?ids=${chunkIds.join(',')}&$expand=all&api-version=6.0`,
          auth
        );
        allWorkItems = allWorkItems.concat(detailsData.value || []);
      } catch (detErr) {
        console.warn('Work items batch detail error:', detErr);
      }
    }

    // 5. Process Work Item Fields & Type Distribution
    let typeCounts = {};
    this.allItems = allWorkItems.map(w => {
      const f = w.fields || {};
      const type = f['System.WorkItemType'] || 'Item';
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      let assignedName = 'Unassigned';
      let assignedEmail = '';
      if (f['System.AssignedTo']) {
        assignedName = f['System.AssignedTo'].displayName || f['System.AssignedTo'].name || f['System.AssignedTo'];
        assignedEmail = f['System.AssignedTo'].uniqueName || f['System.AssignedTo'].mailAddress || '';
      }

      const priorityVal = f['Microsoft.VSTS.Common.Priority'] !== undefined ? f['Microsoft.VSTS.Common.Priority'] : null;
      const areaPath = f['System.AreaPath'] || cleanProject;
      const iterationPath = f['System.IterationPath'] || cleanProject;
      const createdDate = f['System.CreatedDate'] ? new Date(f['System.CreatedDate']).toLocaleDateString() : 'â€”';
      const updatedDate = f['System.ChangedDate'] ? new Date(f['System.ChangedDate']).toLocaleDateString() : 'â€”';
      const dueDateRaw = f['Microsoft.VSTS.Scheduling.DueDate'] || f['Custom.DueDate'];
      const dueDate = dueDateRaw ? new Date(dueDateRaw).toLocaleDateString() : 'Not Available';

      const stateRaw = f['System.State'] || 'Unknown';
      const tags = (f['System.Tags'] || '').toLowerCase();
      const isBlocked = stateRaw.toLowerCase() === 'blocked' ||
                        f['Microsoft.VSTS.CMMI.Blocked'] === 'Yes' ||
                        tags.includes('blocked') ||
                        (f['System.Title'] || '').toLowerCase().includes('[blocked]');

      return {
        id: w.id,
        type: type,
        title: f['System.Title'] || 'Untitled Work Item',
        assigned: assignedName,
        assignedEmail: assignedEmail,
        isAssigned: assignedName !== 'Unassigned',
        state: stateRaw,
        isBlocked: isBlocked,
        priority: priorityVal,
        areaPath: areaPath,
        iterationPath: iterationPath,
        createdDate: createdDate,
        updatedDate: updatedDate,
        dueDate: dueDate,
        url: w._links?.html?.href || `https://dev.azure.com/${org}/${encodeURIComponent(cleanProject)}/_workitems/edit/${w.id}`,
        rawWorkItem: w
      };
    });

    this.items = this.allItems;
    this.index = 0;

    // Update 6 Dynamic Summary Cards
    this.updateSummaryCards(this.allItems);

    // Update KPIs
    window.HubApp.setKpis(
      cleanUserQuery || cleanProject,
      'Total Work Items',
      this.allItems.length,
      'Item Types',
      Object.keys(typeCounts).length,
      'Query Engine',
      'WIQL Scope'
    );

    this.filterAndRender();

    // Render chart
    window.HubApp.renderChart(Object.keys(typeCounts), Object.values(typeCounts), 'Work Items by Category / Type');
  },

  updateSummaryCards(items) {
    let totalCount = items.length;
    let assignedCount = 0;
    let newCount = 0;
    let activeCount = 0;
    let resolvedCount = 0;
    let closedCount = 0;
    let blockedCount = 0;

    items.forEach(item => {
      if (item.isAssigned) assignedCount++;
      const s = (item.state || '').toLowerCase();
      if (item.isBlocked || s === 'blocked') {
        blockedCount++;
      }
      if (s === 'new' || s === 'to do' || s === 'proposed') {
        newCount++;
      } else if (s === 'active' || s === 'in progress' || s === 'doing' || s === 'committed') {
        activeCount++;
      } else if (s === 'resolved' || s === 'ready for review') {
        resolvedCount++;
      } else if (s === 'closed' || s === 'done' || s === 'completed' || s === 'removed') {
        closedCount++;
      }
    });

    const elTotal = document.getElementById('wiValTotal');
    if (elTotal) elTotal.textContent = totalCount;
    const elChipAssigned = document.getElementById('wiChipAssigned');
    if (elChipAssigned) elChipAssigned.textContent = `${assignedCount} Assigned`;

    const elNew = document.getElementById('wiValNew');
    if (elNew) elNew.textContent = newCount;
    const elChipNew = document.getElementById('wiChipNew');
    if (elChipNew) elChipNew.textContent = `${newCount} In Backlog`;

    const elActive = document.getElementById('wiValActive');
    if (elActive) elActive.textContent = activeCount;
    const elChipActive = document.getElementById('wiChipActive');
    if (elChipActive) elChipActive.textContent = `${activeCount} In Dev`;

    const elResolved = document.getElementById('wiValResolved');
    if (elResolved) elResolved.textContent = resolvedCount;
    const elChipResolved = document.getElementById('wiChipResolved');
    if (elChipResolved) elChipResolved.textContent = `${resolvedCount} Resolved`;

    const elClosed = document.getElementById('wiValClosed');
    if (elClosed) elClosed.textContent = closedCount;
    const elChipClosed = document.getElementById('wiChipClosed');
    if (elChipClosed) elChipClosed.textContent = `${closedCount} Closed`;

    const elBlocked = document.getElementById('wiValBlocked');
    if (elBlocked) elBlocked.textContent = blockedCount;
    const elChipBlocked = document.getElementById('wiChipBlocked');
    if (elChipBlocked) elChipBlocked.textContent = `${blockedCount} Blocked`;

    const elLastUpd = document.getElementById('wiLastUpdatedText');
    if (elLastUpd) elLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;
  },

  filterAndRender() {
    let list = this.allItems;

    if (this.filterType && this.filterType !== 'all') {
      const ft = this.filterType.toLowerCase();
      list = list.filter(w => (w.type || '').toLowerCase().includes(ft));
    }

    if (this.filterStatus && this.filterStatus !== 'all') {
      const fs = this.filterStatus.toLowerCase();
      if (fs === 'blocked') {
        list = list.filter(w => w.isBlocked || (w.state || '').toLowerCase() === 'blocked');
      } else {
        list = list.filter(w => (w.state || '').toLowerCase().includes(fs));
      }
    }

    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(w => {
        return (
          String(w.id).toLowerCase().includes(q) ||
          (w.title && w.title.toLowerCase().includes(q)) ||
          (w.type && w.type.toLowerCase().includes(q)) ||
          (w.assigned && w.assigned.toLowerCase().includes(q)) ||
          (w.state && w.state.toLowerCase().includes(q)) ||
          (w.areaPath && w.areaPath.toLowerCase().includes(q)) ||
          (w.iterationPath && w.iterationPath.toLowerCase().includes(q))
        );
      });
    }

    this.items = list;
    this.index = 0;
    this.render(false);
  },

  getTypeBadge(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('bug')) {
      return `<span class="badge badge-failed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>Bug</span>`;
    } else if (t.includes('epic')) {
      return `<span class="badge badge-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>Epic</span>`;
    } else if (t.includes('feature')) {
      return `<span class="badge badge-inprogress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Feature</span>`;
    } else if (t.includes('task')) {
      return `<span class="badge badge-active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>Task</span>`;
    }
    return `<span class="badge badge-blue">${type}</span>`;
  },

  getStateBadge(state, isBlocked) {
    if (isBlocked) {
      return `<span class="badge badge-failed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>Blocked</span>`;
    }
    const s = (state || '').toLowerCase();
    if (s.includes('active') || s.includes('progress') || s.includes('doing') || s.includes('committed')) {
      return `<span class="badge badge-inprogress">${state}</span>`;
    } else if (s.includes('closed') || s.includes('done') || s.includes('resolved') || s.includes('completed')) {
      return `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>${state}</span>`;
    } else if (s.includes('new') || s.includes('to do') || s.includes('proposed')) {
      return `<span class="badge badge-blue">${state}</span>`;
    }
    return `<span class="badge badge-canceled">${state}</span>`;
  },

  getPriorityBadge(priority) {
    if (priority === null || priority === undefined) return '<span style="color:var(--text-muted);">&mdash;</span>';
    const p = Number(priority);
    if (p === 1) {
      return `<span class="badge badge-failed" style="font-weight:700;">P1</span>`;
    } else if (p === 2) {
      return `<span class="badge badge-orange" style="font-weight:700;">P2</span>`;
    } else if (p === 3) {
      return `<span class="badge badge-blue" style="font-weight:600;">P3</span>`;
    } else if (p >= 4) {
      return `<span class="badge badge-canceled">P${p}</span>`;
    }
    return `<span>${priority}</span>`;
  },

  render(append = false) {
    const tbody = document.getElementById('workItemsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const statsEl = document.getElementById('workItemsTableStats');
    if (statsEl) {
      statsEl.textContent = `${this.items.length} items`;
    }

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="padding: 36px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 28px; height: 28px; margin: 0 auto 10px; display: block; color: var(--azure-blue); opacity: 0.6;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        No work items found matching the current query.
      </td></tr>`;
      document.getElementById('seeMoreWorkItemsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);

    slice.forEach((w, localIdx) => {
      const globalIdx = this.index + localIdx;
      const tr = document.createElement('tr');
      tr.title = 'Click to inspect Work Item Blade in Azure Boards format';
      tr.innerHTML = `
        <td><a href="${w.url}" target="_blank" rel="noopener noreferrer" class="commit-hash-link"><code>#${w.id}</code></a></td>
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${w.title}"><strong>${w.title}</strong></td>
        <td>${this.getTypeBadge(w.type)}</td>
        <td>${w.assigned}</td>
        <td>${this.getStateBadge(w.state, w.isBlocked)}</td>
        <td>${this.getPriorityBadge(w.priority)}</td>
        <td><code>${w.areaPath}</code></td>
        <td><code>${w.iterationPath}</code></td>
        <td style="font-size:12px; color:var(--text-muted); white-space:nowrap;">${w.createdDate}</td>
        <td style="font-size:12px; color:var(--text-muted); white-space:nowrap;">${w.updatedDate}</td>
        <td style="font-size:12px; color:var(--text-muted); white-space:nowrap;">${w.dueDate}</td>
      `;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        this.openWorkItemBlade(globalIdx);
      });
      tbody.appendChild(tr);
    });

    this.index += slice.length;

    const rem = this.items.length - this.index;
    const moreBtn = document.getElementById('seeMoreWorkItemsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('workItemsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  openWorkItemBlade(itemIdx) {
    const w = this.items[itemIdx];
    if (!w) return;

    window.BladeController.openBlade({
      title: `#${w.id}: ${w.title}`,
      subtitle: `Azure Boards Backlog & Work Item Telemetry`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Boards > #${w.id}`,
      adoUrl: w.url,
      rawData: w.rawWorkItem,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Work Item Backlog Details
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">WORK ITEM ID</span>
                <span class="blade-kv-value"><code>#${w.id}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">WORK ITEM TYPE</span>
                <span class="blade-kv-value">${this.getTypeBadge(w.type)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">STATE / STATUS</span>
                <span class="blade-kv-value">${this.getStateBadge(w.state, w.isBlocked)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">PRIORITY</span>
                <span class="blade-kv-value">${this.getPriorityBadge(w.priority)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">ASSIGNED TO</span>
                <span class="blade-kv-value">${w.assigned} ${w.assignedEmail ? '(' + w.assignedEmail + ')' : ''}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AREA PATH</span>
                <span class="blade-kv-value"><code>${w.areaPath}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">ITERATION PATH</span>
                <span class="blade-kv-value"><code>${w.iterationPath}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">CREATION DATE</span>
                <span class="blade-kv-value">${w.createdDate}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">LAST UPDATED</span>
                <span class="blade-kv-value">${w.updatedDate}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">DUE DATE</span>
                <span class="blade-kv-value">${w.dueDate}</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">TITLE / SUMMARY</span>
                <span class="blade-kv-value" style="font-size:13.5px; font-weight:600; color:var(--text-main); margin-top:2px;">${w.title}</span>
              </div>
            </div>
          </div>
        `
      }
    });
  }
};