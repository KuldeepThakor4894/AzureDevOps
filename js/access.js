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
    if (isTeam || name.includes('team') || name.includes('contributor') || name.includes('reviewer')) {
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

    const addRow = (groupName, parentGroups, userDisplayName, mailAddress) => {
      const cleanGroup = groupName.replace(/^\[.*?\]\\/, '').trim();
      const groupPrincipal = `[${project}]\\${cleanGroup}`;
      const groupRole = this.determineGroupRole(cleanGroup, parentGroups);
      const uniqueKey = `${project}__${cleanGroup}__${userDisplayName}__${mailAddress}`.toLowerCase();

      if (processedKeys.has(uniqueKey)) return;
      processedKeys.add(uniqueKey);

      if (
        !qLower ||
        cleanGroup.toLowerCase().includes(qLower) ||
        userDisplayName.toLowerCase().includes(qLower) ||
        mailAddress.toLowerCase().includes(qLower) ||
        groupRole.toLowerCase().includes(qLower)
      ) {
        rows.push({
          projectName: project,
          groupName: cleanGroup,
          groupPrincipal: groupPrincipal,
          groupRole: groupRole,
          parentGroups: parentGroups,
          userDisplayName: userDisplayName,
          mailAddress: mailAddress
        });
        groupCounts[cleanGroup] = (groupCounts[cleanGroup] || 0) + 1;
      }
    };

    // 1. Fetch Project Teams & All Member Principals
    try {
      const teamsData = await window.HubApp.fetchAdo(
        org,
        `_apis/projects/${encodeURIComponent(project)}/teams?api-version=6.0&$top=500`,
        auth
      );
      const teams = teamsData.value || [];

      for (const t of teams) {
        const parentGroups = this.determineParentGroups(t.name, true);
        try {
          const membersData = await window.HubApp.fetchAdo(
            org,
            `_apis/projects/${encodeURIComponent(project)}/teams/${t.id}/members?api-version=6.0&$top=500`,
            auth
          );
          const members = membersData.value || [];

          if (members.length === 0) {
            addRow(t.name, parentGroups, '(No members assigned)', '');
          } else {
            members.forEach(m => {
              const displayName = m.identity?.displayName || 'Unknown Member';
              const email = m.identity?.uniqueName || m.identity?.mailAddress || '';
              addRow(t.name, parentGroups, displayName, email);
            });
          }
        } catch (mErr) {
          addRow(t.name, parentGroups, '(Team Active)', '');
        }
      }
    } catch (err) {
      console.warn('Teams fetch error:', err);
    }

    // 2. Fetch Project Security Identities
    try {
      const idData = await window.HubApp.fetchAdo(
        org,
        `_apis/identities?searchFilter=GeneralScope&filterValue=[${encodeURIComponent(project)}]&queryMembership=Expanded&api-version=6.0`,
        auth
      ).catch(() => ({ value: [] }));

      const identities = idData.value || [];

      identities.forEach(grp => {
        const rawName = grp.providerDisplayName || grp.customDisplayName || grp.displayName || '';
        const cleanName = rawName.replace(/^\[.*?\]\\/, '').trim();
        if (!cleanName) return;

        const parentGroups = this.determineParentGroups(cleanName);
        const members = grp.members || [];

        if (members.length === 0) {
          addRow(cleanName, parentGroups, '(No direct members)', '');
        } else {
          members.forEach(m => {
            const displayName = m.displayName || 'Security Principal';
            const email = m.uniqueName || m.mailAddress || '';
            addRow(cleanName, parentGroups, displayName, email);
          });
        }
      });
    } catch (idErr) {
      console.warn('Identities query notice:', idErr);
    }

    // 3. Built-in Security Groups expansion
    const builtInGroups = [
      'Project Administrators',
      'Contributors',
      'Readers',
      'Build Administrators',
      'Release Administrators',
      'ABS Build and Release Team',
      'ABS_Automation_QA_Teams',
      'ABS-DBA Team',
      'ABS-DEV_ENV_PR_Reviewers',
      'ABS-DEV_Upper_ENV_PR_Reviewers',
      'Automation Pipeline Access',
      'CBB_MyPortal_Team',
      'Stridely_MyPortal_Team'
    ];

    for (const grpName of builtInGroups) {
      if (groupCounts[grpName] !== undefined) continue;
      const parentGroups = this.determineParentGroups(grpName);

      try {
        const qUrl = `_apis/identities?searchFilter=AccountName&filterValue=[${encodeURIComponent(project)}]\\${encodeURIComponent(grpName)}&queryMembership=Expanded&api-version=6.0`;
        const res = await window.HubApp.fetchAdo(org, qUrl, auth);
        const list = res.value || [];

        if (list.length > 0 && list[0].members?.length > 0) {
          list[0].members.forEach(m => {
            addRow(grpName, parentGroups, m.displayName || 'Member', m.uniqueName || m.mailAddress || '');
          });
        }
      } catch (e) { }
    }

    // Sort to match Excel order
    rows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.userDisplayName.localeCompare(b.userDisplayName));

    this.items = rows;
    this.index = 0;

    window.HubApp.setKpis(
      project,
      'Total Groups',
      Object.keys(groupCounts).length,
      'Total Mappings',
      rows.length,
      'Scope',
      'Project Permissions'
    );

    this.render(false);

    const sorted = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
    window.HubApp.renderChart(
      sorted.slice(0, 10).map(i => i[0]),
      sorted.slice(0, 10).map(i => i[1]),
      'Members per Group / Team'
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
