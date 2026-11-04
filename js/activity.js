// Azure DevOps Intelligence Hub - User Activity & Commits Module
window.ActivityModule = {
  commits: [],
  allCommits: [],
  commitIndex: 0,
  prs: [],
  prIndex: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',

  async fetch(org, project, pat, query, days, cachedRepos) {
    this.currentOrg = org;
    this.currentProject = project;
    this.currentQuery = (query || '').trim();
    const auth = 'Basic ' + btoa(':' + pat);
    const qRaw = (query || '').trim().toLowerCase();

    // Prepare search tokens (full query, alias before @, individual name words)
    const qTokens = [];
    if (qRaw) {
      qTokens.push(qRaw);
      if (qRaw.includes('@')) {
        const alias = qRaw.split('@')[0].trim();
        if (alias && alias.length >= 2) {
          qTokens.push(alias);
          alias.split(/[\._\-]/).forEach(p => {
            if (p.length >= 2) qTokens.push(p);
          });
        }
      } else {
        qRaw.split(/[\s\._\-]+/).forEach(p => {
          if (p.length >= 2) qTokens.push(p);
        });
      }
    }

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
          `${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1-preview.1`,
          auth
        );
        targetRepos = repoData?.value || [];
      } catch (e) {
        try {
          const repoDataFallback = await window.HubApp.fetchAdo(
            org,
            `${encodeURIComponent(project)}/_apis/git/repositories?api-version=6.0`,
            auth
          );
          targetRepos = repoDataFallback?.value || [];
        } catch (e2) {
          targetRepos = [];
        }
      }
    }

    const isUserMatch = (userObj) => {
      if (!qRaw) return true;
      if (!userObj) return false;

      let name = '';
      let email = '';
      let uniqueName = '';

      if (typeof userObj === 'string') {
        name = userObj.toLowerCase();
      } else {
        name = (userObj.displayName || userObj.name || '').toLowerCase();
        email = (userObj.email || userObj.mailAddress || '').toLowerCase();
        uniqueName = (userObj.uniqueName || userObj.principalName || '').toLowerCase();
      }

      // 1. Direct substring match with full search query
      if (name && (name.includes(qRaw) || qRaw.includes(name))) return true;
      if (email && (email.includes(qRaw) || qRaw.includes(email))) return true;
      if (uniqueName && (uniqueName.includes(qRaw) || qRaw.includes(uniqueName))) return true;

      // 2. Token match (alias before @, first name, last name)
      for (const t of qTokens) {
        if (name && name.includes(t)) return true;
        if (email && email.includes(t)) return true;
        if (uniqueName && uniqueName.includes(t)) return true;
      }

      return false;
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

    // 1. Fetch Project-Level Pull Requests (attempt project-wide query first)
    try {
      const prProjectUrl = `${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.status=all&$top=200&api-version=6.0`;
      const prData = await window.HubApp.fetchAdo(org, prProjectUrl, auth);
      (prData?.value || []).forEach(p => addPullRequest(p, p.repository?.name));
    } catch (err) {
      // Per-repository scan below will catch all PRs reliably
    }

    // 2. Scan Commits & Per-Repository Pull Requests in parallel
    const repoTasks = targetRepos.map(async (r) => {
      // Per-repo PR scan guarantees coverage across all ADO server versions
      const prTask = (async () => {
        try {
          const repoPrUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=100&api-version=6.0`;
          const prRes = await window.HubApp.fetchAdo(org, repoPrUrl, auth);
          (prRes?.value || []).forEach(p => addPullRequest(p, r.name));
        } catch (pErr) {
          /* ignore per-repo PR failures */
        }
      })();

      // Commits scan without server-side author filter (server filter expects name, not email)
      const commitsTask = (async () => {
        try {
          let rawCommits = [];
          let commitsUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?$top=250&api-version=6.0`;
          if (fromDateStr) {
            commitsUrl += fromDateStr;
          }

          const cRes = await window.HubApp.fetchAdo(org, commitsUrl, auth);
          rawCommits = cRes?.value || [];

          // Resilient fallback: if server fromDate query returned empty, query without server date and filter client-side
          if (rawCommits.length === 0 && fromDateStr) {
            const fallbackUrl = `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?$top=100&api-version=6.0`;
            const fRes = await window.HubApp.fetchAdo(org, fallbackUrl, auth);
            rawCommits = fRes?.value || [];
          }

          rawCommits.forEach(c => {
            const author = c.author || {};
            const committer = c.committer || {};
            const d = author.date ? new Date(author.date) : (committer.date ? new Date(committer.date) : null);
            if (fromDate && d && d < fromDate) return;

            if (isUserMatch(author) || isUserMatch(committer)) {
              activeReposSet.add(r.name);
              const authorObj = isUserMatch(author) ? author : (committer.name ? committer : author);
              const authorName = authorObj.name || committer.name || 'Unknown';
              authorCounts[authorName] = (authorCounts[authorName] || 0) + 1;

              userCommits.push({
                repo: r.name,
                repoId: r.id,
                branch: (r.defaultBranch ? r.defaultBranch.replace('refs/heads/', '') : 'main'),
                commitId: c.commitId ? c.commitId.substring(0, 8) : 'HEAD',
                fullCommitId: c.commitId || '',
                author: authorName,
                authorEmail: authorObj.email || committer.email || '',
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

      return Promise.all([prTask, commitsTask]);
    });

    await Promise.all(repoTasks);

    userCommits.sort((a, b) => b.rawDate - a.rawDate);
    userPRs.sort((a, b) => b.rawDate - a.rawDate);

    this.allCommits = userCommits;
    this.commits = userCommits;
    this.commitIndex = 0;
    this.prs = userPRs;
    this.prIndex = 0;

    // Compute metrics for 6 dynamic summary cards
    const nowTime = new Date().getTime();
    const oneDayAgo = nowTime - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = nowTime - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = nowTime - 30 * 24 * 60 * 60 * 1000;

    const totalCommitsCount = userCommits.length;
    const contributorsCount = Object.keys(authorCounts).length;
    const commitsToday = userCommits.filter(c => c.rawDate >= oneDayAgo).length;
    const commitsThisWeek = userCommits.filter(c => c.rawDate >= sevenDaysAgo).length;
    const commitsThisMonth = userCommits.filter(c => c.rawDate >= thirtyDaysAgo).length;
    const activeReposCount = activeReposSet.size;

    const topAuthorsList = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);
    const topAuthorStr = topAuthorsList.length > 0 ? `${topAuthorsList[0][0]} (${topAuthorsList[0][1]})` : 'â€”';

    // Update 6 Dynamic Summary Cards in Module Header
    const elActTotal = document.getElementById('actValTotalCommits');
    if (elActTotal) elActTotal.textContent = totalCommitsCount;
    const elActChipScope = document.getElementById('actChipScope');
    if (elActChipScope) elActChipScope.textContent = `${activeReposCount} Repos`;

    const elActContrib = document.getElementById('actValContributors');
    if (elActContrib) elActContrib.textContent = contributorsCount;
    const elActChipTop = document.getElementById('actChipTopAuthor');
    if (elActChipTop) elActChipTop.textContent = topAuthorStr;

    const elActToday = document.getElementById('actValToday');
    if (elActToday) elActToday.textContent = commitsToday;
    const elActChipToday = document.getElementById('actChipToday');
    if (elActChipToday) elActChipToday.textContent = `${commitsToday} Today`;

    const elActThisWeek = document.getElementById('actValThisWeek');
    if (elActThisWeek) elActThisWeek.textContent = commitsThisWeek;
    const elActChipWeek = document.getElementById('actChipThisWeek');
    if (elActChipWeek) elActChipWeek.textContent = `${commitsThisWeek} This Week`;

    const elActThisMonth = document.getElementById('actValThisMonth');
    if (elActThisMonth) elActThisMonth.textContent = commitsThisMonth;
    const elActChipMonth = document.getElementById('actChipThisMonth');
    if (elActChipMonth) elActChipMonth.textContent = `${commitsThisMonth} This Month`;

    const elActActiveRepos = document.getElementById('actValActiveRepos');
    if (elActActiveRepos) elActActiveRepos.textContent = activeReposCount;
    const elActChipActiveRepos = document.getElementById('actChipActiveRepos');
    if (elActChipActiveRepos) elActChipActiveRepos.textContent = `${activeReposCount} Repositories`;

    const elActLastUpd = document.getElementById('activityLastUpdatedText');
    if (elActLastUpd) elActLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    // Update KPIs
    window.HubApp.setKpis(
      this.currentQuery || project,
      'Commits Found',
      totalCommitsCount,
      'Pull Requests',
      this.prs.length,
      'Active Repos',
      activeReposCount
    );

    this.renderCommits(false);
    this.renderPRs();

    // Render chart
    const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const chartLabels = topAuthors.length ? topAuthors.map(a => a[0]) : ['No Commits'];
    const chartValues = topAuthors.length ? topAuthors.map(a => a[1]) : [0];

    window.HubApp.renderChart(chartLabels, chartValues, 'Commits by Contributor');
  },

  filterAndRender() {
    let list = this.allCommits;

    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(c => {
        return (
          (c.author && c.author.toLowerCase().includes(q)) ||
          (c.authorEmail && c.authorEmail.toLowerCase().includes(q)) ||
          (c.msg && c.msg.toLowerCase().includes(q)) ||
          (c.repo && c.repo.toLowerCase().includes(q)) ||
          (c.branch && c.branch.toLowerCase().includes(q)) ||
          String(c.commitId).toLowerCase().includes(q)
        );
      });
    }

    this.commits = list;
    this.commitIndex = 0;
    this.renderCommits(false);
  },

  renderCommits(append = false) {
    const tbody = document.getElementById('userCommitsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const statsEl = document.getElementById('activityTableStats');
    if (statsEl) {
      statsEl.textContent = `${this.commits.length} commits`;
    }

    if (this.commits.length === 0) {
      const qText = this.currentQuery ? ` matching "${this.currentQuery}"` : '';
      tbody.innerHTML = `<tr><td colspan="8" style="padding: 36px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 28px; height: 28px; margin: 0 auto 10px; display: block; color: var(--azure-blue); opacity: 0.6;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
        No commits found${qText} in the selected timeframe.
      </td></tr>`;
      document.getElementById('seeMoreCommitsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.commits.slice(this.commitIndex, this.commitIndex + this.pageSize);

    slice.forEach((c, localIdx) => {
      const globalIdx = this.commitIndex + localIdx;
      const tr = document.createElement('tr');
      tr.title = 'Click to inspect Commit Telemetry Blade';
      tr.innerHTML = '<td><a href="' + c.url + '" target="_blank" rel="noopener noreferrer" class="commit-hash-link"><code>#' + c.commitId + '</code></a></td>' +
        '<td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + c.msg + '">' + c.msg + '</td>' +
        '<td><strong>' + c.author + '</strong></td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + (c.authorEmail || 'â€”') + '</td>' +
        '<td><span class="badge badge-purple">' + c.repo + '</span></td>' +
        '<td><code>' + (c.branch || 'main') + '</code></td>' +
        '<td style="font-size:12px; color:var(--text-muted); white-space:nowrap;">' + c.date + '</td>' +
        '<td><a href="' + c.url + '" target="_blank" rel="noopener noreferrer" class="mod-btn-action" style="font-size:11px; height:24px; padding:2px 8px;">View Commit</a></td>';

      tr.addEventListener('click', () => this.openCommitBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.commitIndex += slice.length;

    const rem = this.commits.length - this.commitIndex;
    const moreBtn = document.getElementById('seeMoreCommitsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('commitsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },
  renderPRs() {
    const tbody = document.getElementById('userPrTableBody');
    if (!tbody) return;

    if (this.prs.length === 0) {
      const qText = this.currentQuery ? ` matching "${this.currentQuery}"` : '';
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12px;">
        No pull requests found${qText} in the selected timeframe.
      </td></tr>`;
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
