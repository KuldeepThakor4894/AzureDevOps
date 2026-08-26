window.AccessModule = {
  items: [],
  index: 0,
  pageSize: 25,

  async fetch(org, project, pat, filterQuery) {
    const auth = 'Basic ' + btoa(':' + pat);
    const userQuery = (filterQuery || '').trim().toLowerCase();
    const API_VERSION = '7.1-preview.1';

    let accessRows = [];
    let groupMemberCounts = {};
    const roleMap = {
      'Project Administrators': 'Admin',
      'Build Administrators': 'Admin',
      'Release Administrators': 'Admin',
      'Contributors': 'Contributor',
      'Readers': 'Reader',
      'CBB Readers': 'Reader',
      'Project Valid Users': 'Reader'
    };

    window.HubApp.setStatus(userQuery ? `Searching security groups for "${userQuery}"...` : `Discovering all project security groups in ${project}...`, 'info');

    // Helper: Direct Fetch
    const fetchAzDo = async (url) => {
      const res = await fetch(url, {
        headers: {
          'Authorization': auth,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    };

    // Step 1: Get Project Metadata & Storage Key Scope Descriptor
    const projMetaUrl = `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}?api-version=${API_VERSION}`;
    const projMeta = await fetchAzDo(projMetaUrl);
    const projectId = projMeta.id;

    let scopeDescriptor = '';
    try {
      const descUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/descriptors/${projectId}?api-version=${API_VERSION}`;
      const descData = await fetchAzDo(descUrl);
      scopeDescriptor = descData.value || '';
    } catch (e) {
      console.warn('Could not query scope descriptor directly, trying fallback scope...', e);
    }

    // Step 2: Fetch ALL Graph Groups in Project Scope (with continuation token pagination)
    let graphGroups = [];
    let continuationToken = '';

    do {
      const tokenParam = continuationToken ? `&continuationToken=${continuationToken}` : '';
      const scopeParam = scopeDescriptor ? `&scopeDescriptor=${scopeDescriptor}` : '';
      const groupsUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/groups?api-version=${API_VERSION}${scopeParam}${tokenParam}`;

      try {
        const gData = await fetchAzDo(groupsUrl);
        if (gData && gData.value) {
          const validGroups = gData.value.filter(g =>
            !scopeDescriptor || g.scopeDescriptor === scopeDescriptor || (g.principalName && g.principalName.includes(`[${project}]`))
          );
          graphGroups.push(...(validGroups.length ? validGroups : gData.value));
        }
        continuationToken = gData.continuationToken || '';
      } catch (ge) {
        console.warn('Graph API call error, falling back to org-level filtering:', ge);
        break;
      }
    } while (continuationToken);

    // Step 3: Include all Project Teams
    try {
      const teamsUrl = `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}/teams?api-version=${API_VERSION}`;
      const tData = await fetchAzDo(teamsUrl);
      (tData.value || []).forEach(team => {
        if (!graphGroups.some(g => g.displayName === team.name)) {
          graphGroups.push({
            displayName: team.name,
            descriptor: team.id,
            principalName: `[${project}]\\${team.name}`,
            isTeam: true
          });
        }
      });
    } catch (te) {
      console.warn('Teams discovery warning:', te);
    }

    window.HubApp.setStatus(`Found ${graphGroups.length} security groups/teams. Fetching member identities...`, 'info');

    // Step 4: Resolve Members for every group found
    for (const group of graphGroups) {
      const groupName = group.displayName || group.name;
      const groupDescriptor = group.descriptor;
      const groupPrincipal = group.principalName || `[${project}]\\${groupName}`;
      let groupRole = roleMap[groupName] || (groupName.toLowerCase().includes('admin') ? 'Admin' : (groupName.toLowerCase().includes('reader') ? 'Reader' : 'Contributor'));

      let members = [];

      if (group.isTeam) {
        try {
          const memUrl = `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}/teams/${groupDescriptor}/members?api-version=${API_VERSION}`;
          const mData = await fetchAzDo(memUrl);
          members = mData.value || [];
        } catch (err) { }
      } else {
        try {
          const memUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/Memberships/${groupDescriptor}?direction=Down&api-version=${API_VERSION}`;
          const mData = await fetchAzDo(memUrl);
          const memberRefs = mData.value || [];

          for (const mem of memberRefs) {
            const subDesc = mem.memberDescriptor;
            if (!subDesc) continue;

            if (!subDesc.startsWith('vssgp.')) {
              try {
                const userUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/users/${subDesc}?api-version=${API_VERSION}`;
                const uData = await fetchAzDo(userUrl);
                if (uData) members.push(uData);
              } catch (ue) { }
            }
          }
        } catch (err) { }
      }

      // If no members in group, register group placeholder when not filtering by user
      if (members.length === 0) {
        groupMemberCounts[groupName] = 0;
        if (!userQuery) {
          accessRows.push({
            ProjectName: project,
            GroupName: groupName,
            GroupPrincipal: groupPrincipal,
            GroupRole: groupRole,
            ParentGroups: 'Contributors, Project Valid Users',
            UserDisplayName: '(No Direct Members)',
            UserPrincipal: '-',
            MailAddress: '-',
            SubjectKind: 'group'
          });
        }
      } else {
        members.forEach(m => {
          const name = m.displayName || m.identity?.displayName || m.name || m.uniqueName || 'Unknown';
          const email = m.mailAddress || m.identity?.mailAddress || m.uniqueName || m.identity?.uniqueName || m.principalName || '';
          const subjectKind = m.subjectKind || m.identity?.subjectKind || 'user';

          if (!userQuery || name.toLowerCase().includes(userQuery) || email.toLowerCase().includes(userQuery) || groupName.toLowerCase().includes(userQuery)) {
            accessRows.push({
              ProjectName: project,
              GroupName: groupName,
              GroupPrincipal: groupPrincipal,
              GroupRole: groupRole,
              ParentGroups: 'Contributors, Project Valid Users',
              UserDisplayName: name,
              UserPrincipal: email,
              MailAddress: email,
              SubjectKind: subjectKind
            });
            groupMemberCounts[groupName] = (groupMemberCounts[groupName] || 0) + 1;
          }
        });
      }
    }

    this.items = accessRows;
    this.index = 0;

    // Update KPI Badges matching your UI
    window.HubApp.setKpis(
      userQuery ? userQuery : project,
      'SECURITY GROUPS',
      Object.keys(groupMemberCounts).length,
      'ASSIGNED ROLES/MEMBERS',
      accessRows.filter(r => r.UserDisplayName !== '(No Direct Members)').length,
      'MODE',
      'Security Matrix'
    );

    this.render(false);

    // Render bar chart with all project groups along the X-axis
    const chartKeys = Object.keys(groupMemberCounts);
    const chartVals = Object.values(groupMemberCounts);

    window.HubApp.renderChart(
      chartKeys.length ? chartKeys : ['No Groups'],
      chartVals.length ? chartVals : [0],
      'Members per Security Group'
    );
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No matching security group assignments found.</td></tr>`;
      document.getElementById('seeMoreAccessContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(a => {
        let badgeClass = a.GroupRole === 'Admin' ? 'badge-danger' : 'badge-active';
        return `
          <tr>
            <td><strong>${a.ProjectName}</strong></td>
            <td><strong>${a.GroupName}</strong></td>
            <td><span class="badge ${badgeClass}">${a.GroupRole}</span></td>
            <td>${a.UserDisplayName}</td>
            <td>${a.MailAddress || a.UserPrincipal ? `<code>${a.MailAddress || a.UserPrincipal}</code>` : '-'}</td>
          </tr>
        `;
      }).join('')
    );

    const rem = this.items.length - this.index;
    const moreBtn = document.getElementById('seeMoreAccessContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('accessRemainingCount');
      if (counter) counter.textContent = rem;
    }
  }
};
