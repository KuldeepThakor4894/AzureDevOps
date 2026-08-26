window.RepoModule = {
  branches: [],
  branchIndex: 0,
  prs: [],
  prIndex: 0,
  policies: [],
  pageSize: 20,

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
      const buildDefName = settings.displayName || settings.buildDefinitionId || 'CI Pipeline';
      const manual = settings.manualQueueOnly ? 'Manual run' : 'Automatic trigger';
      return `Build Pipeline: "${buildDefName}" (${manual})`;
    }
    if (typeName.includes('work item')) {
      return settings.state === 'required' || p.isBlocking ? 'Required linked work item' : 'Optional linked work item';
    }
    if (typeName.includes('comment')) {
      return 'All pull request comments must be resolved';
    }
    if (typeName.includes('status')) {
      return `Status check: ${settings.name || 'External service'}`;
    }
    if (typeName.includes('merge strategy') || typeName.includes('pattern')) {
      return `Enforce merge pattern / strategy`;
    }
    return p.type?.displayName || 'Branch Protection Policy';
  },

  // Strict Policy Matching Function
  getMatchingPoliciesForBranch(repoId, branchName, allPolicyConfigs) {
    const fullRef = `refs/heads/${branchName}`.toLowerCase();
    const cleanBranch = branchName.toLowerCase();

    return allPolicyConfigs.filter(p => {
      if (!p.isEnabled) return false;
      const scopes = p.settings?.scope || [];

      return scopes.some(sc => {
        // 1. Strict Repository Matching: If scope has a repositoryId, it MUST match this exact repo
        if (sc.repositoryId && sc.repositoryId.toLowerCase() !== repoId.toLowerCase()) {
          return false;
        }

        const scopeRef = (sc.refName || '').toLowerCase();
        const cleanScopeRef = scopeRef.replace(/^refs\/heads\//, '');
        const matchKind = (sc.matchKind || 'Exact').toLowerCase();

        // 2. Exact or Prefix Branch Matching
        if (matchKind === 'exact') {
          return scopeRef === fullRef || cleanScopeRef === cleanBranch;
        } else if (matchKind === 'prefix') {
          return fullRef.startsWith(scopeRef) || cleanBranch.startsWith(cleanScopeRef);
        } else if (matchKind === 'defaultbranch') {
          return false; // Handled per-branch basis if default
        }
        return scopeRef === fullRef || cleanScopeRef === cleanBranch;
      });
    });
  },

  async inspect(org, project, pat, targetRepoInput, cachedRepos) {
    let targetRepos = cachedRepos;
    if (targetRepoInput !== '-- All Repositories --' && targetRepoInput) {
      targetRepos = cachedRepos.filter(r => r.name.toLowerCase().includes(targetRepoInput.toLowerCase()));
    }
    if (!targetRepos.length) throw new Error(`No repository matching "${targetRepoInput}"`);

    const auth = 'Basic ' + btoa(':' + pat);
    let counts = {};
    const now = new Date();
    let allPolicyConfigs = [];

    // 1. Fetch All Project-Level Policy Configurations
    try {
      const policyUrl = `${encodeURIComponent(project)}/_apis/policy/configurations?api-version=6.0&$top=500`;
      const policyData = await window.HubApp.fetchAdo(org, policyUrl, auth);
      allPolicyConfigs = policyData.value || [];
    } catch (e) {
      console.warn('Policy configurations query notice:', e);
    }

    const targetRepoIds = new Set(targetRepos.map(r => r.id.toLowerCase()));
    const detailedPolicyRows = [];

    // Filter detailed policies to only those belonging to the selected repository/repositories
    allPolicyConfigs.forEach(p => {
      if (!p.isEnabled) return;
      const scopes = p.settings?.scope || [];
      const policyType = p.type?.displayName || 'Branch Policy';
      const enforcement = p.isBlocking ? 'Blocking (Required)' : 'Optional';
      const details = this.formatPolicyDetails(p);

      scopes.forEach(sc => {
        // If policy belongs to a specific repo not in current selection, skip
        if (sc.repositoryId && !targetRepoIds.has(sc.repositoryId.toLowerCase())) {
          return;
        }

        const matchingRepo = targetRepos.find(r => r.id.toLowerCase() === (sc.repositoryId || '').toLowerCase());
        const repoDisplayName = matchingRepo ? matchingRepo.name : (sc.repositoryId ? 'Specific Repo' : 'Project Default (All Repos)');
        const refName = (sc.refName || '').replace(/^refs\/heads\//, '');

        detailedPolicyRows.push({
          repo: repoDisplayName,
          branch: refName || 'All Branches',
          policyType: policyType,
          enforcement: enforcement,
          details: details,
          isBlocking: p.isBlocking
        });
      });
    });

    this.policies = detailedPolicyRows;

    // 2. Fetch Branches & PRs Across Target Repositories
    const repoTasks = targetRepos.map(async (r) => {
      try {
        const res = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/refs?filter=heads/&api-version=6.0`, auth);
        const refs = res.value || [];
        counts[r.name] = refs.length;

        return await Promise.all(refs.map(async (ref) => {
          const bName = ref.name.replace(/^refs\/heads\//, '');
          const cRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(bName)}&$top=1&api-version=6.0`, auth);
          const topC = cRes.value?.[0];
          const d = topC?.author?.date ? new Date(topC.author.date) : null;

          // Strict match: Only policies assigned to this specific repository and branch
          const branchPolicies = this.getMatchingPoliciesForBranch(r.id, bName, allPolicyConfigs);

          return {
            repo: r.name,
            branch: bName,
            policies: branchPolicies,
            hasPolicy: branchPolicies.length > 0,
            policySummary: branchPolicies.length ? branchPolicies.map(bp => bp.type?.displayName || 'Protected').join(', ') : 'No Policy',
            author: topC?.author?.name || 'Unknown',
            date: d ? d.toLocaleDateString() : 'N/A',
            isStale: d ? ((now - d) / (1000 * 60 * 60 * 24)) > 90 : false,
            msg: topC?.comment || ''
          };
        }));
      } catch (e) { return []; }
    });

    // Fetch PRs
    const prTasks = targetRepos.map(async (r) => {
      try {
        const prRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=100&api-version=6.0`, auth);
        return (prRes.value || []).map(pr => ({
          repo: r.name,
          title: `#${pr.pullRequestId}: ${pr.title}`,
          source: pr.sourceRefName?.replace('refs/heads/', ''),
          target: pr.targetRefName?.replace('refs/heads/', ''),
          creator: pr.createdBy?.displayName || '-',
          status: pr.status,
          createdDate: new Date(pr.creationDate).toLocaleDateString()
        }));
      } catch (e) { return []; }
    });

    const [bResults, pResults] = await Promise.all([Promise.all(repoTasks), Promise.all(prTasks)]);
    this.branches = bResults.flat();
    this.branchIndex = 0;
    this.prs = pResults.flat();
    this.prIndex = 0;

    // Sort: Protected branches first, then alphabetical
    this.branches.sort((a, b) => (b.hasPolicy ? 1 : 0) - (a.hasPolicy ? 1 : 0) || a.branch.localeCompare(b.branch));
    const totalProtectedBranches = this.branches.filter(b => b.hasPolicy).length;

    window.HubApp.setKpis(
      targetRepos.length === 1 ? targetRepos[0].name : `${project} (${targetRepos.length} Repos)`,
      'Repositories',
      targetRepos.length,
      'Total Branches',
      this.branches.length,
      'Protected Branches',
      totalProtectedBranches
    );

    this.renderBranches(false);
    this.renderPolicies();
    this.renderPrs(false);

    window.HubApp.renderChart(Object.keys(counts), Object.values(counts), 'Branches per Repository');
  },

  renderBranches(append = false) {
    const tbody = document.getElementById('branchesTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const slice = this.branches.slice(this.branchIndex, this.branchIndex + this.pageSize);
    this.branchIndex += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(b => {
      let policyBadge = b.hasPolicy
        ? `<span class="badge badge-active" title="${b.policySummary}">🛡️ ${b.policies.length} Policies Configured</span>`
        : `<span class="badge" style="background:#f1f5f9; color:#94a3b8;">No Policy</span>`;

      return `
        <tr>
          <td><strong>${b.repo}</strong></td>
          <td><code>${b.branch}</code></td>
          <td><span class="badge ${b.isStale ? 'badge-stale' : 'badge-active'}">${b.isStale ? 'Stale' : 'Active'}</span></td>
          <td>${policyBadge}</td>
          <td>${b.author}</td>
          <td>${b.date}</td>
          <td>${b.msg}</td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="7" class="p-4 text-center text-slate-400">No branches found.</td></tr>`);

    const rem = this.branches.length - this.branchIndex;
    const btnContainer = document.getElementById('seeMoreRepoContainer');
    if (btnContainer) {
      btnContainer.classList.toggle('hidden', rem <= 0);
      document.getElementById('repoRemainingCount').textContent = rem;
    }
  },

  renderPolicies() {
    const tbody = document.getElementById('policyTableBody');
    if (!tbody) return;

    if (this.policies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No branch policies configured for this repository.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.policies.map(p => `
      <tr>
        <td><strong>${p.repo}</strong></td>
        <td><code>${p.branch}</code></td>
        <td><strong>${p.policyType}</strong></td>
        <td><span class="badge ${p.isBlocking ? 'badge-stale' : 'badge-blue'}">${p.enforcement}</span></td>
        <td>${p.details}</td>
        <td><span class="badge badge-active">Active & Enabled</span></td>
      </tr>
    `).join('');
  },

  renderPrs(append = false) {
    const tbody = document.getElementById('repoPrsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const slice = this.prs.slice(this.prIndex, this.prIndex + this.pageSize);
    this.prIndex += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(p => `
      <tr>
        <td><strong>${p.repo}</strong></td>
        <td><strong>${p.title}</strong></td>
        <td><code>${p.source} → ${p.target}</code></td>
        <td>${p.creator}</td>
        <td><span class="badge badge-blue">${p.status}</span></td>
        <td>${p.createdDate}</td>
      </tr>
    `).join('') || `<tr><td colspan="6" class="p-4 text-center text-slate-400">No pull requests found.</td></tr>`);

    const rem = this.prs.length - this.prIndex;
    const btnContainer = document.getElementById('seeMoreRepoPrsContainer');
    if (btnContainer) {
      btnContainer.classList.toggle('hidden', rem <= 0);
      document.getElementById('repoPrsRemainingCount').textContent = rem;
    }
  }
};
