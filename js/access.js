window.AccessModule = {
  allItems: [],
  filteredItems: [],
  index: 0,
  pageSize: 25,

  determineGroupRole(groupName) {
    const name = groupName.toLowerCase();
    if (name.includes('project administrators') || name.includes('admin') || name.includes('build administrators')) return 'Admin';
    if (name.includes('reader')) return 'Reader';
    return 'Contributor';
  },

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const cleanProject = project ? project.trim() : '';
    const qLower = (filterQuery || '').trim().toLowerCase();

    let allProjectGroups = new Map(); // cleanName -> { rawName, members: [] }
    let projectGroupCounts = {};      // cleanName -> count (for chart)
    let userAssignedRows = [];
    const processedUserKeys = new Set();

    // 1. Fetch All Teams for Selected Project
    try {
      const teamsData = await window.HubApp.fetchAdo(
        org,
        `_apis/projects/${encodeURIComponent(cleanProject)}/teams?api-version=6.0&$top=500`,
        auth
      );
      const teams = teamsData.value || [];

      await Promise.all(teams.map(async (t) => {
        const cleanName = t.name.trim();
        allProjectGroups.set(cleanName, { raw: t.name, members: [] });
        projectGroupCounts[cleanName] = 0;

        try {
          const membersData = await window.HubApp.fetchAdo(
            org,
            `_apis/projects/${encodeURIComponent(cleanProject)}/teams/${t.id}/members?api-version=6.0&$top=500`,
            auth
          );
          const members = membersData.value || [];

          members.forEach(m => {
            const displayName = m.identity?.displayName || 'Unknown Member';
            const email = m.identity?.uniqueName || m.identity?.mailAddress || '';
            allProjectGroups.get(cleanName).members.push({ displayName, email });
          });
        } catch (e) { }
      }));
    } catch (e) {
      console.warn('Teams fetch error:', e);
    }

    // 2. Fetch Project Identities & Security Groups
    const idUrls = [
      `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`,
      `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`
    ];

    for (const u of idUrls) {
      try {
        const idData = await window.HubApp.fetchAdo(org, u, auth).catch(() => ({ value: [] }));
        const identities = idData.value || [];

        identities.forEach(grp => {
          const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
          const cleanName = rawName.replace(/^\[.*?\]\\/, '').replace(/^\[.*?\]/, '').trim();
          if (!cleanName || cleanName === cleanProject) return;

          if (!allProjectGroups.has(cleanName)) {
            allProjectGroups.set(cleanName, { raw: rawName, members: [] });
            projectGroupCounts[cleanName] = 0;
          }

          const members = grp.members || [];
          members.forEach(m => {
            const displayName = m.displayName || m.providerDisplayName || m.customDisplayName || '';
            const email = m.uniqueName || m.mailAddress || '';
            allProjectGroups.get(cleanName).members.push({ displayName, email });
          });
        });
      } catch (e) { }
    }

    // 3. Scan Built-in Security Groups
    const standardGroups = [
      'Build Administrators',
      'Project Administrators',
      'Contributors',
      'Readers',
      'Release Administrators',
      'Deployment Group Administrators',
      'Endpoint Administrators',
      'Endpoint Creators',
      'Project Valid Users'
    ];

    await Promise.all(standardGroups.map(async (grpName) => {
      if (!allProjectGroups.has(grpName)) {
        allProjectGroups.set(grpName, { raw: grpName, members: [] });
        projectGroupCounts[grpName] = 0;
      }

      try {
        const qUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
        const res = await window.HubApp.fetchAdo(org, qUrl, auth);
        const list = res.value || [];

        if (list.length > 0 && list[0].members?.length > 0) {
          list[0].members.forEach(m => {
            const displayName = m.displayName || m.providerDisplayName || '';
            const email = m.uniqueName || m.mailAddress || '';
            allProjectGroups.get(grpName).members.push({ displayName, email });
          });
        }
      } catch (e) { }
    }));

    // 4. Match and Map Assigned User Roles
    allProjectGroups.forEach((groupObj, groupName) => {
      const role = this.determineGroupRole(groupName);

      groupObj.members.forEach(member => {
        const dName = member.displayName || '';
        const email = member.email || '';

        const isUserMatch = !qLower ||
          dName.toLowerCase().includes(qLower) ||
          email.toLowerCase().includes(qLower) ||
          groupName.toLowerCase().includes(qLower);

        if (isUserMatch) {
          const rowKey = `${cleanProject}__${groupName}__${dName}__${email}`.toLowerCase();
          if (!processedUserKeys.has(rowKey)) {
            processedUserKeys.add(rowKey);
            userAssignedRows.push({
              project: cleanProject,
              groupName: groupName,
              role: role,
              userDisplayName: dName,
              mailAddress: email
            });
            projectGroupCounts[groupName] = (projectGroupCounts[groupName] || 0) + 1;
          }
        }
      });
    });

    // Sort matching reference layout
    userAssignedRows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.userDisplayName.localeCompare(b.userDisplayName));

    this.filteredItems = userAssignedRows;
    this.index = 0;

    // Set 4 KPI values exactly matching screenshot
    window.HubApp.setKpis(
      filterQuery || cleanProject,
      'SECURITY GROUPS',
      allProjectGroups.size,
      'ASSIGNED ROLES/MEMBERS',
      userAssignedRows.length,
      'MODE',
      'Security Matrix'
    );

    this.render(false);

    // Chart: All groups along the X-axis, bar height 1.0/count for assigned groups
    const chartKeys = Array.from(allProjectGroups.keys());
    const chartVals = chartKeys.map(gName => projectGroupCounts[gName] || 0);

    window.HubApp.renderChart(chartKeys, chartVals, 'Assigned Security Groups');
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.filteredItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No matching security group assignments found.</td></tr>`;
      document.getElementById('seeMoreAccessContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.filteredItems.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(row => {
        let roleBadgeClass = 'badge-active';
        if (row.role === 'Admin') roleBadgeClass = 'badge-danger';
        if (row.role === 'Reader') roleBadgeClass = 'badge-blue';

        return `
          <tr>
            <td><strong>${row.project}</strong></td>
            <td><strong>${row.groupName}</strong></td>
            <td><span class="badge ${roleBadgeClass}">${row.role}</span></td>
            <td>${row.userDisplayName}</td>
            <td>${row.mailAddress ? `<code>${row.mailAddress}</code>` : '-'}</td>
          </tr>
        `;
      }).join('')
    );

    const rem = this.filteredItems.length - this.index;
    const moreBtn = document.getElementById('seeMoreAccessContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      document.getElementById('accessRemainingCount').textContent = rem;
    }
  }
};
