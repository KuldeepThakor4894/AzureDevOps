window.AccessModule = {
  allItems: [],
  filteredItems: [],
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
    const cleanProject = project.trim();
    const qLower = (filterQuery || '').trim().toLowerCase();
    let allDiscoveredRows = [];
    const processedKeys = new Set();
    const teamMembersMap = new Map(); // CleanTeamName -> array of { displayName, mailAddress }

    // 1. Resolve Project Info (Get both Name and GUID)
    let projectId = cleanProject;
    try {
      const pInfo = await window.HubApp.fetchAdo(org, `_apis/projects/${encodeURIComponent(cleanProject)}?api-version=6.0`, auth);
      if (pInfo && pInfo.id) {
        projectId = pInfo.id;
      }
    } catch (e) {
      console.warn('Could not fetch project info:', e);
    }

    const addRecord = (groupName, parentGroups, userDisplayName, mailAddress, isPlaceholder = false) => {
      let cleanGroup = groupName
        .replace(/^\[.*?\]\\/, '')
        .replace(/^\[.*?\]/, '')
        .trim();

      if (!cleanGroup || cleanGroup.toLowerCase() === cleanProject.toLowerCase() || cleanGroup.toLowerCase() === projectId.toLowerCase()) return;

      const groupPrincipal = `[${cleanProject}]\\${cleanGroup}`;
      const groupRole = this.determineGroupRole(cleanGroup, parentGroups);
      const uniqueKey = `${cleanProject}__${cleanGroup}__${userDisplayName}__${mailAddress}`.toLowerCase();

      if (processedKeys.has(uniqueKey)) return;
      processedKeys.add(uniqueKey);

      allDiscoveredRows.push({
        projectName: cleanProject,
        groupName: cleanGroup,
        groupPrincipal: groupPrincipal,
        groupRole: groupRole,
        parentGroups: parentGroups,
        userDisplayName: userDisplayName || (isPlaceholder ? '(No members assigned)' : 'Unknown Principal'),
        mailAddress: mailAddress || '',
        isPlaceholder: isPlaceholder
      });
    };

    // 2. Direct User Search & Reverse Descriptor Resolution (Guarantees all groups for individual users across ANY project)
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
          if (u.id && !seenUserIds.has(u.id)) {
            seenUserIds.add(u.id);
            uniqueUsers.push(u);
          }
        });

        for (const userIdent of uniqueUsers) {
          const uName = userIdent.displayName || userIdent.customDisplayName || userIdent.providerDisplayName || '';
          const uEmail = userIdent.mailAddress || userIdent.uniqueName || '';
          const memberOfDescriptors = userIdent.memberOf || [];

          if (memberOfDescriptors.length > 0) {
            const chunkSize = 20;
            for (let i = 0; i < memberOfDescriptors.length; i += chunkSize) {
              const chunk = memberOfDescriptors.slice(i, i + chunkSize);
              const descriptorParams = chunk.map(d => encodeURIComponent(typeof d === 'string' ? d : (d.descriptor || d.id))).join(',');

              try {
                const grpRes = await window.HubApp.fetchAdo(org, `_apis/identities?descriptors=${descriptorParams}&queryMembership=None&api-version=6.0`, auth);
                const resolvedGroups = grpRes.value || [];

                resolvedGroups.forEach(g => {
                  const rawGrpName = g.providerDisplayName || g.customDisplayName || g.displayName || '';
                  if (!rawGrpName) return;

                  // Check if group belongs to this project by Name, by GUID, or is a project-level role
                  const isProjectMatch = rawGrpName.includes(`[${cleanProject}]`) ||
                                        (projectId && rawGrpName.includes(`[${projectId}]`)) ||
                                        !rawGrpName.includes('[');

                  if (isProjectMatch) {
                    const cleanGrp = rawGrpName.replace(/^\[.*?\]\\/, '').replace(/^\[.*?\]/, '').trim();
                    const parentGroups = this.determineParentGroups(cleanGrp);
                    addRecord(cleanGrp, parentGroups, uName, uEmail, false);
                  }
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

    // 3. Fetch All Project Teams and Members
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
            addRecord(cleanTeamName, parentGroups, '(No members assigned)', '', true);
          } else {
            members.forEach(m => {
              const displayName = m.identity?.displayName || 'Team Member';
              const email = m.identity?.uniqueName || m.identity?.mailAddress || '';
              teamMembersMap.get(cleanTeamName.toLowerCase()).push({ displayName, email });
              addRecord(cleanTeamName, parentGroups, displayName, email, false);
            });
          }
        } catch (mErr) {
          addRecord(cleanTeamName, parentGroups, '(Team Active)', '', true);
        }
      }));
    } catch (err) {
      console.warn('Teams discovery warning:', err);
    }

    // 4. Fetch All Identities using both Project Name and Project GUID
    const idSearchUrls = [
      `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`,
      `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(cleanProject)}]&queryMembership=Expanded&api-version=6.0`
    ];

    if (projectId && projectId !== cleanProject) {
      idSearchUrls.push(`_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(projectId)}]&queryMembership=Expanded&api-version=6.0`);
    }

    for (const url of idSearchUrls) {
      try {
        const idData = await window.HubApp.fetchAdo(org, url, auth).catch(() => ({ value: [] }));
        const identities = idData.value || [];

        identities.forEach(grp => {
          const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
          if (!rawName) return;

          const cleanName = rawName.replace(/^\[.*?\]\\/, '').replace(/^\[.*?\]/, '').trim();
          if (!cleanName || cleanName === cleanProject || cleanName === projectId) return;

          const parentGroups = this.determineParentGroups(cleanName);
          const members = grp.members || [];

          if (members.length === 0) {
            addRecord(cleanName, parentGroups, '(No direct members)', '', true);
          } else {
            members.forEach(m => {
              const mName = m.displayName || m.providerDisplayName || m.customDisplayName || '';
              const mEmail = m.uniqueName || m.mailAddress || '';

              const cleanMName = mName.replace(/^\[.*?\]\\/, '').trim().toLowerCase();
              if (teamMembersMap.has(cleanMName) && teamMembersMap.get(cleanMName).length > 0) {
                teamMembersMap.get(cleanMName).forEach(tm => {
                  addRecord(cleanName, parentGroups, tm.displayName, tm.email, false);
                });
              } else {
                addRecord(cleanName, parentGroups, mName || 'Group Member', mEmail, false);
              }
            });
          }
        });
      } catch (idErr) {
        console.warn('Identities query notice:', idErr);
      }
    }

    // 5. Expand Core Project Security Roles (Project Administrators, Build Administrators, Contributors, Readers, etc.)
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
                  addRecord(grpName, parentGroups, tm.displayName, tm.email, false);
                });
              } else {
                addRecord(grpName, parentGroups, mName || 'Member', mEmail, false);
              }
            });
          } else {
            addRecord(grpName, parentGroups, '(No direct members)', '', true);
          }
        } catch (e) {
          addRecord(grpName, parentGroups, '(No direct members)', '', true);
        }
      })
    );

    // Save project master items
    this.allItems = allDiscoveredRows;

    // 6. Filter by User Query or Group Name
    let finalRows = this.allItems;
    let groupCounts = {};

    if (qLower) {
      finalRows = this.allItems.filter(r => {
        const uName = r.userDisplayName.toLowerCase();
        const uMail = r.mailAddress.toLowerCase();
        const gName = r.groupName.toLowerCase();
        return uName.includes(qLower) || uMail.includes(qLower) || gName.includes(qLower);
      });
    }

    finalRows.forEach(r => {
      if (!r.isPlaceholder) {
        groupCounts[r.groupName] = (groupCounts[r.groupName] || 0) + 1;
      } else if (groupCounts[r.groupName] === undefined) {
        groupCounts[r.groupName] = 0;
      }
    });

    finalRows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.userDisplayName.localeCompare(b.userDisplayName));

    this.filteredItems = finalRows;
    this.index = 0;

    const matchedGroupsCount = Object.keys(groupCounts).length;
    const totalMappingsCount = finalRows.filter(r => !r.isPlaceholder).length || finalRows.length;

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

    const sortedGroups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const chartKeys = sortedGroups.map(i => i[0]);
    const chartVals = sortedGroups.map(i => i[1]);

    window.HubApp.renderChart(
      chartKeys.length ? chartKeys : ['No Matching Groups'],
      chartVals.length ? chartVals : [0],
      'Memberships per Group'
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
