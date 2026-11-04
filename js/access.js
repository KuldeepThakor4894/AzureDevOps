// Azure DevOps Intelligence Hub - Project Security Groups & Access Module
window.AccessModule = {
  items: [],
  allItems: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',
  searchTerm: '',
  roleFilter: 'all',

  async fetch(org, project, pat, filterQuery) {
    this.currentOrg = org;
    this.currentProject = project;
    this.searchTerm = (filterQuery || '').trim().toLowerCase();
    const auth = 'Basic ' + btoa(':' + pat);
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

    window.HubApp.setStatus(`Discovering all project security groups in ${project}...`, 'info');

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
    let projectId = '';
    let scopeDescriptor = '';
    try {
      const projMetaUrl = `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}?api-version=${API_VERSION}`;
      const projMeta = await fetchAzDo(projMetaUrl);
      projectId = projMeta.id;

      try {
        const descUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/descriptors/${projectId}?api-version=${API_VERSION}`;
        const descData = await fetchAzDo(descUrl);
        scopeDescriptor = descData.value || '';
      } catch (e) {
        console.warn('Could not query scope descriptor directly, trying fallback scope...', e);
      }
    } catch (pe) {
      console.warn('Could not query project metadata:', pe);
    }

    // Step 2: Fetch ALL Graph Groups in Project Scope
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
        if (!graphGroups.some(g => (g.displayName || g.name) === team.name)) {
          graphGroups.push({
            displayName: team.name,
            descriptor: team.id,
            principalName: `[${project}]\\${team.name}`,
            description: team.description || 'Project Team backlog and iteration planning group',
            isTeam: true
          });
        }
      });
    } catch (te) {
      console.warn('Teams discovery warning:', te);
    }

    window.HubApp.setStatus(`Found ${graphGroups.length} security groups/teams. Fetching member identities...`, 'info');

    // Step 4: Resolve Members and Attributes for Every Group
    for (const group of graphGroups) {
      const groupName = group.displayName || group.name || 'Security Group';
      const groupDescriptor = group.descriptor || '';
      const groupPrincipal = group.principalName || `[${project}]\\${groupName}`;
      const lowerName = groupName.toLowerCase();

      // Resolve Access Level Role
      const groupRole = roleMap[groupName] || (lowerName.includes('admin') ? 'Admin' : (lowerName.includes('reader') ? 'Reader' : 'Contributor'));

      // Resolve Group Description
      let description = group.description;
      if (!description || typeof description !== 'string' || description.trim() === '' || description.toLowerCase() === 'undefined') {
        if (lowerName.includes('project administrator')) {
          description = 'Full administrative control over project settings, security permissions, and all resources.';
        } else if (lowerName.includes('build administrator')) {
          description = 'Members can administer build pipelines, agent queues, and build definitions.';
        } else if (lowerName.includes('release administrator') || lowerName.includes('release approver')) {
          description = 'Members can manage and approve release definitions and deployment environments.';
        } else if (lowerName.includes('contributor')) {
          description = 'Members can contribute code, create branches, run pipelines, and manage work items.';
        } else if (lowerName.includes('reader')) {
          description = 'Members have read-only access to repositories, builds, work items, and dashboards.';
        } else if (lowerName.includes('valid user')) {
          description = 'All authenticated users with basic access to view project resources.';
        } else if (group.isTeam || lowerName.includes('team')) {
          description = 'Project team members with access to team backlogs, boards, and sprints.';
        } else {
          description = 'Azure DevOps Project Security Group.';
        }
      }

      // Resolve Group Type
      let groupType = 'DevOps Group';
      if (group.isTeam) {
        groupType = 'Project Team';
      } else if (group.origin === 'aad' || (group.principalName && !group.principalName.startsWith('['))) {
        groupType = 'Entra ID Group';
      } else if (lowerName.includes('admin')) {
        groupType = 'Admin Group';
      } else {
        groupType = 'Security Group';
      }

      // Resolve Assigned Permissions
      let permissions = 'View & Read Permissions';
      if (groupRole === 'Admin' || lowerName.includes('project administrator')) {
        permissions = 'Full Control (Administer, Manage Security, Delete)';
      } else if (lowerName.includes('build administrator') || lowerName.includes('build and release')) {
        permissions = 'Administer Builds, Manage Queues, Edit Pipelines';
      } else if (lowerName.includes('release approver') || lowerName.includes('release admin')) {
        permissions = 'Approve Releases, Manage Environments & Deployments';
      } else if (groupRole === 'Contributor' || lowerName.includes('contributor') || group.isTeam) {
        permissions = 'Contribute Code, Create PRs, Queue Builds, Edit Work Items';
      } else if (groupRole === 'Reader' || lowerName.includes('reader') || lowerName.includes('valid user')) {
        permissions = 'Read-Only (View Code, Pipelines, Work Items)';
      } else {
        permissions = 'Standard Member Access (View & Contribute)';
      }

      // Query Group Members
      let members = [];
      try {
        if (group.isTeam) {
          const teamMembersUrl = `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(group.displayName || group.name)}/members?api-version=${API_VERSION}`;
          const tmData = await fetchAzDo(teamMembersUrl);
          members = (tmData.value || []).map(m => ({
            displayName: m.identity?.displayName || m.displayName || 'Team Member',
            uniqueName: m.identity?.uniqueName || m.uniqueName || '',
            mailAddress: m.identity?.mailAddress || m.mailAddress || ''
          }));
        } else if (groupDescriptor) {
          const memsUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/memberships/${groupDescriptor}?direction=down&api-version=${API_VERSION}`;
          const mData = await fetchAzDo(memsUrl);
          const memberDescriptors = (mData.value || []).map(m => m.memberDescriptor);

          const memberPromises = memberDescriptors.map(async (mDesc) => {
            try {
              const uUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/users/${mDesc}?api-version=${API_VERSION}`;
              const uData = await fetchAzDo(uUrl);
              return {
                displayName: uData.displayName || 'User',
                uniqueName: uData.principalName || uData.mailAddress || '',
                mailAddress: uData.mailAddress || ''
              };
            } catch (ue) {
              try {
                const subGroupUrl = `https://vssps.dev.azure.com/${org}/_apis/graph/groups/${mDesc}?api-version=${API_VERSION}`;
                const subGData = await fetchAzDo(subGroupUrl);
                return {
                  displayName: `[Nested Group] ${subGData.displayName || 'Group'}`,
                  uniqueName: subGData.principalName || '',
                  mailAddress: ''
                };
              } catch (sge) {
                return null;
              }
            }
          });

          const resolved = await Promise.all(memberPromises);
          members = resolved.filter(Boolean);
        }
      } catch (err) {
        console.warn(`Could not resolve members for group ${groupName}:`, err);
      }

      groupMemberCounts[groupName] = members.length;
      const membersNames = members.map(m => m.displayName || m.uniqueName).filter(Boolean);
      const membersStr = membersNames.join(', ');

      // Create Complete Group Row Object
      accessRows.push({
        ProjectName: project,
        GroupName: groupName,
        GroupDescription: description,
        GroupRole: groupRole,
        GroupDescriptor: groupDescriptor,
        GroupPrincipal: groupPrincipal,
        GroupType: groupType,
        MembersCount: members.length,
        TotalMembers: members.length,
        MembersStr: membersStr,
        Permissions: permissions,
        AssignedPermissions: permissions,
        members: members,
        rawGroup: group
      });
    }

    this.allItems = accessRows;
    this.items = accessRows;
    this.index = 0;

    // Aggregate metrics for 6 dynamic summary cards
    const totalGroupsCount = accessRows.length;
    const allUsersMap = new Map();
    let adminUsersCount = 0;
    let contribUsersCount = 0;
    let readerUsersCount = 0;

    accessRows.forEach(row => {
      row.members.forEach(m => {
        const key = (m.uniqueName || m.mailAddress || m.displayName || '').toLowerCase();
        if (key && !key.startsWith('[nested group]')) {
          allUsersMap.set(key, m);
          if (row.GroupRole === 'Admin') adminUsersCount++;
          else if (row.GroupRole === 'Contributor') contribUsersCount++;
          else if (row.GroupRole === 'Reader') readerUsersCount++;
        }
      });
    });

    const totalUsersCount = allUsersMap.size > 0 ? allUsersMap.size : accessRows.filter(r => r.MembersCount > 0).length;
    const adminsCount = adminUsersCount > 0 ? adminUsersCount : accessRows.filter(r => r.GroupRole === 'Admin').length;
    const contribCount = contribUsersCount > 0 ? contribUsersCount : accessRows.filter(r => r.GroupRole === 'Contributor').length;
    const readersCount = readerUsersCount > 0 ? readerUsersCount : accessRows.filter(r => r.GroupRole === 'Reader').length;
    const reviewCount = adminsCount;

    // Update 6 Dynamic Summary Cards in Module Header
    const elAccGroups = document.getElementById('accessValTotalGroups') || document.getElementById('accValTotalGroups');
    if (elAccGroups) elAccGroups.textContent = totalGroupsCount;
    const elChipGroups = document.getElementById('accessChipProjectGroups');
    if (elChipGroups) elChipGroups.textContent = `${totalGroupsCount} Groups`;

    const elAccUsers = document.getElementById('accessValTotalUsers') || document.getElementById('accValTotalUsers');
    if (elAccUsers) elAccUsers.textContent = totalUsersCount;
    const elChipUsers = document.getElementById('accessChipUsersScope');
    if (elChipUsers) elChipUsers.textContent = `${totalUsersCount} Identities`;

    const elAccAdmins = document.getElementById('accessValAdmins') || document.getElementById('accValAdmins');
    if (elAccAdmins) elAccAdmins.textContent = adminsCount;
    const elChipAdmins = document.getElementById('accessChipAdmins');
    if (elChipAdmins) elChipAdmins.textContent = `${adminsCount} Admins`;

    const elAccContrib = document.getElementById('accessValContributors') || document.getElementById('accValContributors');
    if (elAccContrib) elAccContrib.textContent = contribCount;
    const elChipContrib = document.getElementById('accessChipContributors');
    if (elChipContrib) elChipContrib.textContent = `${contribCount} Active`;

    const elAccReaders = document.getElementById('accessValReaders') || document.getElementById('accValReaders');
    if (elAccReaders) elAccReaders.textContent = readersCount;
    const elChipReaders = document.getElementById('accessChipReaders');
    if (elChipReaders) elChipReaders.textContent = `${readersCount} Readers`;

    const elAccReview = document.getElementById('accessValReview') || document.getElementById('accValReview');
    if (elAccReview) elAccReview.textContent = reviewCount;
    const elChipReview = document.getElementById('accessChipReview');
    if (elChipReview) elChipReview.textContent = `${reviewCount} Review`;

    const elAccLastUpd = document.getElementById('accessLastUpdatedText');
    if (elAccLastUpd) elAccLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    window.HubApp.setKpis(
      this.searchTerm ? `Filtered: "${this.searchTerm}"` : `${project} (All Groups)`,
      'Security Groups',
      totalGroupsCount,
      'Active Permissions',
      this.allItems.length,
      'Security Mode',
      'Graph Security'
    );

    this.filterAndRender();

    // Render chart
    const topGroups = [...this.allItems].sort((a, b) => b.MembersCount - a.MembersCount).slice(0, 8);
    const chartLabels = topGroups.length ? topGroups.map(g => g.GroupName) : ['No Groups'];
    const chartValues = topGroups.length ? topGroups.map(g => g.MembersCount) : [0];

    window.HubApp.renderChart(chartLabels, chartValues, 'Members per Security Group');
  },

  getRoleBadge(role) {
    if (role === 'Admin') {
      return `<span class="badge badge-failed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>Admin</span>`;
    } else if (role === 'Contributor') {
      return `<span class="badge badge-inprogress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Contributor</span>`;
    }
    return `<span class="badge badge-active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle></svg>Reader</span>`;
  },

  filterAndRender() {
    let list = this.allItems;

    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(row => {
        return (
          (row.GroupName && row.GroupName.toLowerCase().includes(q)) ||
          (row.GroupDescription && row.GroupDescription.toLowerCase().includes(q)) ||
          (row.GroupType && row.GroupType.toLowerCase().includes(q)) ||
          (row.Permissions && row.Permissions.toLowerCase().includes(q)) ||
          (row.MembersStr && row.MembersStr.toLowerCase().includes(q)) ||
          (row.members && row.members.some(m =>
            (m.displayName && m.displayName.toLowerCase().includes(q)) ||
            (m.uniqueName && m.uniqueName.toLowerCase().includes(q)) ||
            (m.mailAddress && m.mailAddress.toLowerCase().includes(q))
          )) ||
          String(row.GroupDescriptor || '').toLowerCase().includes(q)
        );
      });
    }

    if (this.roleFilter && this.roleFilter !== 'all') {
      const rf = this.roleFilter.toLowerCase();
      list = list.filter(row => (row.GroupRole || '').toLowerCase() === rf);
    }

    this.items = list;
    this.index = 0;
    this.render(false);
  },

  filterByRole(role) {
    this.roleFilter = role;
    this.filterAndRender();
  },

  filterBySearch(term) {
    this.searchTerm = (term || '').trim().toLowerCase();
    this.filterAndRender();
  },

  render(append = false) {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const statsEl = document.getElementById('accessTableStats');
    if (statsEl) {
      statsEl.textContent = `${this.items.length} records`;
    }

    if (this.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">No security groups or permissions found matching your criteria.</td></tr>';
      document.getElementById('seeMoreAccessContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.items.slice(this.index, this.index + this.pageSize);

    slice.forEach((item, localIdx) => {
      const globalIdx = this.index + localIdx;
      const roleBadge = this.getRoleBadge(item.GroupRole);

      // Determine badge class for Group Type
      let typeBadgeClass = 'badge-purple';
      if (item.GroupType === 'Project Team') typeBadgeClass = 'badge-teal';
      else if (item.GroupType === 'Admin Group') typeBadgeClass = 'badge-failed';
      else if (item.GroupType === 'Security Group') typeBadgeClass = 'badge-blue';

      // Format Members Badge with tooltip
      const membersBadge = item.MembersCount > 0
        ? `<span class="badge badge-blue" title="${item.MembersStr || `${item.MembersCount} Members`}">${item.MembersCount} Members</span>`
        : `<span class="badge badge-canceled">0 Members</span>`;

      // Truncate descriptor cleanly
      const rawDesc = item.GroupDescriptor || '—';
      const shortDesc = rawDesc.length > 20 ? rawDesc.substring(0, 18) + '...' : rawDesc;

      const tr = document.createElement('tr');
      tr.title = 'Click to inspect Group Permission Blade & Members';
      tr.innerHTML = `
        <td><strong>${item.GroupName}</strong></td>
        <td style="font-size:12px; color:var(--text-secondary); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.GroupDescription}">${item.GroupDescription}</td>
        <td><code style="font-size:11px;" title="${rawDesc}">${shortDesc}</code></td>
        <td><span style="font-size:12px;">${item.ProjectName}</span></td>
        <td><span class="badge ${typeBadgeClass}">${item.GroupType}</span></td>
        <td>${membersBadge}</td>
        <td style="font-size:12px; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.Permissions}">${item.Permissions}</td>
        <td>${roleBadge}</td>
      `;

      tr.addEventListener('click', () => this.openAccessBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.index += slice.length;

    const rem = this.items.length - this.index;
    const moreBtn = document.getElementById('seeMoreAccessContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('accessRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  openAccessBlade(itemIdx) {
    const item = this.items[itemIdx];
    if (!item) return;

    window.BladeController.openBlade({
      title: `${item.GroupName}`,
      subtitle: `Security Group Membership & Role Scope Analysis`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Security > ${item.GroupName}`,
      adoUrl: `https://dev.azure.com/${this.currentOrg}/${encodeURIComponent(this.currentProject)}/_settings/permissions`,
      rawData: item.rawGroup || item,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Security Group Overview
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">PROJECT SCOPE</span>
                <span class="blade-kv-value">${item.ProjectName}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">SECURITY GROUP</span>
                <span class="blade-kv-value"><code>${item.GroupName}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">ACCESS LEVEL</span>
                <span class="blade-kv-value">${this.getRoleBadge(item.GroupRole)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">GROUP TYPE</span>
                <span class="blade-kv-value"><span class="badge badge-purple">${item.GroupType}</span></span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">GROUP DESCRIPTION</span>
                <span class="blade-kv-value">${item.GroupDescription}</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">ASSIGNED PERMISSIONS</span>
                <span class="blade-kv-value">${item.Permissions}</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">GROUP DESCRIPTOR</span>
                <span class="blade-kv-value"><code>${item.GroupDescriptor || item.GroupPrincipal || 'Project Scope'}</code></span>
              </div>
            </div>
          </div>
          <div class="blade-section" style="margin-top:16px;">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
              Assigned Member Identities (${item.members ? item.members.length : 0})
            </div>
            ${(!item.members || item.members.length === 0)
              ? '<div style="color:var(--text-muted); font-size:12px; font-style:italic; padding:12px 0;">No direct individual members assigned to this security group.</div>'
              : `
                <table class="portal-table" style="font-size:12px; margin-top:8px;">
                  <thead>
                    <tr>
                      <th>DISPLAY NAME</th>
                      <th>PRINCIPAL / EMAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${item.members.map(m => `
                      <tr>
                        <td><strong>${m.displayName || 'Member'}</strong></td>
                        <td><code>${m.uniqueName || m.mailAddress || '—'}</code></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `
            }
          </div>
        `
      }
    });
  }
};
