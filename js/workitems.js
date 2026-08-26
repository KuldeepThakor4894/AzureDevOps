window.WorkItemModule = {
  items: [],
  index: 0,
  pageSize: 20,

  async fetch(org, project, pat, userQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const cleanProject = project.trim();
    const cleanUserQuery = (userQuery || '').trim();

    // 1. Construct standard WIQL Query
    let wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.CreatedDate] FROM workitems WHERE [System.TeamProject] = '${cleanProject.replace(/'/g, "''")}'`;
    if (cleanUserQuery) {
      wiql += ` AND [System.AssignedTo] CONTAINS '${cleanUserQuery.replace(/'/g, "''")}'`;
    }
    wiql += ` ORDER BY [System.CreatedDate] DESC`;

    // 2. Execute WIQL Query POST with proper headers and response validation
    let ids = [];
    try {
      const wiqlUrl = `https://dev.azure.com/${org}/${encodeURIComponent(cleanProject)}/_apis/wit/wiql?$top=100&api-version=6.0`;
      const qRes = await fetch(wiqlUrl, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: wiql })
      });

      if (!qRes.ok) {
        const errorText = await qRes.text();
        throw new Error(`HTTP ${qRes.status} (${qRes.statusText}): Please verify your PAT has "Work Items (Read)" scope.`);
      }

      const qData = await qRes.json();
      ids = (qData.workItems || []).map(w => w.id).slice(0, 100);
    } catch (wiqlErr) {
      console.warn('WIQL query error:', wiqlErr);
      throw wiqlErr;
    }

    // 3. Handle Empty Query Results
    if (!ids || ids.length === 0) {
      this.items = [];
      this.index = 0;
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
    this.items = allWorkItems.map(w => {
      const f = w.fields || {};
      const type = f['System.WorkItemType'] || 'Item';
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      // Extract assigned user display name
      let assignedName = 'Unassigned';
      if (f['System.AssignedTo']) {
        assignedName = f['System.AssignedTo'].displayName || f['System.AssignedTo'].name || f['System.AssignedTo'];
      }

      return {
        id: w.id,
        type: type,
        title: f['System.Title'] || 'Untitled Work Item',
        assigned: assignedName,
        state: f['System.State'] || 'Unknown',
        date: f['System.CreatedDate'] ? new Date(f['System.CreatedDate']).toLocaleDateString() : 'N/A'
      };
    });

    this.index = 0;

    // Update KPIs
    window.HubApp.setKpis(
      cleanUserQuery || cleanProject,
      'Total Work Items',
      this.items.length,
      'Item Types',
      Object.keys(typeCounts).length,
      'Scope',
      'Active Backlog'
    );

    this.render(false);

    // Render Chart
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    window.HubApp.renderChart(
      sortedTypes.map(t => t[0]),
      sortedTypes.map(t => t[1]),
      'Work Items by Type'
    );
  },

  render(append = false) {
    const tbody = document.getElementById('workItemsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No active work items found matching criteria.</td></tr>`;
      document.getElementById('seeMoreWorkItemsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(w => {
        let badgeClass = 'badge-blue';
        if (w.state.toLowerCase() === 'closed' || w.state.toLowerCase() === 'done') badgeClass = 'badge-active';
        if (w.state.toLowerCase() === 'active' || w.state.toLowerCase() === 'in progress') badgeClass = 'badge-stale';

        return `
          <tr>
            <td><strong>#${w.id}</strong></td>
            <td><span class="badge ${badgeClass}">${w.type}</span></td>
            <td><strong>${w.title}</strong></td>
            <td>${w.assigned}</td>
            <td><span class="badge ${badgeClass}">${w.state}</span></td>
            <td>${w.date}</td>
          </tr>
        `;
      }).join('')
    );

    const rem = this.items.length - this.index;
    const moreBtn = document.getElementById('seeMoreWorkItemsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('workItemsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  }
};
