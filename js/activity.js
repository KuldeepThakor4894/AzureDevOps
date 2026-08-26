window.ActivityModule = {
  commits: [],
  commitIndex: 0,
  prs: [],
  prIndex: 0,
  pageSize: 20,

  async fetch(org, project, pat, query, days, cachedRepos) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (query || '').trim().toLowerCase();
    let userCommits = [];
    let userPRs = [];
    let authorCounts = {};
    let reposWithActivity = new Set();

    // Calculate cutoff date based on selected timeframe
    let fromDate = null;
    let fromDateStr = '';
    if (days > 0) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = `&searchCriteria.fromDate=${encodeURIComponent(fromDate.toISOString())}`;
    }

    // Ensure we have repositories
    let targetRepos = cachedRepos;
    if (!targetRepos || targetRepos.length === 0) {
      try {
        const repoData = await window.HubApp.fetchAdo(
          org,
          `${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1-preview.1`,
          auth
        );
        targetRepos = repoData.value || [];
      } catch (e) {
        targetRepos = [];
      }
    }

    // Scan Commits and Pull Requests in parallel across repositories
    const tasks = targetRepos.map(async (r) => {
      // 1. Fetch Commits
      const commitsPromise = (async () => {
        try {
          const cRes = await window.HubApp.fetchAdo(
            org,
            `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?$top=500${fromDateStr}&api-version=7.1-preview.1`,
            auth
          );
          const commitList = cRes.value || [];

          commitList.forEach(c => {
            const authorName = c.author?.name || c.committer?.name || 'Unknown';
            const authorEmail = c.author?.email || c.committer?.email || '';
            const authorDate = c.author?.date ? new Date(c.author.date) : (c.committer?.date ? new Date(c.committer.date) : null);

            // Timeframe check
            if (fromDate && authorDate && authorDate < fromDate) return;

            // User query match check
            if (
              !qLower ||
              authorName.toLowerCase().includes(qLower) ||
              authorEmail.toLowerCase().includes(qLower)
            ) {
              reposWithActivity.add(r.name);
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
          console.warn(`Commits fetch error for repo ${r.name}:`, e);
        }
      })();

      // 2. Fetch Pull Requests (Active, Completed, & Abandoned)
      const prsPromise = (async () => {
        try {
          // Fetch with searchCriteria.status=all and higher top limit
          const prUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=250&api-version=7.1-preview.1`;
          const pRes = await window.HubApp.fetchAdo(org, prUrl, auth);
          const prList = pRes.value || [];

          prList.forEach(p => {
            const creatorName = p.createdBy?.displayName || '';
            const creatorEmail = p.createdBy?.uniqueName || p.createdBy?.mailAddress || '';
            const createdDate = p.creationDate ? new Date(p.creationDate) : null;
            const closedDate = p.closedDate ? new Date(p.closedDate) : null;

            // Timeframe check against creation or completion date
            const effectiveDate = closedDate || createdDate;
            if (fromDate && effectiveDate && effectiveDate < fromDate) return;

            // User query match check against PR creator
            if (
              !qLower ||
              creatorName.toLowerCase().includes(qLower) ||
              creatorEmail.toLowerCase().includes(qLower)
            ) {
              reposWithActivity.add(r.name);

              userPRs.push({
                repo: r.name,
                title: `#${p.pullRequestId}: ${p.title}`,
                source: p.sourceRefName ? p.sourceRefName.replace('refs/heads/', '') : '-',
                target: p.targetRefName ? p.targetRefName.replace('refs/heads/', '') : '-',
                status: p.status || 'unknown',
                date: createdDate ? createdDate.toLocaleDateString() : 'N/A',
                rawDate: createdDate ? createdDate.getTime() : 0
              });
            }
          });
        } catch (e) {
          console.warn(`PRs fetch error for repo ${r.name}:`, e);
        }
      })();

      return Promise.all([commitsPromise, prsPromise]);
    });

    await Promise.all(tasks);

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
      reposWithActivity.size,
      'Pull Requests',
      userPRs.length,
      'Commits',
      userCommits.length
    );

    // Render table batches
    this.renderCommits(false);
    this.renderPRs(false);

    // Render activity distribution chart
    const chartLabels = Object.keys(authorCounts).slice(0, 10);
    const chartValues = Object.values(authorCounts).slice(0, 10);
    window.HubApp.renderChart(
      chartLabels.length ? chartLabels : [query || 'User Activity'],
      chartValues.length ? chartValues : [userCommits.length],
      'Commits by Author'
    );
  },

  renderCommits(append = false) {
    const tbody = document.getElementById('userCommitsTableBody');
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
