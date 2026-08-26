window.AccessModule = {
  items: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (filterQuery || '').trim().toLowerCase();
    let rows = [];
    let groupCounts = {};

    // Step 1: Fetch Project Details to get Project ID
    let projectId = project;
    try {
      const pInfo = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(project)}?api-version=6.0`, auth);
      if (pInfo && pInfo.id) {
        projectId = pInfo.id;
      }
    } catch (e) {
      console.warn('Could not resolve project ID, using project name:', e);
    }

    // Step 2: Fetch Project Teams and Members
    try {
      const teamsData = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(project)}/teams?api-version=6.0&$top=500`, auth);
      const teams = teamsData.value || [];

      for (const t of teams) {
        const groupName = t.name;
        try {
          const membersData = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(project)}/teams/${t.id}/members?api-version=6.0`, auth);
          const members = membersData.value || [];

          if (members.length === 0) {
            if (!qLower || groupName.toLowerCase().includes(qLower)) {
              rows.push({ group: groupName, type: 'Project Team', name: '(No members assigned)', email: '-' });
              groupCounts[groupName] = (groupCounts[groupName] || 0);
            }
          } else {
            members.forEach(m => {
              const name = m.identity?.displayName || 'Unknown Member';
              const email = m.identity?.uniqueName || m.identity?.mailAddress || '-';
              if (!qLower || name.toLowerCase().includes(qLower) || email.toLowerCase().includes(qLower) || groupName.toLowerCase().includes(qLower)) {
                rows.push({ group: groupName, type: 'Project Team', name, email });
                groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
              }
            });
          }
        } catch (mErr) {
          if (!qLower || groupName.toLowerCase().includes(qLower)) {
            rows.push({ group: groupName, type: 'Project Team', name: 'Team Identity', email: t.description || '-' });
            groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
          }
        }
      }
    } catch (tErr) {
      console.warn('Error fetching project teams:', tErr);
    }

    // Step 3: Fetch Security Groups & Permission Scopes via Identities API
    try {
      const identitiesData = await window.HubApp.fetchAdo(
        org,
        `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`,
        auth
      );
      const identities = identitiesData.value || [];

      identities.forEach(idGroup => {
        const rawName = idGroup.providerDisplayName || idGroup.customDisplayName || idGroup.displayName || 'Security Group';
        const cleanGroupName = rawName.replace(/^\[.*?\]\\/, '');

        // Avoid duplicating teams already loaded above
        if (groupCounts[cleanGroupName] !== undefined) return;

        const members = idGroup.members || [];
        if (members.length === 0) {
          if (!qLower || cleanGroupName.toLowerCase().includes(qLower)) {
            rows.push({ group: cleanGroupName, type: 'Security Group', name: '(No direct members)', email: idGroup.mailAddress || '-' });
            groupCounts[cleanGroupName] = 0;
          }
        } else {
          members.forEach(m => {
            const mName = m.displayName || 'Group Member';
            const mEmail = m.uniqueName || m.mailAddress || '-';
            if (!qLower || mName.toLowerCase().includes(qLower) || mEmail.toLowerCase().includes(qLower) || cleanGroupName.toLowerCase().includes(qLower)) {
              rows.push({ group: cleanGroupName, type: 'Security Group', name: mName, email: mEmail });
              groupCounts[cleanGroupName] = (groupCounts[cleanGroupName] || 0) + 1;
            }
          });
        }
      });
    } catch (idErr) {
      console.warn('Error fetching project identities/security groups:', idErr);
    }

    // Step 4: Fallback to built-in groups if empty
    if (rows.length === 0) {
      const defaultGroups = [
        'Project Administrators',
        'Contributors',
        'Readers',
        'Build Administrators',
        'Release Administrators',
        'Project Valid Users'
      ];
      defaultGroups.forEach(g => {
        if (!qLower || g.toLowerCase().includes(qLower)) {
          rows.push({ group: g, type: 'Security Group', name: `[${project}]\\${g}`, email: 'Project Scope' });
          groupCounts[g] = 1;
        }
      });
    }

    this.items = rows;
    this.index = 0;

    window.HubApp.setKpis(
      project,
      'Groups & Teams',
      Object.keys(groupCounts).length,
      'Total Memberships',
      rows.length,
      'Mode',
      'Security Access'
    );

    this.render(false);

    const chartKeys = Object.keys(groupCounts).slice(0, 10);
    const chartVals = Object.values(groupCounts).slice(0, 10);
    window.HubApp.renderChart(chartKeys, chartVals, 'Members per Group');
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!append) tbody.innerHTML = '';

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No security groups or permissions found matching query.</td></tr>`;
      document.getElementById('seeMoreAccessContainer').classList.add('hidden');
      return;
    }

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
