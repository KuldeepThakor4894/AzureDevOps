window.AccessModule = {
  items: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (filterQuery || '').trim().toLowerCase();
    let rows = [];
    let groupCounts = {};
    const processedGroupKeys = new Set();

    const addEntry = (groupName, type, memberName, memberEmail) => {
      const cleanGroup = groupName.replace(/^\[.*?\]\\/, '').trim();
      const gKey = `${cleanGroup}__${memberName}__${memberEmail}`.toLowerCase();
      
      if (processedGroupKeys.has(gKey)) return;
      processedGroupKeys.add(gKey);

      if (!qLower || 
          cleanGroup.toLowerCase().includes(qLower) || 
          memberName.toLowerCase().includes(qLower) || 
          memberEmail.toLowerCase().includes(qLower) ||
          type.toLowerCase().includes(qLower)) {
        
        rows.push({
          group: cleanGroup,
          type: type,
          name: memberName,
          email: memberEmail
        });
        groupCounts[cleanGroup] = (groupCounts[cleanGroup] || 0) + (memberName.startsWith('(') ? 0 : 1);
      }
    };

    // 1. Fetch All Project Teams and Members
    try {
      const teamsData = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(project)}/teams?api-version=7.1-preview.1&$top=1000`, auth);
      const teams = teamsData.value || [];

      await Promise.all(teams.map(async (t) => {
        try {
          const membersData = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(project)}/teams/${t.id}/members?api-version=7.1-preview.1&$top=1000`, auth);
          const members = membersData.value || [];

          if (members.length === 0) {
            addEntry(t.name, 'Project Team', '(No active members)', '-');
          } else {
            members.forEach(m => {
              const name = m.identity?.displayName || 'Team Member';
              const email = m.identity?.uniqueName || m.identity?.mailAddress || '-';
              addEntry(t.name, 'Project Team', name, email);
            });
          }
        } catch (e) {
          addEntry(t.name, 'Project Team', '(Team configured)', t.description || '-');
        }
      }));
    } catch (e) {
      console.warn('Teams fetch error:', e);
    }

    // 2. Fetch All Project-Scoped Security Groups & Custom Groups via Identities API
    try {
      const idSearchUrls = [
        `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`,
        `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`
      ];

      for (const url of idSearchUrls) {
        try {
          const idData = await window.HubApp.fetchAdo(org, url, auth);
          const identities = idData.value || [];

          identities.forEach(grp => {
            const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
            if (!rawName) return;

            const cleanName = rawName.replace(/^\[.*?\]\\/, '').trim();
            const members = grp.members || [];

            if (members.length === 0) {
              addEntry(cleanName, 'Security Group', '(No direct members)', grp.mailAddress || '-');
            } else {
              members.forEach(m => {
                const mName = m.displayName || 'Security Principal';
                const mEmail = m.uniqueName || m.mailAddress || '-';
                addEntry(cleanName, 'Security Group', mName, mEmail);
              });
            }
          });
        } catch (err) {
          console.warn('Identities query fallback:', err);
        }
      }
    } catch (e) {
      console.warn('Identities fetch error:', e);
    }

    // 3. Scan & Expand All Standard Built-in Azure DevOps Project Security Groups
    const standardProjectSecurityGroups = [
      'Project Administrators',
      'Contributors',
      'Readers',
      'Build Administrators',
      'Release Administrators',
      'Project Valid Users',
      'Deployment Group Administrators',
      'Endpoint Administrators',
      'Endpoint Creators',
      'Project-Scoped Service Connections'
    ];

    await Promise.all(standardProjectSecurityGroups.map(async (grpName) => {
      try {
        const queryUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(project)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
        const res = await window.HubApp.fetchAdo(org, queryUrl, auth);
        const list = res.value || [];

        if (list.length > 0) {
          list.forEach(item => {
            const mems = item.members || [];
            if (mems.length === 0) {
              addEntry(grpName, 'Built-in Group', '(No members assigned)', '-');
            } else {
              mems.forEach(m => {
                addEntry(grpName, 'Built-in Group', m.displayName || 'Member', m.uniqueName || m.mailAddress || '-');
              });
            }
          });
        } else {
          // If group exists with 0 expanded identities
          addEntry(grpName, 'Built-in Group', '(Default Project Scope)', `[${project}]\\${grpName}`);
        }
      } catch (e) {
        addEntry(grpName, 'Built-in Group', '(Default Project Scope)', `[${project}]\\${grpName}`);
      }
    }));

    // Sort alphabetically by Group Name
    rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

    this.items = rows;
    this.index = 0;

    window.HubApp.setKpis(
      project,
      'Total Groups & Teams',
      Object.keys(groupCounts).length,
      'Total Mappings',
      rows.length,
      'Scope',
      'All Project Permissions'
    );

    this.render(false);

    // Chart top groups by member volume
    const sortedGroups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
    const chartKeys = sortedGroups.slice(0, 12).map(item => item[0]);
    const chartVals = sortedGroups.slice(0, 12).map(item => item[1]);
    window.HubApp.renderChart(chartKeys, chartVals, 'Members / Principals per Group');
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!append) tbody.innerHTML = '';

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No security groups or permissions found matching criteria.</td></tr>`;
      document.getElementById('seeMoreAccessContainer').classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(a => {
      let badgeClass = 'badge-blue';
      if (a.type === 'Built-in Group') badgeClass = 'badge-stale';
      if (a.type === 'Project Team') badgeClass = 'badge-active';

      return `
        <tr>
          <td><strong>${a.group}</strong></td>
          <td><span class="badge ${badgeClass}">${a.type}</span></td>
          <td>${a.name}</td>
          <td><code>${a.email}</code></td>
        </tr>
      `;
    }).join(''));

    const rem = this.items.length - this.index;
    document.getElementById('seeMoreAccessContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('accessRemainingCount').textContent = rem;
  }
};
