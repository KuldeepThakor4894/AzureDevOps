// Azure DevOps Intelligence Hub - Repositories & Policies Module
window.RepoModule = {
  branches: [],
  filteredBranches: [],
  branchIndex: 0,
  prs: [],
  prIndex: 0,
  policies: [],
  pageSize: 25,
  currentProject: '',
  currentOrg: '',
  currentPat: '',
  cachedRepos: [],
  selectedRepo: null,
  searchTerm: '',
  statusFilter: 'all',
  policySearchTerm: '',
  policyTypeFilterVal: 'all',
  prSearchTerm: '',
  prStatusFilterVal: 'all',
  eventsBound: false,
  isLoading: false,

  initEvents() {
    if (this.eventsBound) return;
    this.eventsBound = true;

    // Search filter input
    const searchInput = document.getElementById('repoBranchSearchInput');
    searchInput?.addEventListener('input', (e) => {
      this.searchTerm = (e.target.value || '').trim().toLowerCase();
      this.filterAndRenderBranches();
    });

    // Status filter dropdown
    const statusSelect = document.getElementById('repoBranchStatusFilter');
    statusSelect?.addEventListener('change', (e) => {
      this.statusFilter = e.target.value || 'all';
      this.filterAndRenderBranches();
    });

    // Repositories scope sync within Repositories view only
    const repoSelect = document.getElementById('repoSelect');
    const repoModRepoSelect = document.getElementById('repoModRepoSelect');
    repoSelect?.addEventListener('change', (e) => {
      if (repoModRepoSelect && repoModRepoSelect.value !== e.target.value) {
        repoModRepoSelect.value = e.target.value;
      }
    });
    repoModRepoSelect?.addEventListener('change', (e) => {
      if (repoSelect && repoSelect.value !== e.target.value) {
        repoSelect.value = e.target.value;
      }
    });

    // Inline Project select change
    const projectSelect = document.getElementById('repoModProjectSelect');
    projectSelect?.addEventListener('change', (e) => {
      const topSelect = document.getElementById('projectSelect');
      if (topSelect && topSelect.value !== e.target.value) {
        topSelect.value = e.target.value;
        window.HubApp.handleProjectSelect();
      }
    });

    // Refresh Repos button
    document.getElementById('btnRefreshRepos')?.addEventListener('click', () => {
      window.HubApp?.execRepoInspect?.('repositories');
    });

    // Open in ADO button
    document.getElementById('btnOpenRepoInAdo')?.addEventListener('click', () => {
      const org = window.HubApp.getOrg();
      const project = document.getElementById('projectSelect')?.value || '';
      if (!org || !project) return;
      const repoVal = document.getElementById('repoSelect')?.value || document.getElementById('repoModRepoSelect')?.value;
      if (repoVal && repoVal !== '-- All Repositories --') {
        window.open(`https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoVal)}`, '_blank', 'noopener,noreferrer');
      } else {
        window.open(`https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git`, '_blank', 'noopener,noreferrer');
      }
    });

    // Branch Policies Controls
    document.getElementById('policySearchInput')?.addEventListener('input', (e) => {
      this.policySearchTerm = (e.target.value || '').trim().toLowerCase();
      this.filterAndRenderPolicies();
    });

    document.getElementById('policyTypeFilter')?.addEventListener('change', (e) => {
      this.policyTypeFilterVal = e.target.value || 'all';
      this.filterAndRenderPolicies();
    });

    document.getElementById('policyProjectSelect')?.addEventListener('change', (e) => {
      const topSelect = document.getElementById('projectSelect');
      if (topSelect && topSelect.value !== e.target.value) {
        topSelect.value = e.target.value;
        window.HubApp.handleProjectSelect();
      }
    });

    // Policies scope sync within Policies view only
    const policyRepoFilterSelect = document.getElementById('policyRepoFilterSelect');
    const policyRepoSelect = document.getElementById('policyRepoSelect');
    policyRepoFilterSelect?.addEventListener('change', (e) => {
      if (policyRepoSelect && policyRepoSelect.value !== e.target.value) {
        policyRepoSelect.value = e.target.value;
      }
    });
    policyRepoSelect?.addEventListener('change', (e) => {
      if (policyRepoFilterSelect && policyRepoFilterSelect.value !== e.target.value) {
        policyRepoFilterSelect.value = e.target.value;
      }
    });

    document.getElementById('btnRefreshPolicies')?.addEventListener('click', () => {
      window.HubApp?.execRepoInspect?.('policies');
    });

    // Pull Requests Controls
    document.getElementById('prSearchInput')?.addEventListener('input', (e) => {
      this.prSearchTerm = (e.target.value || '').trim().toLowerCase();
      this.filterAndRenderPrs();
    });

    document.getElementById('prStatusFilter')?.addEventListener('change', (e) => {
      this.prStatusFilterVal = e.target.value || 'all';
      this.filterAndRenderPrs();
    });

    document.getElementById('prProjectSelect')?.addEventListener('change', (e) => {
      const topSelect = document.getElementById('projectSelect');
      if (topSelect && topSelect.value !== e.target.value) {
        topSelect.value = e.target.value;
        window.HubApp.handleProjectSelect();
      }
    });

    // PRs scope sync within PRs view only
    const prRepoFilterSelect = document.getElementById('prRepoFilterSelect');
    const prRepoSelect = document.getElementById('prRepoSelect');
    prRepoFilterSelect?.addEventListener('change', (e) => {
      if (prRepoSelect && prRepoSelect.value !== e.target.value) {
        prRepoSelect.value = e.target.value;
      }
    });
    prRepoSelect?.addEventListener('change', (e) => {
      if (prRepoFilterSelect && prRepoFilterSelect.value !== e.target.value) {
        prRepoFilterSelect.value = e.target.value;
      }
    });

    document.getElementById('btnRefreshPrs')?.addEventListener('click', () => {
      window.HubApp?.execRepoInspect?.('prs');
    });
  },

  setLoading(show) {
    this.isLoading = show;
    const overlay = document.getElementById('repoLoadingOverlay');
    if (overlay) {
      overlay.classList.toggle('hidden', !show);
    }
  },

  updateLastUpdated() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString(undefined, { hour12: false });
    const el = document.getElementById('repoLastUpdatedText');
    if (el) el.textContent = `Last updated: ${timeStr}`;
  },

  formatRelativeTime(dateInput) {
    if (!dateInput) return '—';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '—';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  formatPolicyDetails(p) {
    const typeName = (p.type?.displayName || '').toLowerCase();
    const settings = p.settings || {};

    if (typeName.includes('reviewer') || typeName.includes('minimum number')) {
      const count = settings.minimumApproverCount || 1;
      const creatorVote = settings.creatorVoteCounts === false ? ' (Creator vote prohibited)' : '';
      const resetOnPush = settings.resetOnSourcePush ? ' (Reset on push)' : '';
      return `Min Reviewers: ${count}${creatorVote}${resetOnPush}`;
    }
    if (typeName.includes('build')) {
      const buildDefName = settings.displayName || settings.buildDefinitionId || 'CI Validation Pipeline';
      const manual = settings.manualQueueOnly ? 'Manual run' : 'Automatic trigger';
      return `Build Validation: "${buildDefName}" (${manual})`;
    }
    if (typeName.includes('work item')) {
      return settings.state === 'required' || p.isBlocking ? 'Required linked work item' : 'Optional linked work item';
    }
    if (typeName.includes('comment')) {
      return 'All pull request comments must be resolved';
    }
    if (typeName.includes('status')) {
      return `Status check: ${settings.name || 'External CI service'}`;
    }
    if (typeName.includes('merge strategy') || typeName.includes('pattern')) {
      return `Enforce merge commit / squash pattern`;
    }
    return p.type?.displayName || 'Branch Protection Policy';
  },

  getMatchingPoliciesForBranch(repoId, branchName, allPolicyConfigs) {
    const fullRef = `refs/heads/${branchName}`.toLowerCase();
    const cleanBranch = branchName.toLowerCase();

    return allPolicyConfigs.filter(p => {
      if (!p.isEnabled) return false;
      const scopes = p.settings?.scope || [];

      return scopes.some(sc => {
        if (sc.repositoryId && sc.repositoryId.toLowerCase() !== repoId.toLowerCase()) {
          return false;
        }

        const scopeRef = (sc.refName || '').toLowerCase();
        const cleanScopeRef = scopeRef.replace(/^refs\/heads\//, '');
        const matchKind = (sc.matchKind || 'Exact').toLowerCase();

        if (matchKind === 'exact') {
          return scopeRef === fullRef || cleanScopeRef === cleanBranch;
        } else if (matchKind === 'prefix') {
          return fullRef.startsWith(scopeRef) || cleanBranch.startsWith(cleanScopeRef);
        } else if (matchKind === 'defaultbranch') {
          return false;
        }
        return scopeRef === fullRef || cleanScopeRef === cleanBranch;
      });
    });
  },

  syncProjectDropdowns(project) {
    const topSelect = document.getElementById('projectSelect');
    ['repoModProjectSelect', 'policyProjectSelect', 'prProjectSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el && topSelect) {
        el.innerHTML = topSelect.innerHTML;
        el.value = project;
      }
    });

    // Populate Repo select dropdowns
    const repoOptions = ['<option value="">-- Choose Repository --</option>', '<option value="-- All Repositories --">-- All Repositories --</option>']
      .concat((this.cachedRepos || []).map(r => `<option value="${r.name}">${r.name}</option>`))
      .join('');
    ['repoSelect', 'repoModRepoSelect', 'policyRepoFilterSelect', 'policyRepoSelect', 'prRepoFilterSelect', 'prRepoSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.options.length <= 1) {
        const curVal = el.value;
        el.innerHTML = repoOptions;
        if (curVal) el.value = curVal;
      }
    });
  },

  async inspect(org, project, pat, targetRepoInput, cachedRepos, targetView = null) {
    const view = targetView || window.HubApp?.currentView || 'repositories';
    if (view === 'policies') {
      return this.inspectPolicies(org, project, pat, targetRepoInput, cachedRepos);
    }
    if (view === 'prs') {
      return this.inspectPrs(org, project, pat, targetRepoInput, cachedRepos);
    }
    return this.inspectRepositories(org, project, pat, targetRepoInput, cachedRepos);
  },

  async inspectRepositories(org, project, pat, targetRepoInput, cachedRepos) {
    this.initEvents();
    this.currentOrg = org;
    this.currentProject = project;
    this.currentPat = pat;
    this.cachedRepos = cachedRepos || [];
    this.setLoading(true);

    this.syncProjectDropdowns(project);

    let targetRepos = this.cachedRepos;
    if (targetRepoInput && targetRepoInput !== '-- All Repositories --') {
      targetRepos = this.cachedRepos.filter(r => r.name.toLowerCase() === targetRepoInput.toLowerCase());
      if (!targetRepos.length) {
        targetRepos = this.cachedRepos.filter(r => r.name.trim().toLowerCase() === targetRepoInput.trim().toLowerCase() || r.id === targetRepoInput);
      }
      this.selectedRepo = targetRepos[0] || null;
    } else {
      this.selectedRepo = null;
    }

    if (!targetRepos.length) {
      this.setLoading(false);
      const tbody = document.getElementById('branchesTableBody');
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 30px; text-align: center; color: var(--text-muted);">
              No repositories found for project "${project}".
            </td>
          </tr>
        `;
      }
      return;
    }

    const auth = 'Basic ' + btoa(':' + pat);
    let counts = {};
    const now = new Date();
    let allPolicyConfigs = [];

    // Fetch Project-Level Policy Configurations to compute branch protection badges
    try {
      const policyUrl = `${encodeURIComponent(project)}/_apis/policy/configurations?api-version=6.0&$top=500`;
      const policyData = await window.HubApp.fetchAdo(org, policyUrl, auth);
      allPolicyConfigs = policyData.value || [];
    } catch (e) {
      console.warn('Policy configurations query notice:', e);
    }

    // Fetch Branches & Latest Commits Across Target Repositories
    const repoTasks = targetRepos.map(async (r) => {
      try {
        const res = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/refs?filter=heads/&api-version=6.0`, auth);
        const refs = res.value || [];
        counts[r.name] = refs.length;

        const defaultBranchRef = (r.defaultBranch || 'refs/heads/main').toLowerCase();

        return await Promise.all(refs.map(async (ref) => {
          const bName = ref.name.replace(/^refs\/heads\//, '');
          const isDefault = ref.name.toLowerCase() === defaultBranchRef;
          let topC = null;

          try {
            const cRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(bName)}&$top=1&api-version=6.0`, auth);
            topC = cRes.value?.[0];
          } catch (_) {}

          const d = topC?.author?.date ? new Date(topC.author.date) : null;
          const branchPolicies = this.getMatchingPoliciesForBranch(r.id, bName, allPolicyConfigs);

          const fullCommitId = topC?.commitId || ref.objectId || 'HEAD';
          const commitWebUrl = r.webUrl ? `${r.webUrl}/commit/${fullCommitId}` : `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(r.name)}/commit/${fullCommitId}`;

          return {
            repo: r.name,
            repoId: r.id,
            branch: bName,
            isDefault: isDefault,
            policies: branchPolicies,
            hasPolicy: branchPolicies.length > 0,
            policySummary: branchPolicies.length ? branchPolicies.map(bp => bp.type?.displayName || 'Protected').join(', ') : 'No Policy',
            author: topC?.author?.name || 'Unknown',
            authorEmail: topC?.author?.email || '',
            date: d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
            relativeDate: d ? this.formatRelativeTime(d) : '—',
            rawDate: d,
            isStale: d ? ((now - d) / (1000 * 60 * 60 * 24)) > 90 : false,
            msg: topC?.comment || '',
            commitId: fullCommitId,
            commitUrl: commitWebUrl,
            url: r.webUrl ? `${r.webUrl}?version=GB${encodeURIComponent(bName)}` : `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(r.name)}?version=GB${encodeURIComponent(bName)}`,
            rawRef: ref
          };
        }));
      } catch (e) { return []; }
    });

    const bResults = await Promise.all(repoTasks);
    this.branches = bResults.flat();

    // Default Sort: default branch first, then protected branches, then alphabetical
    this.branches.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      if (a.hasPolicy && !b.hasPolicy) return -1;
      if (!a.hasPolicy && b.hasPolicy) return 1;
      return a.branch.localeCompare(b.branch);
    });

    // Compute Metrics for Repositories Summary Cards
    const totalRepos = this.cachedRepos.length;
    const totalBranches = this.branches.length;
    const activeBranchesCount = this.branches.filter(b => !b.isStale).length;
    const staleBranchesCount = this.branches.filter(b => b.isStale).length;
    const protectedBranchesCount = this.branches.filter(b => b.hasPolicy).length;
    const unprotectedBranchesCount = totalBranches - protectedBranchesCount;

    let defaultBranchName = 'main';
    if (this.selectedRepo) {
      defaultBranchName = (this.selectedRepo.defaultBranch || 'refs/heads/main').replace('refs/heads/', '');
    } else if (this.branches.some(b => b.isDefault)) {
      const defBranch = this.branches.find(b => b.isDefault);
      defaultBranchName = defBranch ? defBranch.branch : 'main';
    }

    // Update Dynamic Repositories Summary Cards
    const valTotalRepos = document.getElementById('repoValTotalRepos');
    const chipActiveRepos = document.getElementById('repoChipActiveRepos');
    if (valTotalRepos) valTotalRepos.textContent = totalRepos;
    if (chipActiveRepos) chipActiveRepos.textContent = `${totalRepos} Active`;

    const valTotalBranches = document.getElementById('repoValTotalBranches');
    if (valTotalBranches) valTotalBranches.textContent = totalBranches;
    const chipScopeBranch = document.getElementById('repoChipScopeBranch');
    if (chipScopeBranch) chipScopeBranch.textContent = targetRepos.length === 1 ? targetRepos[0].name : `${targetRepos.length} Repositories`;

    const valActiveBranches = document.getElementById('repoValActiveBranches');
    const chipActiveCount = document.getElementById('repoChipActiveCount');
    const chipStaleCount = document.getElementById('repoChipStaleCount');
    if (valActiveBranches) valActiveBranches.textContent = activeBranchesCount;
    if (chipActiveCount) chipActiveCount.textContent = `${activeBranchesCount} Active`;
    if (chipStaleCount) chipStaleCount.textContent = `${staleBranchesCount} Stale`;

    const valProtectedBranches = document.getElementById('repoValProtectedBranches');
    const chipProtectedCount = document.getElementById('repoChipProtectedCount');
    const chipUnprotectedCount = document.getElementById('repoChipUnprotectedCount');
    if (valProtectedBranches) valProtectedBranches.textContent = protectedBranchesCount;
    if (chipProtectedCount) chipProtectedCount.textContent = `${protectedBranchesCount} Protected`;
    if (chipUnprotectedCount) chipUnprotectedCount.textContent = `${unprotectedBranchesCount} Unprotected`;

    const valDefaultBranch = document.getElementById('repoValDefaultBranch');
    const subDefaultBranch = document.getElementById('repoSubDefaultBranch');
    if (valDefaultBranch) valDefaultBranch.textContent = defaultBranchName;
    if (subDefaultBranch) subDefaultBranch.textContent = this.selectedRepo ? `Primary target for ${this.selectedRepo.name}` : `Standard default reference`;

    // Update Detailed Repository Information Panel
    this.renderDetailedRepoInfo(project, targetRepos);

    // Update Backward Compatibility KPI Strip if present
    this.updateKpis();

    // Filter and render branch table
    this.filterAndRenderBranches();

    const repoLastUpd = document.getElementById('repoLastUpdatedText');
    if (repoLastUpd) repoLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    this.setLoading(false);

    window.HubApp.renderChart(Object.keys(counts), Object.values(counts), 'Active Branches per Repository');
  },

  async inspectPolicies(org, project, pat, targetRepoInput, cachedRepos) {
    this.initEvents();
    this.currentOrg = org;
    this.currentProject = project;
    this.currentPat = pat;
    this.cachedRepos = cachedRepos || [];
    this.setLoading(true);

    this.syncProjectDropdowns(project);

    let targetRepos = this.cachedRepos;
    if (targetRepoInput && targetRepoInput !== '-- All Repositories --') {
      targetRepos = this.cachedRepos.filter(r => r.name.toLowerCase() === targetRepoInput.toLowerCase());
      if (!targetRepos.length) {
        targetRepos = this.cachedRepos.filter(r => r.name.trim().toLowerCase() === targetRepoInput.trim().toLowerCase() || r.id === targetRepoInput);
      }
    }

    const auth = 'Basic ' + btoa(':' + pat);
    let allPolicyConfigs = [];

    // Fetch Project-Level Policy Configurations
    try {
      const policyUrl = `${encodeURIComponent(project)}/_apis/policy/configurations?api-version=6.0&$top=500`;
      const policyData = await window.HubApp.fetchAdo(org, policyUrl, auth);
      allPolicyConfigs = policyData.value || [];
    } catch (e) {
      console.warn('Policy configurations query notice:', e);
    }

    const targetRepoIds = new Set(targetRepos.map(r => r.id.toLowerCase()));
    const detailedPolicyRows = [];

    allPolicyConfigs.forEach(p => {
      if (p.isDeleted) return;
      const scopes = p.settings?.scope || [];
      const policyType = p.type?.displayName || 'Branch Policy';
      const enforcement = p.isBlocking ? 'Blocking (Required)' : 'Optional';
      const details = this.formatPolicyDetails(p);
      const isEnabled = p.isEnabled !== false;
      const typeName = (policyType || '').toLowerCase();
      const settings = p.settings || {};

      const minReviewers = settings.minimumApproverCount != null ? settings.minimumApproverCount : (typeName.includes('reviewer') ? 1 : '—');
      const hasBuildValidation = typeName.includes('build') || !!settings.buildDefinitionId;
      const requiresCommentResolution = typeName.includes('comment') || !!settings.requireCommentResolution;
      const lastUpdatedDate = p.lastModifiedDate || p.createdDate;
      const lastUpdatedStr = lastUpdatedDate ? new Date(lastUpdatedDate).toLocaleDateString() : '—';

      if (scopes.length === 0) {
        let policySubtitle = '';
        if (settings.displayName && settings.displayName.toLowerCase() !== policyType.toLowerCase()) {
          policySubtitle = settings.displayName;
        } else if (typeName.includes('build') && settings.buildDefinitionId) {
          policySubtitle = `Build Definition #${settings.buildDefinitionId}`;
        } else if (typeName.includes('reviewer') && settings.minimumApproverCount) {
          policySubtitle = `Min ${settings.minimumApproverCount} Approver(s)`;
        }

        detailedPolicyRows.push({
          project: project,
          repo: 'All Repositories',
          branch: 'All Branches',
          policyName: settings.displayName || policyType,
          policyType: policyType,
          policySubtitle: policySubtitle,
          isEnabled: isEnabled,
          isBlocking: !!p.isBlocking,
          enforcement: enforcement,
          details: details,
          minReviewers: minReviewers,
          hasBuildValidation: hasBuildValidation,
          requiresCommentResolution: requiresCommentResolution,
          lastUpdated: lastUpdatedStr,
          rawPolicy: p
        });
      } else {
        scopes.forEach(sc => {
          if (sc.repositoryId && !targetRepoIds.has(sc.repositoryId.toLowerCase())) {
            return;
          }

          const matchingRepo = targetRepos.find(r => r.id.toLowerCase() === (sc.repositoryId || '').toLowerCase());
          const repoDisplayName = matchingRepo ? matchingRepo.name : (sc.repositoryId ? 'Specific Repo' : 'Project Default (All Repos)');
          const refName = (sc.refName || '').replace(/^refs\/heads\//, '');

          let policySubtitle = '';
          if (settings.displayName && settings.displayName.toLowerCase() !== policyType.toLowerCase()) {
            policySubtitle = settings.displayName;
          } else if (typeName.includes('build') && settings.buildDefinitionId) {
            policySubtitle = `Build Definition #${settings.buildDefinitionId}`;
          } else if (typeName.includes('reviewer') && settings.minimumApproverCount) {
            policySubtitle = `Min ${settings.minimumApproverCount} Approver(s)`;
          }

          detailedPolicyRows.push({
            project: project,
            repo: repoDisplayName,
            branch: refName || 'All Branches',
            policyName: settings.displayName || policyType,
            policyType: policyType,
            policySubtitle: policySubtitle,
            isEnabled: isEnabled,
            isBlocking: !!p.isBlocking,
            enforcement: enforcement,
            details: details,
            minReviewers: minReviewers,
            hasBuildValidation: hasBuildValidation,
            requiresCommentResolution: requiresCommentResolution,
            lastUpdated: lastUpdatedStr,
            rawPolicy: p
          });
        });
      }
    });

    this.policies = detailedPolicyRows;

    // Branch Policies Summary Cards
    const totalPolicies = this.policies.length;
    const activePolicies = this.policies.filter(p => p.isEnabled).length;
    const inactivePolicies = this.policies.filter(p => !p.isEnabled).length;
    const blockingPolicies = this.policies.filter(p => p.isEnabled && p.isBlocking).length;

    const policyBranchesSet = new Set(this.policies.map(p => `${p.repo}#${p.branch}`));
    const protectedBranchesCount = policyBranchesSet.size;

    const elPolicyTotal = document.getElementById('policyValTotal');
    if (elPolicyTotal) elPolicyTotal.textContent = totalPolicies;
    const elPolicyScope = document.getElementById('policyChipScope');
    if (elPolicyScope) elPolicyScope.textContent = `${totalPolicies} Configured`;

    const elPolicyActive = document.getElementById('policyValActive');
    if (elPolicyActive) elPolicyActive.textContent = activePolicies;
    const elPolicyBlocking = document.getElementById('policyChipBlocking');
    if (elPolicyBlocking) elPolicyBlocking.textContent = `${blockingPolicies} Blocking`;

    const elPolicyInactive = document.getElementById('policyValInactive');
    if (elPolicyInactive) elPolicyInactive.textContent = inactivePolicies;
    const elPolicyChipInactive = document.getElementById('policyChipInactive');
    if (elPolicyChipInactive) elPolicyChipInactive.textContent = `${inactivePolicies} Inactive`;

    const elPolicyProt = document.getElementById('policyValProtectedBranches');
    if (elPolicyProt) elPolicyProt.textContent = protectedBranchesCount;
    const elPolicyProtRatio = document.getElementById('policyChipProtectedRatio');
    if (elPolicyProtRatio) elPolicyProtRatio.textContent = `${protectedBranchesCount} Protected`;

    const elPolicyUnprot = document.getElementById('policyValUnprotectedBranches');
    if (elPolicyUnprot) elPolicyUnprot.textContent = Math.max(0, targetRepos.length - protectedBranchesCount);
    const elPolicyUnprotRatio = document.getElementById('policyChipUnprotectedRatio');
    if (elPolicyUnprotRatio) elPolicyUnprotRatio.textContent = `Monitored`;

    const elPolicyLastUpd = document.getElementById('policyLastUpdatedText');
    if (elPolicyLastUpd) elPolicyLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    // Render Policies Table
    this.filterAndRenderPolicies();

    this.setLoading(false);
  },

  async inspectPrs(org, project, pat, targetRepoInput, cachedRepos) {
    this.initEvents();
    this.currentOrg = org;
    this.currentProject = project;
    this.currentPat = pat;
    this.cachedRepos = cachedRepos || [];
    this.setLoading(true);

    this.syncProjectDropdowns(project);

    let targetRepos = this.cachedRepos;
    if (targetRepoInput && targetRepoInput !== '-- All Repositories --') {
      targetRepos = this.cachedRepos.filter(r => r.name.toLowerCase() === targetRepoInput.toLowerCase());
      if (!targetRepos.length) {
        targetRepos = this.cachedRepos.filter(r => r.name.trim().toLowerCase() === targetRepoInput.trim().toLowerCase() || r.id === targetRepoInput);
      }
    }

    const auth = 'Basic ' + btoa(':' + pat);

    // Fetch PRs across target repos
    const prTasks = targetRepos.map(async (r) => {
      try {
        const prRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=100&api-version=6.0`, auth);
        return (prRes.value || []).map(pr => {
          const prWebUrl = pr.url ? pr.url.replace('/_apis/git/repositories/', '/_git/').replace('/pullRequests/', '/pullrequest/') : `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(r.name)}/pullrequest/${pr.pullRequestId}`;
          const isDraft = !!pr.isDraft;
          const statusRaw = (pr.status || 'active').toLowerCase();
          const displayStatus = isDraft ? 'draft' : statusRaw;
          const reviewersList = (pr.reviewers || []).map(rv => rv.displayName).filter(Boolean);
          const reviewersStr = reviewersList.length > 0 ? reviewersList.join(', ') : 'No Reviewers';
          const lastUpd = pr.lastMergeCommit?.committer?.date || pr.creationDate;

          return {
            repo: r.name,
            prId: pr.pullRequestId,
            title: `#${pr.pullRequestId}: ${pr.title}`,
            rawTitle: pr.title,
            source: (pr.sourceRefName || '').replace('refs/heads/', ''),
            target: (pr.targetRefName || '').replace('refs/heads/', ''),
            creator: pr.createdBy?.displayName || 'Developer',
            creatorEmail: pr.createdBy?.uniqueName || '',
            reviewers: reviewersStr,
            reviewersCount: reviewersList.length,
            status: displayStatus,
            rawStatus: pr.status,
            isDraft: isDraft,
            createdDate: pr.creationDate ? new Date(pr.creationDate).toLocaleDateString() : '—',
            lastUpdated: lastUpd ? new Date(lastUpd).toLocaleDateString() : '—',
            completionDate: pr.closedDate ? new Date(pr.closedDate).toLocaleDateString() : '—',
            url: prWebUrl,
            rawPr: pr
          };
        });
      } catch (e) { return []; }
    });

    const pResults = await Promise.all(prTasks);
    this.prs = pResults.flat();

    // Pull Requests Summary Cards
    const totalPrs = this.prs.length;
    const activePrs = this.prs.filter(p => p.status === 'active' && !p.isDraft).length;
    const completedPrs = this.prs.filter(p => p.status === 'completed').length;
    const abandonedPrs = this.prs.filter(p => p.status === 'abandoned').length;
    const draftPrs = this.prs.filter(p => p.isDraft || p.status === 'draft').length;

    const elPrTotal = document.getElementById('prValTotal');
    if (elPrTotal) elPrTotal.textContent = totalPrs;
    const elPrScope = document.getElementById('prChipTotalScope');
    if (elPrScope) elPrScope.textContent = `${totalPrs} Total PRs`;

    const elPrActive = document.getElementById('prValActive');
    if (elPrActive) elPrActive.textContent = activePrs;
    const elPrChipActive = document.getElementById('prChipActive');
    if (elPrChipActive) elPrChipActive.textContent = `${activePrs} Active`;

    const elPrComp = document.getElementById('prValCompleted');
    if (elPrComp) elPrComp.textContent = completedPrs;
    const elPrChipComp = document.getElementById('prChipCompleted');
    if (elPrChipComp) elPrChipComp.textContent = `${completedPrs} Completed`;

    const elPrAband = document.getElementById('prValAbandoned');
    if (elPrAband) elPrAband.textContent = abandonedPrs;
    const elPrChipAband = document.getElementById('prChipAbandoned');
    if (elPrChipAband) elPrChipAband.textContent = `${abandonedPrs} Abandoned`;

    const elPrDraft = document.getElementById('prValDraft');
    if (elPrDraft) elPrDraft.textContent = draftPrs;
    const elPrChipDraft = document.getElementById('prChipDraft');
    if (elPrChipDraft) elPrChipDraft.textContent = `${draftPrs} Drafts`;

    const elPrLastUpd = document.getElementById('prLastUpdatedText');
    if (elPrLastUpd) elPrLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    // Render Pull Requests Table
    this.filterAndRenderPrs();

    this.setLoading(false);
  },

  renderDetailedRepoInfo(project, targetRepos) {
    const isSingle = targetRepos.length === 1;
    const r = isSingle ? targetRepos[0] : null;

    const elProject = document.getElementById('repoDetailProject');
    const elName = document.getElementById('repoDetailName');
    const elId = document.getElementById('repoDetailId');
    const elUrl = document.getElementById('repoDetailUrl');
    const elStatus = document.getElementById('repoDetailStatus');
    const elDefaultBranch = document.getElementById('repoDetailDefaultBranch');
    const elTotalBranches = document.getElementById('repoDetailTotalBranches');
    const elCreatedDate = document.getElementById('repoDetailCreatedDate');
    const elLastUpdatedDate = document.getElementById('repoDetailLastUpdatedDate');
    const elLink = document.getElementById('repoDetailExternalLink');

    if (elProject) elProject.textContent = project;

    if (isSingle && r) {
      if (elName) elName.textContent = r.name;
      if (elId) elId.textContent = r.id;
      
      const repoWebUrl = r.webUrl || `https://dev.azure.com/${this.currentOrg}/${encodeURIComponent(project)}/_git/${encodeURIComponent(r.name)}`;
      if (elUrl) {
        elUrl.innerHTML = `<a href="${repoWebUrl}" target="_blank" rel="noopener noreferrer">${repoWebUrl}</a>`;
      }
      if (elStatus) {
        elStatus.innerHTML = r.isDisabled
          ? `<span class="badge badge-canceled">Disabled</span>`
          : `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Active &amp; Well-Formed</span>`;
      }
      const defBranchClean = (r.defaultBranch || 'refs/heads/main').replace('refs/heads/', '');
      if (elDefaultBranch) elDefaultBranch.textContent = defBranchClean;
      if (elTotalBranches) elTotalBranches.textContent = this.branches.length;

      // Find newest commit date
      let newestDate = null;
      this.branches.forEach(b => {
        if (b.rawDate && (!newestDate || b.rawDate > newestDate)) {
          newestDate = b.rawDate;
        }
      });
      if (elCreatedDate) {
        elCreatedDate.textContent = r.project?.lastUpdateTime ? new Date(r.project.lastUpdateTime).toLocaleDateString() : 'Available via API';
      }
      if (elLastUpdatedDate) {
        elLastUpdatedDate.textContent = newestDate ? newestDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      }

      if (elLink) {
        elLink.innerHTML = `
          <a href="${repoWebUrl}" target="_blank" rel="noopener noreferrer" class="mod-btn-action" style="font-size:11.5px; height:28px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Open in Azure DevOps
          </a>
        `;
      }
    } else {
      if (elName) elName.textContent = `All Project Repositories (${targetRepos.length})`;
      if (elId) elId.textContent = 'All Project Scopes';
      const orgWebUrl = `https://dev.azure.com/${this.currentOrg}/${encodeURIComponent(project)}/_git`;
      if (elUrl) {
        elUrl.innerHTML = `<a href="${orgWebUrl}" target="_blank" rel="noopener noreferrer">${orgWebUrl}</a>`;
      }
      if (elStatus) {
        elStatus.innerHTML = `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>All Repositories Active</span>`;
      }
      if (elDefaultBranch) elDefaultBranch.textContent = 'main / master';
      if (elTotalBranches) elTotalBranches.textContent = this.branches.length;
      if (elCreatedDate) elCreatedDate.textContent = 'Project Scope';

      let newestDate = null;
      this.branches.forEach(b => {
        if (b.rawDate && (!newestDate || b.rawDate > newestDate)) {
          newestDate = b.rawDate;
        }
      });
      if (elLastUpdatedDate) {
        elLastUpdatedDate.textContent = newestDate ? newestDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      }

      if (elLink) {
        elLink.innerHTML = `
          <a href="${orgWebUrl}" target="_blank" rel="noopener noreferrer" class="mod-btn-action" style="font-size:11.5px; height:28px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Browse All in ADO
          </a>
        `;
      }
    }
  },

  filterAndRenderBranches() {
    let list = this.branches;

    // Search query
    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(b => {
        return (
          b.branch.toLowerCase().includes(q) ||
          b.repo.toLowerCase().includes(q) ||
          (b.msg && b.msg.toLowerCase().includes(q)) ||
          (b.author && b.author.toLowerCase().includes(q)) ||
          (b.commitId && b.commitId.toLowerCase().includes(q))
        );
      });
    }

    // Status filter
    if (this.statusFilter === 'active') {
      list = list.filter(b => !b.isStale);
    } else if (this.statusFilter === 'stale') {
      list = list.filter(b => b.isStale);
    } else if (this.statusFilter === 'protected') {
      list = list.filter(b => b.hasPolicy);
    } else if (this.statusFilter === 'unprotected') {
      list = list.filter(b => !b.hasPolicy);
    }

    this.filteredBranches = list;
    this.branchIndex = 0;

    const statsEl = document.getElementById('repoTableStats');
    if (statsEl) {
      statsEl.textContent = `Showing ${list.length} of ${this.branches.length} branches`;
    }

    this.renderBranches(false);
  },

  updateKpis() {
    if (!this.branches || this.branches.length === 0) return;
    const staleBranchesCount = this.branches.filter(b => b.isStale).length;
    const activePrsCount = (this.prs || []).filter(p => p.status === 'active').length;
    const completedPrsCount = (this.prs || []).filter(p => p.status === 'completed').length;
    const repoLabel = this.selectedRepo ? this.selectedRepo.name : (document.getElementById('repoSelect')?.value || 'Repositories');

    window.HubApp.setRepoKpis(
      repoLabel,
      this.branches.length,
      staleBranchesCount,
      (this.prs || []).length,
      activePrsCount,
      completedPrsCount
    );
  },

  renderBranches(append = false) {
    const tbody = document.getElementById('branchesTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const list = this.filteredBranches || this.branches;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 36px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 26px; height: 26px; margin: 0 auto 8px; display: block; color: var(--azure-blue);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            No branches match the specified filter criteria.
          </td>
        </tr>
      `;
      const btnContainer = document.getElementById('seeMoreRepoContainer');
      if (btnContainer) btnContainer.classList.add('hidden');
      return;
    }

    const slice = list.slice(this.branchIndex, this.branchIndex + this.pageSize);

    slice.forEach((b, localIdx) => {
      const globalIdx = this.branchIndex + localIdx;
      
      const healthBadge = b.isStale
        ? `<span class="badge badge-stale"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>Stale (&gt;90d)</span>`
        : `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Active</span>`;

      const policyBadge = b.hasPolicy
        ? `<span class="badge badge-succeeded" title="${b.policySummary}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>${b.policies.length} Policy Rules</span>`
        : `<span class="badge badge-canceled"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>No Policy</span>`;

      const defaultChip = b.isDefault ? `<span class="badge-default-branch">DEFAULT</span>` : '';
      const shortSha = b.commitId && b.commitId !== 'HEAD' ? b.commitId.substring(0, 7) : 'HEAD';

      const tr = document.createElement('tr');
      tr.title = 'Click to inspect Branch Policies & Telemetry Blade';
      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--azure-blue); flex-shrink:0;">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
            <code>${b.branch}</code>
            ${defaultChip}
          </div>
        </td>
        <td><strong>${b.repo}</strong></td>
        <td>
          <a href="${b.commitUrl}" target="_blank" rel="noopener noreferrer" class="commit-hash-link" onclick="event.stopPropagation();" title="View commit in Azure DevOps">
            ${shortSha}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </a>
        </td>
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${window.HubApp?.escapeHtml(b.msg) || ''}">
          ${b.msg || '-'}
        </td>
        <td title="${b.authorEmail || ''}">${b.author}</td>
        <td>
          <div>${b.date}</div>
          <div style="font-size:10.5px; color:var(--text-muted);">${b.relativeDate}</div>
        </td>
        <td>${policyBadge}</td>
        <td>${healthBadge}</td>
      `;
      tr.addEventListener('click', () => this.openBranchBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.branchIndex += slice.length;

    const rem = list.length - this.branchIndex;
    const btnContainer = document.getElementById('seeMoreRepoContainer');
    if (btnContainer) {
      btnContainer.classList.toggle('hidden', rem <= 0);
      const remCountEl = document.getElementById('repoRemainingCount');
      if (remCountEl) remCountEl.textContent = rem;
    }
  },

  filterAndRenderPolicies() {
    let list = this.policies;

    // Search query
    if (this.policySearchTerm) {
      const q = this.policySearchTerm;
      list = list.filter(p => {
        return (
          (p.project && p.project.toLowerCase().includes(q)) ||
          (p.repo && p.repo.toLowerCase().includes(q)) ||
          (p.branch && p.branch.toLowerCase().includes(q)) ||
          (p.policyType && p.policyType.toLowerCase().includes(q)) ||
          (p.policyName && p.policyName.toLowerCase().includes(q)) ||
          (p.enforcement && p.enforcement.toLowerCase().includes(q))
        );
      });
    }

    // Type filter
    if (this.policyTypeFilterVal && this.policyTypeFilterVal !== 'all') {
      const tf = this.policyTypeFilterVal.toLowerCase();
      if (tf === 'reviewer') list = list.filter(p => (p.policyType || '').toLowerCase().includes('reviewer'));
      else if (tf === 'build') list = list.filter(p => (p.policyType || '').toLowerCase().includes('build'));
      else if (tf === 'comment') list = list.filter(p => (p.policyType || '').toLowerCase().includes('comment'));
      else if (tf === 'workitem') list = list.filter(p => (p.policyType || '').toLowerCase().includes('work item'));
      else if (tf === 'blocking' || tf === 'required') list = list.filter(p => p.isBlocking);
      else if (tf === 'optional' || tf === 'advisory') list = list.filter(p => !p.isBlocking);
      else if (tf === 'unprotected') list = list.filter(p => !p.isEnabled);
    }

    const statsEl = document.getElementById('policyTableStats');
    if (statsEl) {
      statsEl.textContent = `Showing ${list.length} of ${this.policies.length} policies`;
    }

    const tbody = document.getElementById('policyTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: var(--text-muted);">No policies match the selected criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(p => {
      const statusBadge = p.isEnabled
        ? `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Active</span>`
        : `<span class="badge badge-failed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Inactive</span>`;

      const buildBadge = p.hasBuildValidation
        ? `<span class="badge badge-succeeded">Required</span>`
        : `<span class="badge badge-canceled">No</span>`;

      const commentBadge = p.requiresCommentResolution
        ? `<span class="badge badge-succeeded">Required</span>`
        : `<span class="badge badge-canceled">No</span>`;

      const enforcementBadge = p.isBlocking
        ? `<span class="badge badge-purple" style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; display:inline-flex; align-items:center;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px; height:11px; margin-right:4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Blocking (Required)</span>`
        : `<span class="badge badge-canceled" style="font-size:11px; padding:2px 8px; border-radius:12px; display:inline-flex; align-items:center;">Optional (Advisory)</span>`;

      return `
        <tr>
          <td><strong style="color:var(--text-main);">${p.project}</strong></td>
          <td><strong>${p.repo}</strong></td>
          <td><code class="badge badge-purple">${p.branch}</code></td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="color:var(--text-main); font-size:12.5px;">${p.policyType}</strong>
              ${p.id ? `<code style="font-size:10.5px; color:var(--azure-blue); font-weight:600; padding:1px 5px; border-radius:4px; background:var(--azure-surface-alt); border:1px solid var(--azure-border);" title="Policy Configuration ID #${p.id}">#${p.id}</code>` : ''}
            </div>
            ${p.policySubtitle ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${p.policySubtitle}</div>` : ''}
          </td>
          <td>${enforcementBadge}</td>
          <td>${statusBadge}</td>
          <td>${p.minReviewers}</td>
          <td>${buildBadge}</td>
          <td>${commentBadge}</td>
          <td style="font-size:12px; color:var(--text-muted);">${p.lastUpdated}</td>
        </tr>
      `;
    }).join('');
  },

  renderPolicies() {
    this.filterAndRenderPolicies();
  },

  filterAndRenderPrs() {
    let list = this.prs;

    if (this.prSearchTerm) {
      const q = this.prSearchTerm;
      list = list.filter(p => {
        return (
          String(p.prId).includes(q) ||
          (p.title && p.title.toLowerCase().includes(q)) ||
          (p.repo && p.repo.toLowerCase().includes(q)) ||
          (p.creator && p.creator.toLowerCase().includes(q)) ||
          (p.source && p.source.toLowerCase().includes(q)) ||
          (p.target && p.target.toLowerCase().includes(q))
        );
      });
    }

    if (this.prStatusFilterVal && this.prStatusFilterVal !== 'all') {
      const sf = this.prStatusFilterVal.toLowerCase();
      if (sf === 'draft') list = list.filter(p => p.isDraft || p.status === 'draft');
      else list = list.filter(p => p.status === sf);
    }

    const statsEl = document.getElementById('prTableStats');
    if (statsEl) {
      statsEl.textContent = "Showing " + list.length + " of " + this.prs.length + " pull requests";
    }

    const tbody = document.getElementById('repoPrsTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="padding: 30px; text-align: center; color: var(--text-muted);">No pull requests match the selected criteria.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(p => {
      let statusBadge = '<span class="badge badge-inprogress">' + p.status + '</span>';
      if (p.status === 'completed') statusBadge = '<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Completed</span>';
      else if (p.status === 'abandoned') statusBadge = '<span class="badge badge-canceled">Abandoned</span>';
      else if (p.status === 'draft' || p.isDraft) statusBadge = '<span class="badge badge-warning">Draft</span>';
      else if (p.status === 'active') statusBadge = '<span class="badge badge-active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>Active</span>';

      return '<tr>' +
        '<td><a href="' + p.url + '" target="_blank" rel="noopener noreferrer" class="commit-hash-link">#' + p.prId + '</a></td>' +
        '<td><a href="' + p.url + '" target="_blank" rel="noopener noreferrer" style="font-weight:600; color:var(--text-main);">' + (p.rawTitle || p.title) + '</a></td>' +
        '<td><strong>' + p.repo + '</strong></td>' +
        '<td><code>' + p.source + '</code></td>' +
        '<td><code>' + p.target + '</code></td>' +
        '<td>' + p.creator + '</td>' +
        '<td style="font-size:12px;" title="' + p.reviewers + '">' + p.reviewers + '</td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + p.createdDate + '</td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + p.lastUpdated + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + p.completionDate + '</td>' +
        '</tr>';
    }).join('');
  },

  renderPrs(append = false) {
    this.filterAndRenderPrs();
  },
  openBranchBlade(branchIdx) {
    const list = this.filteredBranches || this.branches;
    const b = list[branchIdx];
    if (!b) return;

    window.BladeController.openBlade({
      title: `${b.repo} / ${b.branch}`,
      subtitle: `Git Branch Matrix & Policy Compliance Telemetry`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Repos > ${b.branch}`,
      adoUrl: b.url,
      rawData: b.rawRef,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="3" x2="6" y2="15"></line>
          <circle cx="18" cy="6" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Branch Health &amp; Metadata
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">REPOSITORY</span>
                <span class="blade-kv-value">${b.repo}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">BRANCH REF</span>
                <span class="blade-kv-value"><code>refs/heads/${b.branch}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">HEALTH STATUS</span>
                <span class="blade-kv-value">${b.isStale ? '<span class="badge badge-stale">Stale Branch (&gt;90 Days)</span>' : '<span class="badge badge-succeeded">Active Branch</span>'}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">POLICY ENFORCEMENT</span>
                <span class="blade-kv-value">${b.hasPolicy ? '<span class="badge badge-succeeded">Protected with Policies</span>' : '<span class="badge badge-canceled">No Branch Policy</span>'}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">LAST COMMIT AUTHOR</span>
                <span class="blade-kv-value">${b.author}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">LAST COMMIT DATE</span>
                <span class="blade-kv-value">${b.date} (${b.relativeDate})</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">LAST COMMIT MESSAGE</span>
                <span class="blade-kv-value" style="font-family:'JetBrains Mono'; font-size:12px; background:#080c14; padding:8px 12px; border-radius:4px; border:1px solid #1b2636;">${b.msg || 'No commit message recorded'}</span>
              </div>
            </div>
          </div>
        `,

        stages: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Enforced Protection Policies (${b.policies.length})
            </div>
            ${b.policies.length ? `
              <table style="font-size:12px;">
                <thead>
                  <tr>
                    <th>POLICY TYPE</th>
                    <th>ENFORCEMENT</th>
                    <th>CONFIGURATION DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  ${b.policies.map(p => `
                    <tr>
                      <td><strong>${p.type?.displayName || 'Branch Policy'}</strong></td>
                      <td><span class="badge ${p.isBlocking ? 'badge-failed' : 'badge-inprogress'}">${p.isBlocking ? 'Blocking (Required)' : 'Optional'}</span></td>
                      <td>${window.RepoModule.formatPolicyDetails(p)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <p style="font-size:12.5px; color:var(--text-muted);">
                ⚠️ No branch protection policies are currently attached to <code>${b.branch}</code>. Pull requests may be merged directly without required peer reviews.
              </p>
            `}
          </div>
        `
      }
    });
  },

  openPrBlade(prIdx) {
    const p = this.prs[prIdx];
    if (!p) return;

    window.BladeController.openBlade({
      title: p.title,
      subtitle: `Pull Request Verification & Review Status`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Pull Requests > #${p.prId}`,
      adoUrl: p.url,
      rawData: p.rawPr,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="18" r="3"></circle>
          <circle cx="6" cy="6" r="3"></circle>
          <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
          <line x1="6" y1="9" x2="6" y2="21"></line>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Pull Request Overview
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">REPOSITORY</span>
                <span class="blade-kv-value">${p.repo}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">STATUS</span>
                <span class="blade-kv-value"><span class="badge ${p.status === 'completed' ? 'badge-succeeded' : 'badge-inprogress'}">${p.status}</span></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">SOURCE BRANCH</span>
                <span class="blade-kv-value"><code>${p.source}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TARGET MERGE BRANCH</span>
                <span class="blade-kv-value"><code>${p.target}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AUTHOR / CREATOR</span>
                <span class="blade-kv-value">${p.creator} (${p.creatorEmail})</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">CREATION DATE</span>
                <span class="blade-kv-value">${p.createdDate}</span>
              </div>
            </div>
          </div>
        `
      }
    });
  }
};
