// Azure DevOps Intelligence Hub - User Activity & Commits Module
window.ActivityModule = {
  commits: [],
  commitIndex: 0,
  prs: [],
  prIndex: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',

  async fetch(org, project, pat, query, days, cachedRepos) {
    this.currentOrg = org;
    this.currentProject = project;
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = (query || '').trim().toLowerCase();
    let userCommits = [];
    let userPRs = [];
    let authorCounts = {};
    let activeReposSet = new Set();
    const processedPrIds = new Set();

    let fromDate = null;
    let fromDateStr = '';
    if (days > 0) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = `&searchCriteria.fromDate=${encodeURIComponent(fromDate.toISOString())}`;
    }

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

    const isUserMatch = (userObj) => {
      if (!qLower) return true;
      if (!userObj) return false;
      const name = (userObj.displayName || userObj.name || '').toLowerCase();
      const email = (userObj.uniqueName || userObj.mailAddress || userObj.email || '').toLowerCase();
      return name.includes(qLower) || email.includes(qLower);
    };

    const addPullRequest = (pr, repoName) => {
      if (!pr || processedPrIds.has(pr.pullRequestId)) return;

      const createdDate = pr.creationDate ? new Date(pr.creationDate) : null;
      const closedDate = pr.closedDate ? new Date(pr.closedDate) : null;
      const effectiveDate = closedDate || createdDate;

      if (fromDate && effectiveDate && effectiveDate < fromDate) return;

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
          role: isCreator ? 'Author' : 'Reviewer',
          authorName: pr.createdBy?.displayName || 'Unknown',
          authorEmail: pr.createdBy?.uniqueName || '',
          url: pr.url ? pr.url.replace('/_apis/git/repositories/', '/_git/').replace('/pullRequests/', '/pullrequest/') : `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(resolvedRepoName)}/pullrequest/${pr.pullRequestId}`,
          rawPr: pr
        });
      }
    };

    // 2. Fetch Project-Level Pull Requests
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

    // 3. Scan Commits & Repository-Level PR Fallback
    const repoTasks = targetRepos.map(async (r) => {
      const commitsTask = (async () => {
        try {
          let commitsUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?$top=200${fromDateStr}&api-version=6.0`;
          if (qLower && qLower.includes('@')) {
            commitsUrl += `&searchCriteria.author=${encodeURIComponent(qLower)}`;
          }

          const cRes = await window.HubApp.fetchAdo(org, commitsUrl, auth);
          const rawCommits = cRes.value || [];

          rawCommits.forEach(c => {
            const author = c.author || {};
            const d = author.date ? new Date(author.date) : null;
            if (fromDate && d && d < fromDate) return;

            if (isUserMatch(author)) {
              activeReposSet.add(r.name);
              const authorName = author.name || 'Unknown';
              authorCounts[authorName] = (authorCounts[authorName] || 0) + 1;

              userCommits.push({
                repo: r.name,
                repoId: r.id,
                commitId: c.commitId ? c.commitId.substring(0, 8) : 'HEAD',
                fullCommitId: c.commitId || '',
                author: authorName,
                authorEmail: author.email || '',
                date: d ? d.toLocaleDateString() : 'N/A',
                rawDate: d ? d.getTime() : 0,
                msg: c.comment || '',
                url: c.remoteUrl || `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(r.name)}/commit/${c.commitId}`,
                rawCommit: c
              });
            }
          });
        } catch (err) {
          console.warn(`Commits query error on ${r.name}:`, err);
        }
      })();

      return commitsTask;
    });

    await Promise.all(repoTasks);

    userCommits.sort((a, b) => b.rawDate - a.rawDate);
    userPRs.sort((a, b) => b.rawDate - a.rawDate);

    this.commits = userCommits;
    this.commitIndex = 0;
    this.prs = userPRs;
    this.prIndex = 0;

    // Update KPIs
    window.HubApp.setKpis(
      query || project,
      'Commits Found',
      this.commits.length,
      'Pull Requests',
      this.prs.length,
      'Active Repos',
      activeReposSet.size
    );

    this.renderCommits(false);
    this.renderPRs();

    // Render chart
    const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const chartLabels = topAuthors.length ? topAuthors.map(a => a[0]) : ['No Commits'];
    const chartValues = topAuthors.length ? topAuthors.map(a => a[1]) : [0];

    window.HubApp.renderChart(chartLabels, chartValues, 'Commits by Contributor');
  },

  renderCommits(append = false) {
    const tbody = document.getElementById('userCommitsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.commits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No commits found for this user in selected timeframe.</td></tr>`;
      document.getElementById('seeMoreCommitsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.commits.slice(this.commitIndex, this.commitIndex + this.pageSize);

    slice.forEach((c, localIdx) => {
      const globalIdx = this.commitIndex + localIdx;
      const tr = document.createElement('tr');
      tr.title = 'Click to inspect Commit Telemetry Blade';
      tr.innerHTML = `
        <td><strong>${c.repo}</strong></td>
        <td><code>${c.commitId}</code></td>
        <td>${c.author}</td>
        <td>${c.date}</td>
        <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.msg}</td>
      `;
      tr.addEventListener('click', () => this.openCommitBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.commitIndex += slice.length;

    const rem = this.commits.length - this.commitIndex;
    const btnContainer = document.getElementById('seeMoreCommitsContainer');
    if (btnContainer) {
      btnContainer.classList.toggle('hidden', rem <= 0);
      document.getElementById('commitsRemainingCount').textContent = rem;
    }
  },

  renderPRs() {
    const tbody = document.getElementById('userPrTableBody');
    if (!tbody) return;

    if (this.prs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No pull requests found.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.prs.map(p => {
      let statusBadge = `<span class="badge badge-inprogress">${p.status}</span>`;
      if (p.status === 'completed') statusBadge = `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>Completed</span>`;
      if (p.status === 'abandoned') statusBadge = `<span class="badge badge-canceled">Abandoned</span>`;

      return `
        <tr>
          <td><strong>${p.repo}</strong></td>
          <td><strong>${p.title}</strong></td>
          <td><code>${p.source} ➔ ${p.target}</code></td>
          <td>${statusBadge}</td>
          <td>${p.date}</td>
        </tr>
      `;
    }).join('');
  },

  openCommitBlade(commitIdx) {
    const c = this.commits[commitIdx];
    if (!c) return;

    window.BladeController.openBlade({
      title: `Commit ${c.commitId}`,
      subtitle: `Git Changeset Telemetry & Code Attribution`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Commits > ${c.commitId}`,
      adoUrl: c.url,
      rawData: c.rawCommit,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Commit Metadata
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">REPOSITORY</span>
                <span class="blade-kv-value">${c.repo}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">COMMIT SHA</span>
                <span class="blade-kv-value"><code>${c.fullCommitId || c.commitId}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AUTHOR</span>
                <span class="blade-kv-value">${c.author}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">EMAIL ADDRESS</span>
                <span class="blade-kv-value">${c.authorEmail || 'N/A'}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">COMMIT DATE</span>
                <span class="blade-kv-value">${c.date}</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">COMMIT MESSAGE</span>
                <span class="blade-kv-value" style="font-family:'JetBrains Mono'; font-size:12px; background:#080c14; padding:8px 12px; border-radius:4px; border:1px solid #1b2636;">${c.msg || 'No commit message'}</span>
              </div>
            </div>
          </div>
        `
      }
    });
  }
};
