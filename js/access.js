window.AccessModule = {
  items: [],
  index: 0,
  pageSize: 25,

  determineGroupRole(groupName, parentGroups = '') {
    const name = groupName.toLowerCase();
    const parents = parentGroups.toLowerCase();
    if (name.includes('project administrators') || name.includes('admin') || parents.includes('project administrators')) return 'Admin';
    if (name.includes('reader') || parents.includes('readers')) return 'Reader';
    return 'Other';
  },

  determineParentGroups(groupName, isTeam = false) {
    const name = groupName.toLowerCase();
    if (name.includes('project administrators')) {
      return 'Endpoint Administrators, Endpoint Creators, Project Valid Users';
    }
    if (name.includes('build administrators')) {
      return 'Project Valid Users, Readers';
    }
    if (name.includes('readers')) {
      return 'Project Valid Users';
    }
    if (name.includes('endpoint')) {
      return 'Project Valid Users';
    }
    if (name.includes('deployment') || isTeam || name.includes('team') || name.includes('contributor') || name.includes('reviewer')) {
      return 'Contributors, Project Valid Users';
    }
    return 'Project Valid Users';
  },

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (filterQuery || '').trim().toLowerCase();
    let rows = [];
    let groupCounts = {};
    const processedKeys = new Set();
    const discoveredGroups = new Map();

    const addRow = (groupName, parentGroups, userDisplayName, mailAddress, isVirtual = false) => {
      const cleanGroup = groupName.replace(/^\[.*?\]\\/, '').trim();
      const groupPrincipal = `[${project}]\\${cleanGroup}`;
      const groupRole = this.determineGroupRole(cleanGroup, parentGroups);
      const uniqueKey = `${project}__${cleanGroup}__${userDisplayName}__${mailAddress}`.toLowerCase();

      if (processedKeys.has(uniqueKey)) return;
      processedKeys.add(uniqueKey);

      // Filtering check
      const matchesSearch = !qLower ||
        cleanGroup.toLowerCase().includes(qLower) ||
        userDisplayName.toLowerCase().includes(qLower) ||
        mailAddress.toLowerCase().includes(qLower) ||
        groupRole.toLowerCase().includes(qLower);

      if (matchesSearch) {
        rows.push({
          projectName: project,
          groupName: cleanGroup,
          groupPrincipal: groupPrincipal,
          groupRole: groupRole,
          parentGroups: parentGroups,
          userDisplayName: userDisplayName,
          mailAddress: mailAddress
        });

        if (!isVirtual && userDisplayName && !userDisplayName.startsWith('(')) {
          groupCounts[cleanGroup] = (groupCounts[cleanGroup] || 0) + 1;
        } else if (groupCounts[cleanGroup] === undefined) {
          groupCounts[cleanGroup] = 0;
        }
      }
    };

    // 1. If Searching by a User Name/Email: Resolve User's Explicit & Inherited Memberships First
    if (qLower) {
      try {
        const userLookupUrl = `_apis/identities?searchFilter=GeneralScope&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`;
        const userData = await window.HubApp.fetchAdo(org, userLookupUrl, auth).catch(() => ({ value: [] }));
        const matchedUsers = userData.value || [];

        matchedUsers.forEach(u => {
          const uName = u.displayName || u.customDisplayName || u.providerDisplayName || '';
          const uEmail = u.mailAddress || u.uniqueName || '';

          // Look through expanded parent memberOf groups
          const memberOf = u.memberOf || [];
          memberOf.forEach(grpDesc => {
            const grpNameRaw = typeof grpDesc === 'string' ? grpDesc : (grpDesc.displayName || grpDesc.providerDisplayName || '');
            if (grpNameRaw && (grpNameRaw.includes(`[${project}]`) || !grpNameRaw.includes('['))) {
              const cleanGrpName = grpNameRaw.replace(/^\[.*?\]\\/, '').trim();
              const parentGroups = this.determineParentGroups(cleanGrpName);
              addRow(cleanGrpName, parentGroups, uName, uEmail, false);
            }
          });
        });
      } catch (uErr) {
        console.warn('Direct user membership expansion notice:', uErr);
      }
    }

    // 2. Fetch Project Teams and Members
    try {
      const teamsData = await window.HubApp.fetchAdo(
        org,
        `_apis/projects/${encodeURIComponent(project)}/teams?api-version=6.0&$top=1000`,
        auth
      );
      const teams = teamsData.value || [];

      await Promise.all(teams.map(async (t) => {
        const cleanName = t.name.trim();
        discoveredGroups.set(cleanName, { isTeam: true, raw: t.name });
        if (groupCounts[cleanName] === undefined) groupCounts[cleanName] = 0;

        const parentGroups = this.determineParentGroups(cleanName, true);

        try {
          const membersData = await window.HubApp.fetchAdo(
            org,
            `_apis/projects/${encodeURIComponent(project)}/teams/${t.id}/members?api-version=6.0&$top=1000`,
            auth
          );
          const members = membersData.value || [];

          if (members.length === 0) {
            if (!qLower) addRow(cleanName, parentGroups, '(No members assigned)', '', true);
          } else {
            members.forEach(m => {
              const displayName = m.identity?.displayName || 'Unknown Member';
              const email = m.identity?.uniqueName || m.identity?.mailAddress || '';
              addRow(cleanName, parentGroups, displayName, email, false);
            });
          }
        } catch (mErr) {
          if (!qLower) addRow(cleanName, parentGroups, '(Team Active)', '', true);
        }
      }));
    } catch (err) {
      console.warn('Teams discovery warning:', err);
    }

    // 3. Discover Project-Scoped Groups & Expanded Memberships
    const identityQueryFilters = [
      `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`,
      `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`
    ];

    for (const url of identityQueryFilters) {
      try {
        const idData = await window.HubApp.fetchAdo(org, url, auth).catch(() => ({ value: [] }));
        const identities = idData.value || [];

        identities.forEach(grp => {
          const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
          if (!rawName) return;

          const cleanName = rawName.replace(/^\[.*?\]\\/, '').trim();
          if (!cleanName || cleanName === project) return;

          discoveredGroups.set(cleanName, { isTeam: false, raw: rawName });
          if (groupCounts[cleanName] === undefined) groupCounts[cleanName] = 0;

          const parentGroups = this.determineParentGroups(cleanName);
          const members = grp.members || [];

          if (members.length === 0) {
            if (!qLower) addRow(cleanName, parentGroups, '(No direct members)', '', true);
          } else {
            members.forEach(m => {
              const displayName = m.displayName || 'Security Principal';
              const email = m.uniqueName || m.mailAddress || '';
              addRow(cleanName, parentGroups, displayName, email, false);
            });
          }
        });
      } catch (idErr) {
        console.warn('Dynamic identities discovery warning:', idErr);
      }
    }

    // 4. Scan & Deep-Expand Standard Security Groups (Project Administrators, Build Administrators, Contributors, etc.)
    const defaultSecurityGroupPrototypes = [
      'Project Administrators',
      'Contributors',
      'Readers',
      'Build Administrators',
      'Release Administrators',
      'Deployment Group Administrators',
      'Endpoint Administrators',
      'Endpoint Creators',
      'Project Valid Users'
    ];

    await Promise.all(
      defaultSecurityGroupPrototypes.map(async (grpName) => {
        if (!discoveredGroups.has(grpName)) {
          discoveredGroups.set(grpName, { isTeam: false, raw: grpName });
        }
        if (groupCounts[grpName] === undefined) groupCounts[grpName] = 0;

        const parentGroups = this.determineParentGroups(grpName);

        try {
          const qUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(project)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
          const res = await window.HubApp.fetchAdo(org, qUrl, auth);
          const list = res.value || [];

          if (list.length > 0 && list[0].members?.length > 0) {
            list[0].members.forEach(m => {
              addRow(grpName, parentGroups, m.displayName || 'Member', m.uniqueName || m.mailAddress || '', false);
            });
          } else if (!qLower) {
            const existsInRows = rows.some(r => r.groupName.toLowerCase() === grpName.toLowerCase());
            if (!existsInRows) {
              addRow(grpName, parentGroups, '(No direct members)', '', true);
            }
          }
        } catch (e) {
          if (!qLower) {
            const existsInRows = rows.some(r => r.groupName.toLowerCase() === grpName.toLowerCase());
            if (!existsInRows) {
              addRow(grpName, parentGroups, '(No direct members)', '', true);
            }
          }
        }
      })
    );

    // Sort to match Excel order
    rows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.userDisplayName.localeCompare(b.userDisplayName));

    this.items = rows;
    this.index = 0;

    const matchedGroupsCount = Object.keys(groupCounts).filter(k => groupCounts[k] > 0).length || Object.keys(groupCounts).length;
    const totalMappingsCount = rows.filter(r => !r.userDisplayName.startsWith('(')).length || rows.length;

    window.HubApp.setKpis(
      filterQuery ? `${project} (${filterQuery})` : project,
      'Total Groups',
      matchedGroupsCount,
      'Total Mappings',
      totalMappingsCount,
      'Scope',
      'Project Permissions'
    );

    this.render(false);

    // Chart filtered groups with memberships
    const sortedGroups = Object.entries(groupCounts)
      .filter(([_, count]) => (qLower ? count > 0 : true))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const chartKeys = sortedGroups.map(i => i[0]);
    const chartVals = sortedGroups.map(i => i[1]);

    window.HubApp.renderChart(
      chartKeys.length ? chartKeys : ['No Groups'],
      chartVals.length ? chartVals : [0],
      'Memberships per Group'
    );
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!append) tbody.innerHTML = '';

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No project permissions found matching criteria.</td></tr>`;
      document.getElementById('seeMoreAccessContainer').classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(row => {
        let badgeClass = 'badge-active';
        if (row.groupRole === 'Admin') badgeClass = 'badge-stale';
        if (row.groupRole === 'Reader') badgeClass = 'badge-blue';

        return `
          <tr>
            <td><strong>${row.projectName}</strong></td>
            <td><strong>${row.groupName}</strong></td>
            <td><code>${row.groupPrincipal}</code></td>
            <td><span class="badge ${badgeClass}">${row.groupRole}</span></td>
            <td><span class="subtext">${row.parentGroups}</span></td>
            <td>${row.userDisplayName}</td>
            <td>${row.mailAddress ? `<code>${row.mailAddress}</code>` : '-'}</td>
          </tr>
        `;
      }).join('')
    );

    const rem = this.items.length - this.index;
    document.getElementById('seeMoreAccessContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('accessRemainingCount').textContent = rem;
  }
};
