window.ActivityModule = {
  commits: [],
  commitIndex: 0,
  prs: [],
  prIndex: 0,
  pageSize: 25,

  async fetch(org, project, pat, query, days, cachedRepos) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (query || '').trim().toLowerCase();
    let userCommits = [];
    let userPRs = [];
    let authorCounts = {};
    let activeReposSet = new Set();
    const processedPrIds = new Set();

    // 1. Calculate timeframe cutoff date
    let fromDate = null;
    let fromDateStr = '';
    if (days > 0) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = `&searchCriteria.fromDate=${encodeURIComponent(fromDate.toISOString())}`;
    }

    // Ensure we have repositories list
    let targetRepos = cachedRepos;
    if (!targetRepos || targetRepos.length === 0) {
      try {
        const repoData = await window.HubApp.fetchAdo(
          org,
          `${encodeURIComponent(project)}/_apis/git/repositories?api-version=6.0`,
          auth
        );
        targetRepos = repoData.value || [];
      } catch (e) {
        targetRepos = [];
      }
    }

    // Helper to check if a user string matches the query
    const isUserMatch = (userObj) => {
      if (!qLower) return true;
      if (!userObj) return false;
      const name = (userObj.displayName || userObj.name || '').toLowerCase();
      const email = (userObj.uniqueName || userObj.mailAddress || userObj.email || '').toLowerCase();
      return name.includes(qLower) || email.includes(qLower);
    };

    // Helper to safely add PR
    const addPullRequest = (pr, repoName) => {
      if (!pr || processedPrIds.has(pr.pullRequestId)) return;

      const createdDate = pr.creationDate ? new Date(pr.creationDate) : null;
      const closedDate = pr.closedDate ? new Date(pr.closedDate) : null;
      const effectiveDate = closedDate || createdDate;

      // Timeframe validation
      if (fromDate && effectiveDate && effectiveDate < fromDate) return;

      // Match against creator or reviewers
      const isCreator = isUserMatch(pr.createdBy);
      const isReviewer = (pr.reviewers || []).some(r => isUserMatch(r));

      if (isCreator || isReviewer) {
        processedPrIds.add(pr.pullRequestId);
        const resolvedRepoName = repoName || pr.repository?.name || project;
        activeReposSet.add(resolvedRepoName);

        userPRs.push({
          repo: resolvedRepoName,
          title: `#${pr.pullRequestId}: ${pr.title || 'Untitled PR'}`,
          source: pr.sourceRefName ? pr.sourceRefName.replace('refs/heads/', '') : '-',
          target: pr.targetRefName ? pr.targetRefName.replace('refs/heads/', '') : '-',
          status: pr.status || 'unknown',
          date: effectiveDate ? effectiveDate.toLocaleDateString() : 'N/A',
          rawDate: effectiveDate ? effectiveDate.getTime() : 0,
          role: isCreator ? 'Author' : 'Reviewer'
        });
      }
    };

    // 2. Fetch Project-Level Pull Requests (Unified Call for all active + completed + abandoned PRs)
    const prStatuses = ['all', 'completed', 'active', 'abandoned'];
    await Promise.all(
      prStatuses.map(async (status) => {
        try {
          const prProjectUrl = `${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.status=${status}&$top=500&api-version=6.0`;
          const prData = await window.HubApp.fetchAdo(org, prProjectUrl, auth);
          (prData.value || []).forEach(p => addPullRequest(p, p.repository?.name));
        } catch (err) {
          console.warn(`Project-level PR fetch (${status}) notice:`, err);
        }
      })
    );

    // 3. Scan Commits & Repository-Level PR Fallback in Parallel
    const repoTasks = targetRepos.map(async (r) => {
      // Fetch Commits
      const commitsTask = (async () => {
        try {
          const cRes = await window.HubApp.fetchAdo(
            org,
            `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?$top=500${fromDateStr}&api-version=6.0`,
            auth
          );
          const commitList = cRes.value || [];

          commitList.forEach(c => {
            const authorName = c.author?.name || c.committer?.name || 'Unknown';
            const authorEmail = c.author?.email || c.committer?.email || '';
            const authorDate = c.author?.date ? new Date(c.author.date) : (c.committer?.date ? new Date(c.committer.date) : null);

            if (fromDate && authorDate && authorDate < fromDate) return;

            if (
              !qLower ||
              authorName.toLowerCase().includes(qLower) ||
              authorEmail.toLowerCase().includes(qLower)
            ) {
              activeReposSet.add(r.name);
              authorCounts[authorName] = (authorCounts[authorName] || 0) + 1;

              userCommits.push({
                repo: r.name,
                commitId: c.commitId ? c.commitId.substring(0, 8) : '',
                author: authorName,
                date: authorDate ? authorDate.toLocaleDateString() : 'N/A',
                rawDate: authorDate ? authorDate.getTime() : 0,
                msg: c.comment || ''
              });
            }
          });
        } catch (e) {
          console.warn(`Commits fetch notice for repo ${r.name}:`, e);
        }
      })();

      // Fallback Repository-level PR query
      const repoPrTask = (async () => {
        try {
          const repoPrUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=200&api-version=6.0`;
          const rPrData = await window.HubApp.fetchAdo(org, repoPrUrl, auth);
          (rPrData.value || []).forEach(p => addPullRequest(p, r.name));
        } catch (e) { }
      })();

      return Promise.all([commitsTask, repoPrTask]);
    });

    await Promise.all(repoTasks);

    // Sort newest first
    userCommits.sort((a, b) => b.rawDate - a.rawDate);
    userPRs.sort((a, b) => b.rawDate - a.rawDate);

    this.commits = userCommits;
    this.commitIndex = 0;
    this.prs = userPRs;
    this.prIndex = 0;

    // Update KPI summary cards
    window.HubApp.setKpis(
      query || `${project} (All Activity)`,
      'Active Repos',
      activeReposSet.size,
      'Pull Requests',
      userPRs.length,
      'Commits',
      userCommits.length
    );

    // Render tables
    this.renderCommits(false);
    this.renderPRs(false);

    // Render activity distribution chart
    const chartLabels = Object.keys(authorCounts).slice(0, 10);
    const chartValues = Object.values(authorCounts).slice(0, 10);
    window.HubApp.renderChart(
      chartLabels.length ? chartLabels : [query || 'User Activity'],
      chartValues.length ? chartValues : [userCommits.length || userPRs.length],
      'Commits / PR Activity'
    );
  },

  renderCommits(append = false) {
    const tbody = document.getElementById('userCommitsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.commits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No commits found for the selected timeframe.</td></tr>`;
      document.getElementById('seeMoreCommitsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.commits.slice(this.commitIndex, this.commitIndex + this.pageSize);
    this.commitIndex += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(c => `
        <tr>
          <td><strong>${c.repo}</strong></td>
          <td><code>${c.commitId}</code></td>
          <td>${c.author}</td>
          <td>${c.date}</td>
          <td>${c.msg}</td>
        </tr>
      `).join('')
    );

    const rem = this.commits.length - this.commitIndex;
    const moreBtn = document.getElementById('seeMoreCommitsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('commitsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  renderPRs(append = false) {
    const tbody = document.getElementById('userPrTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.prs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No pull requests found for the selected timeframe.</td></tr>`;
      return;
    }

    const slice = this.prs.slice(this.prIndex, this.prIndex + this.pageSize);
    this.prIndex += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(p => {
        let badgeClass = 'badge-active';
        if (p.status === 'completed') badgeClass = 'badge-active';
        if (p.status === 'active') badgeClass = 'badge-blue';
        if (p.status === 'abandoned') badgeClass = 'badge-stale';

        return `
          <tr>
            <td><strong>${p.repo}</strong></td>
            <td><strong>${p.title}</strong></td>
            <td><code>${p.source} → ${p.target}</code></td>
            <td><span class="badge ${badgeClass}">${p.status}</span></td>
            <td>${p.date}</td>
          </tr>
        `;
      }).join('')
    );
  }
};
