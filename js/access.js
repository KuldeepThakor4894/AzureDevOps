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
    const cleanProject = project.trim();

    const addRow = (groupName, parentGroups, userDisplayName, mailAddress, isVirtual = false) => {
      const cleanGroup = groupName.replace(/^\[.*?\]\\/, '').trim();
      if (!cleanGroup || cleanGroup === cleanProject) return;

      const groupPrincipal = `[${cleanProject}]\\${cleanGroup}`;
      const groupRole = this.determineGroupRole(cleanGroup, parentGroups);
      const uniqueKey = `${cleanProject}__${cleanGroup}__${userDisplayName}__${mailAddress}`.toLowerCase();

      if (processedKeys.has(uniqueKey)) return;
      processedKeys.add(uniqueKey);

      const matchesSearch = !qLower ||
        cleanGroup.toLowerCase().includes(qLower) ||
        userDisplayName.toLowerCase().includes(qLower) ||
        mailAddress.toLowerCase().includes(qLower) ||
        groupRole.toLowerCase().includes(qLower);

      if (matchesSearch) {
        rows.push({
          projectName: cleanProject,
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

    // 1. Resolve User Directly via Identities API if Search Term is Provided
    if (qLower) {
      try {
        const userQueryUrls = [
          `_apis/identities?searchFilter=GeneralScope&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`,
          `_apis/identities?searchFilter=AccountName&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`
        ];

        let matchedIdentities = [];
        for (const uUrl of userQueryUrls) {
          const res = await window.HubApp.fetchAdo(org, uUrl, auth).catch(() => ({ value: [] }));
          if (res.value && res.value.length) {
            matchedIdentities = matchedIdentities.concat(res.value);
          }
        }

        for (const userIdent of matchedIdentities) {
          const uName = userIdent.displayName || userIdent.customDisplayName || userIdent.providerDisplayName || '';
          const uEmail = userIdent.mailAddress || userIdent.uniqueName || '';
          const memberOfDescriptors = userIdent.memberOf || [];

          if (memberOfDescriptors.length > 0) {
            // Azure DevOps returns array of descriptor strings: convert them in batches to group names
            const chunkSize = 20;
            for (let i = 0; i < memberOfDescriptors.length; i += chunkSize) {
              const chunk = memberOfDescriptors.slice(i, i + chunkSize);
              const descriptorParams = chunk.map(d => encodeURIComponent(typeof d === 'string' ? d : d.descriptor)).join(',');
              
              try {
                const grpRes = await window.HubApp.fetchAdo(org, `_apis/identities?descriptors=${descriptorParams}&queryMembership=None&api-version=6.0`, auth);
                const resolvedGroups = grpRes.value || [];

                resolvedGroups.forEach(g => {
                  const rawGrpName = g.providerDisplayName || g.customDisplayName || g.displayName || '';
                  if (!rawGrpName) return;

                  // Only retain groups scoped to this project or built-in project roles
                  if (rawGrpName.includes(`[${cleanProject}]`) || !rawGrpName.includes('[')) {
                    const cleanGrp = rawGrpName.replace(/^\[.*?\]\\/, '').trim();
                    const parentGroups = this.determineParentGroups(cleanGrp);
                    addRow(cleanGrp, parentGroups, uName, uEmail, false);
                  }
                });
              } catch (descErr) {
                console.warn('Descriptor batch resolve warning:', descErr);
              }
            }
          }
        }
      } catch (uErr) {
        console.warn('Direct user query notice:', uErr);
      }
    }

    // 2. Fetch All Project Teams and Members
    try {
      const teamsData = await window.HubApp.fetchAdo(
        org,
        `_apis/projects/${encodeURIComponent(cleanProject)}/teams?api-version=6.0&$top=1000`,
        auth
      );
      const teams = teamsData.value || [];

      await Promise.all(teams.map(async (t) => {
        const cleanName = t.name.trim();
        const parentGroups = this.determineParentGroups(cleanName, true);

        try {
          const membersData = await window.HubApp.fetchAdo(
            org,
            `_apis/projects/${encodeURIComponent(cleanProject)}/teams/${t.id}/members?api-version=6.0&$top=1000`,
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
    try {
      const idData = await window.HubApp.fetchAdo(
        org,
        `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`,
        auth
      ).catch(() => ({ value: [] }));

      const identities = idData.value || [];

      identities.forEach(grp => {
        const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
        if (!rawName) return;

        const cleanName = rawName.replace(/^\[.*?\]\\/, '').trim();
        if (!cleanName || cleanName === cleanProject) return;

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

    // 4. Scan & Deep-Expand Standard Security Groups
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
        const parentGroups = this.determineParentGroups(grpName);

        try {
          const qUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
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
      filterQuery ? `${cleanProject} (${filterQuery})` : cleanProject,
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
