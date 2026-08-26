window.AccessModule = {
  allItems: [],
  filteredItems: [],
  index: 0,
  pageSize: 25,

  determineGroupRole(groupName, parentGroups = '') {
    const name = groupName.toLowerCase();
    const parents = parentGroups.toLowerCase();
    if (name.includes('project administrators') || name.includes('collection administrators') || name.includes('admin') || parents.includes('administrators')) return 'Admin';
    if (name.includes('reader') || parents.includes('readers')) return 'Reader';
    return 'Other';
  },

  determineParentGroups(groupName, isTeam = false) {
    const name = groupName.toLowerCase();
    if (name.includes('collection administrators')) {
      return 'Project Collection Valid Users';
    }
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
    const cleanProject = project ? project.trim() : '';
    const qLower = (filterQuery || '').trim().toLowerCase();
    let allDiscoveredRows = [];
    const processedKeys = new Set();
    const teamMembersMap = new Map();

    const addRecord = (projScope, groupName, parentGroups, userDisplayName, mailAddress, isPlaceholder = false) => {
      let cleanScope = projScope.replace(/^\[/, '').replace(/\]$/, '').trim();
      let cleanGroup = groupName.replace(/^\[.*?\]\\/, '').replace(/^\[.*?\]/, '').trim();

      if (!cleanGroup) return;
      if (!cleanScope) cleanScope = cleanProject || org;

      const groupPrincipal = `[${cleanScope}]\\${cleanGroup}`;
      const groupRole = this.determineGroupRole(cleanGroup, parentGroups);
      const uniqueKey = `${cleanScope}__${cleanGroup}__${userDisplayName}__${mailAddress}`.toLowerCase();

      if (processedKeys.has(uniqueKey)) return;
      processedKeys.add(uniqueKey);

      allDiscoveredRows.push({
        projectName: cleanScope,
        groupName: cleanGroup,
        groupPrincipal: groupPrincipal,
        groupRole: groupRole,
        parentGroups: parentGroups,
        userDisplayName: userDisplayName || (isPlaceholder ? '(No members assigned)' : 'Unknown Principal'),
        mailAddress: mailAddress || '',
        isPlaceholder: isPlaceholder
      });
    };

    // 1. Direct User Identity & Full "Member Of" Tree Expansion
    if (qLower) {
      try {
        const userQueryUrls = [
          `_apis/identities?searchFilter=GeneralScope&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`,
          `_apis/identities?searchFilter=AccountName&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`,
          `_apis/identities?searchFilter=DisplayName&filterValue=${encodeURIComponent(qLower)}&queryMembership=Expanded&api-version=6.0`
        ];

        let matchedUsers = [];
        for (const uUrl of userQueryUrls) {
          const res = await window.HubApp.fetchAdo(org, uUrl, auth).catch(() => ({ value: [] }));
          if (res.value && res.value.length) {
            matchedUsers = matchedUsers.concat(res.value);
          }
        }

        // Deduplicate matched users
        const uniqueUsers = [];
        const seenUserIds = new Set();
        matchedUsers.forEach(u => {
          const id = u.id || u.descriptor;
          if (id && !seenUserIds.has(id)) {
            seenUserIds.add(id);
            uniqueUsers.push(u);
          }
        });

        // Resolve all memberOf groups across all projects
        for (const userIdent of uniqueUsers) {
          const uName = userIdent.displayName || userIdent.customDisplayName || userIdent.providerDisplayName || '';
          const uEmail = userIdent.mailAddress || userIdent.uniqueName || '';
          const memberOfDescriptors = userIdent.memberOf || [];

          if (memberOfDescriptors.length > 0) {
            const chunkSize = 25;
            for (let i = 0; i < memberOfDescriptors.length; i += chunkSize) {
              const chunk = memberOfDescriptors.slice(i, i + chunkSize);
              const descriptorParams = chunk.map(d => encodeURIComponent(typeof d === 'string' ? d : (d.descriptor || d.id))).join(',');

              try {
                const grpRes = await window.HubApp.fetchAdo(org, `_apis/identities?descriptors=${descriptorParams}&queryMembership=None&api-version=6.0`, auth);
                const resolvedGroups = grpRes.value || [];

                resolvedGroups.forEach(g => {
                  const rawGrpName = g.providerDisplayName || g.customDisplayName || g.displayName || '';
                  if (!rawGrpName) return;

                  // Parse [Scope]\GroupName
                  let scopeName = cleanProject;
                  let groupOnlyName = rawGrpName;

                  if (rawGrpName.includes('\\')) {
                    const parts = rawGrpName.split('\\');
                    scopeName = parts[0].replace(/^\[/, '').replace(/\]$/, '').trim();
                    groupOnlyName = parts[1].trim();
                  } else if (rawGrpName.startsWith('[')) {
                    const match = rawGrpName.match(/^\[(.*?)\]\s*(.*)$/);
                    if (match) {
                      scopeName = match[1].trim();
                      groupOnlyName = match[2].trim();
                    }
                  }

                  const parentGroups = this.determineParentGroups(groupOnlyName);
                  addRecord(scopeName, groupOnlyName, parentGroups, uName, uEmail, false);
                });
              } catch (dErr) {
                console.warn('Descriptor batch resolve warning:', dErr);
              }
            }
          }
        }
      } catch (uErr) {
        console.warn('User search notice:', uErr);
      }
    }

    // 2. Fetch Project Teams & Team Members
    if (cleanProject) {
      try {
        const teamsData = await window.HubApp.fetchAdo(
          org,
          `_apis/projects/${encodeURIComponent(cleanProject)}/teams?api-version=6.0&$top=1000`,
          auth
        );
        const teams = teamsData.value || [];

        await Promise.all(teams.map(async (t) => {
          const cleanTeamName = t.name.trim();
          const parentGroups = this.determineParentGroups(cleanTeamName, true);
          teamMembersMap.set(cleanTeamName.toLowerCase(), []);

          try {
            const membersData = await window.HubApp.fetchAdo(
              org,
              `_apis/projects/${encodeURIComponent(cleanProject)}/teams/${t.id}/members?api-version=6.0&$top=1000`,
              auth
            );
            const members = membersData.value || [];

            if (members.length === 0) {
              if (!qLower) addRecord(cleanProject, cleanTeamName, parentGroups, '(No members assigned)', '', true);
            } else {
              members.forEach(m => {
                const displayName = m.identity?.displayName || 'Team Member';
                const email = m.identity?.uniqueName || m.identity?.mailAddress || '';
                teamMembersMap.get(cleanTeamName.toLowerCase()).push({ displayName, email });
                addRecord(cleanProject, cleanTeamName, parentGroups, displayName, email, false);
              });
            }
          } catch (mErr) {
            if (!qLower) addRecord(cleanProject, cleanTeamName, parentGroups, '(Team Active)', '', true);
          }
        }));
      } catch (err) {
        console.warn('Teams discovery warning:', err);
      }

      // 3. Scan Project Identities
      try {
        const idSearchUrls = [
          `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`,
          `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`
        ];

        for (const url of idSearchUrls) {
          const idData = await window.HubApp.fetchAdo(org, url, auth).catch(() => ({ value: [] }));
          const identities = idData.value || [];

          identities.forEach(grp => {
            const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
            if (!rawName) return;

            const cleanName = rawName.replace(/^\[.*?\]\\/, '').replace(/^\[.*?\]/, '').trim();
            if (!cleanName || cleanName === cleanProject) return;

            const parentGroups = this.determineParentGroups(cleanName);
            const members = grp.members || [];

            if (members.length === 0) {
              if (!qLower) addRecord(cleanProject, cleanName, parentGroups, '(No direct members)', '', true);
            } else {
              members.forEach(m => {
                const mName = m.displayName || m.providerDisplayName || m.customDisplayName || '';
                const mEmail = m.uniqueName || m.mailAddress || '';

                const cleanMName = mName.replace(/^\[.*?\]\\/, '').trim().toLowerCase();
                if (teamMembersMap.has(cleanMName) && teamMembersMap.get(cleanMName).length > 0) {
                  teamMembersMap.get(cleanMName).forEach(tm => {
                    addRecord(cleanProject, cleanName, parentGroups, tm.displayName, tm.email, false);
                  });
                } else {
                  addRecord(cleanProject, cleanName, parentGroups, mName || 'Group Member', mEmail, false);
                }
              });
            }
          });
        }
      } catch (idErr) {
        console.warn('Identities query notice:', idErr);
      }

      // 4. Scan Core Project Security Groups
      const coreSecurityGroups = [
        'Project Administrators',
        'Build Administrators',
        'Contributors',
        'Readers',
        'Release Administrators',
        'Deployment Group Administrators',
        'Endpoint Administrators',
        'Endpoint Creators',
        'Project Valid Users'
      ];

      await Promise.all(
        coreSecurityGroups.map(async (grpName) => {
          const parentGroups = this.determineParentGroups(grpName);
          try {
            const qUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
            const res = await window.HubApp.fetchAdo(org, qUrl, auth);
            const list = res.value || [];

            if (list.length > 0 && list[0].members?.length > 0) {
              list[0].members.forEach(m => {
                const mName = m.displayName || m.providerDisplayName || '';
                const mEmail = m.uniqueName || m.mailAddress || '';

                const cleanMName = mName.replace(/^\[.*?\]\\/, '').trim().toLowerCase();
                if (teamMembersMap.has(cleanMName) && teamMembersMap.get(cleanMName).length > 0) {
                  teamMembersMap.get(cleanMName).forEach(tm => {
                    addRecord(cleanProject, grpName, parentGroups, tm.displayName, tm.email, false);
                  });
                } else {
                  addRecord(cleanProject, grpName, parentGroups, mName || 'Member', mEmail, false);
                }
              });
            } else if (!qLower) {
              addRecord(cleanProject, grpName, parentGroups, '(No direct members)', '', true);
            }
          } catch (e) {
            if (!qLower) addRecord(cleanProject, grpName, parentGroups, '(No direct members)', '', true);
          }
        })
      );
    }

    // Save project master items
    this.allItems = allDiscoveredRows;

    // 5. Apply Filter Logic (User Name, Email, Group Name, or Scope)
    let finalRows = this.allItems;
    let groupCounts = {};

    if (qLower) {
      finalRows = this.allItems.filter(r => {
        const uName = r.userDisplayName.toLowerCase();
        const uMail = r.mailAddress.toLowerCase();
        const gName = r.groupName.toLowerCase();
        const pName = r.projectName.toLowerCase();
        return uName.includes(qLower) || uMail.includes(qLower) || gName.includes(qLower) || pName.includes(qLower);
      });
    }

    finalRows.forEach(r => {
      const label = `${r.projectName} (${r.groupName})`;
      if (!r.isPlaceholder) {
        groupCounts[label] = (groupCounts[label] || 0) + 1;
      } else if (groupCounts[label] === undefined) {
        groupCounts[label] = 0;
      }
    });

    finalRows.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.groupName.localeCompare(b.groupName) || a.userDisplayName.localeCompare(b.userDisplayName));

    this.filteredItems = finalRows;
    this.index = 0;

    const matchedGroupsCount = Object.keys(groupCounts).length;
    const totalMappingsCount = finalRows.filter(r => !r.isPlaceholder).length || finalRows.length;

    window.HubApp.setKpis(
      filterQuery ? `${filterQuery}` : cleanProject,
      'Total Groups',
      matchedGroupsCount,
      'Total Mappings',
      totalMappingsCount,
      'Scope',
      'Organization & Project Scope'
    );

    this.render(false);

    const sortedGroups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const chartKeys = sortedGroups.slice(0, 15).map(i => i[0]);
    const chartVals = sortedGroups.slice(0, 15).map(i => i[1]);

    window.HubApp.renderChart(
      chartKeys.length ? chartKeys : ['No Matching Groups'],
      chartVals.length ? chartVals : [0],
      'Memberships across Scopes'
    );
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.filteredItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No project permissions found matching criteria.</td></tr>`;
      document.getElementById('seeMoreAccessContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.filteredItems.slice(this.index, this.index + this.pageSize);
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

    const rem = this.filteredItems.length - this.index;
    const moreBtn = document.getElementById('seeMoreAccessContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      document.getElementById('accessRemainingCount').textContent = rem;
    }
  }
};
