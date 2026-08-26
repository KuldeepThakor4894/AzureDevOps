window.WorkItemModule = {
  items: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, userQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    let wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.CreatedDate] FROM workitems WHERE [System.TeamProject] = '${project}'`;
    if (userQuery) wiql += ` AND [System.AssignedTo] CONTAINS '${userQuery}'`;
    wiql += ` ORDER BY [System.CreatedDate] DESC`;

    const qRes = await fetch(`https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1-preview.1`, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql })
    });
    const qData = await qRes.json();
    const ids = (qData.workItems || []).slice(0, 100).map(w => w.id);

    if (!ids.length) {
      this.items = [];
      this.render(false);
      window.HubApp.setKpis(userQuery || project, 'Work Items', 0, 'Types', 0, 'Mode', 'WIQL Query');
      return;
    }

    const dData = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.1-preview.1`, auth);
    let types = {};

    this.items = (dData.value || []).map(w => {
      const t = w.fields['System.WorkItemType'] || 'Item';
      types[t] = (types[t] || 0) + 1;
      return {
        id: w.id,
        type: t,
        title: w.fields['System.Title'] || '',
        assigned: w.fields['System.AssignedTo']?.displayName || 'Unassigned',
        state: w.fields['System.State'] || 'Unknown',
        date: new Date(w.fields['System.CreatedDate']).toLocaleDateString()
      };
    });

    this.index = 0;
    window.HubApp.setKpis(userQuery || project, 'Work Items', this.items.length, 'Types', Object.keys(types).length, 'Mode', 'WIQL Query');
    this.render(false);
    window.HubApp.renderChart(Object.keys(types), Object.values(types), 'Work Items by Type');
  },

  render(append = false) {
    const tbody = document.getElementById('workItemsTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(w => `
      <tr>
        <td><strong>#${w.id}</strong></td>
        <td><span class="badge badge-blue">${w.type}</span></td>
        <td>${w.title}</td>
        <td>${w.assigned}</td>
        <td>${w.state}</td>
        <td>${w.date}</td>
      </tr>
    `).join(''));

    const rem = this.items.length - this.index;
    document.getElementById('seeMoreWorkItemsContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('workItemsRemainingCount').textContent = rem;
  }
};
