window.AccessModule = {
  items: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    let rows = [];
    let groupCounts = {};

    // 1. Graph Security Groups
    try {
      const gData = await window.HubApp.fetchAdo(org, `_apis/graph/groups?api-version=7.1-preview.1`, auth);
      for (const g of (gData.value || [])) {
        if (g.principalName && !g.principalName.includes(`[${project}]`)) continue;
        const memData = await window.HubApp.fetchAdo(org, `_apis/graph/Memberships/${g.descriptor}?direction=down&api-version=7.1-preview.1`, auth).catch(() => ({ value: [] }));
        
        if (!memData.value?.length) {
          if (!filterQuery || g.displayName.toLowerCase().includes(filterQuery)) {
            rows.push({ group: g.displayName, type: 'Security Group', name: '(No direct members)', email: '-' });
            groupCounts[g.displayName] = 0;
          }
        } else {
          for (const m of memData.value) {
            const u = await window.HubApp.fetchAdo(org, `_apis/graph/users/${m.memberDescriptor}?api-version=7.1-preview.1`, auth).catch(() => null);
            const name = u?.displayName || 'Group Member';
            const email = u?.mailAddress || u?.principalName || '-';
            if (!filterQuery || name.toLowerCase().includes(filterQuery) || email.toLowerCase().includes(filterQuery) || g.displayName.toLowerCase().includes(filterQuery)) {
              rows.push({ group: g.displayName, type: 'Security Group', name, email });
              groupCounts[g.displayName] = (groupCounts[g.displayName] || 0) + 1;
            }
          }
        }
      }
    } catch (e) { console.warn(e); }

    // 2. Teams
    try {
      const tData = await window.HubApp.fetchAdo(org, `_apis/projects/${project}/teams?api-version=7.1-preview.1`, auth);
      for (const t of (tData.value || [])) {
        const mData = await window.HubApp.fetchAdo(org, `_apis/projects/${project}/teams/${t.id}/members?api-version=7.1-preview.1`, auth);
        (mData.value || []).forEach(m => {
          const name = m.identity?.displayName || 'Team Member';
          const email = m.identity?.uniqueName || '-';
          if (!filterQuery || name.toLowerCase().includes(filterQuery) || email.toLowerCase().includes(filterQuery) || t.name.toLowerCase().includes(filterQuery)) {
            rows.push({ group: t.name, type: 'Project Team', name, email });
            groupCounts[t.name] = (groupCounts[t.name] || 0) + 1;
          }
        });
      }
    } catch (e) { console.warn(e); }

    this.items = rows;
    this.index = 0;

    window.HubApp.setKpis(project, 'Groups & Teams', Object.keys(groupCounts).length, 'Total Memberships', rows.length, 'Mode', 'Security Access');
    this.render(false);
    window.HubApp.renderChart(Object.keys(groupCounts).slice(0, 10), Object.values(groupCounts).slice(0, 10), 'Members per Group');
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(a => `
      <tr>
        <td><strong>${a.group}</strong></td>
        <td><span class="badge ${a.type === 'Security Group' ? 'badge-blue' : 'badge-active'}">${a.type}</span></td>
        <td>${a.name}</td>
        <td><code>${a.email}</code></td>
      </tr>
    `).join(''));

    const rem = this.items.length - this.index;
    document.getElementById('seeMoreAccessContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('accessRemainingCount').textContent = rem;
  }
};
