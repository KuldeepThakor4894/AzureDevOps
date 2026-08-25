window.ActivityModule = {
  commits: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, query, days, cachedRepos) {
    const auth = 'Basic ' + btoa(':' + pat);
    const qLower = query.toLowerCase();
    let commits = [];
    let prs = [];
    let authorCounts = {};

    let fromStr = '';
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() - days);
      fromStr = `&searchCriteria.fromDate=${encodeURIComponent(d.toISOString())}`;
    }

    const tasks = cachedRepos.map(async (r) => {
      try {
        const cRes = await window.HubApp.fetchAdo(org, `${project}/_apis/git/repositories/${r.id}/commits?$top=100${fromStr}&api-version=7.1-preview.1`, auth);
        (cRes.value || []).forEach(c => {
          const aName = c.author?.name || 'Unknown';
          const aEmail = c.author?.email || '';
          if (!qLower || aName.toLowerCase().includes(qLower) || aEmail.toLowerCase().includes(qLower)) {
            authorCounts[aName] = (authorCounts[aName] || 0) + 1;
            commits.push({
              repo: r.name,
              commitId: c.commitId.substring(0, 8),
              author: aName,
              date: new Date(c.author?.date).toLocaleDateString(),
              msg: c.comment || ''
            });
          }
        });

        const pRes = await window.HubApp.fetchAdo(org, `${project}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=50&api-version=7.1-preview.1`, auth);
        (pRes.value || []).forEach(p => {
          const cName = p.createdBy?.displayName || '';
          if (!qLower || cName.toLowerCase().includes(qLower)) {
            prs.push({
              repo: r.name,
              title: p.title,
              source: p.sourceRefName?.replace('refs/heads/', ''),
              target: p.targetRefName?.replace('refs/heads/', ''),
              status: p.status,
              date: new Date(p.creationDate).toLocaleDateString()
            });
          }
        });
      } catch (e) { }
    });

    await Promise.all(tasks);
    this.commits = commits;
    this.index = 0;

    window.HubApp.setKpis(query || `${project} (All)`, 'Active Repos', cachedRepos.length, 'Pull Requests', prs.length, 'Commits', commits.length);
    this.render(false);

    document.getElementById('userPrTableBody').innerHTML = prs.map(p => `
      <tr>
        <td><strong>${p.repo}</strong></td>
        <td>${p.title}</td>
        <td>${p.source} → ${p.target}</td>
        <td><span class="badge badge-blue">${p.status}</span></td>
        <td>${p.date}</td>
      </tr>
    `).join('');

    window.HubApp.renderChart(Object.keys(authorCounts).slice(0, 10), Object.values(authorCounts).slice(0, 10), 'Commits by Contributor');
  },

  render(append = false) {
    const tbody = document.getElementById('userCommitsTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.commits.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(c => `
      <tr>
        <td><strong>${c.repo}</strong></td>
        <td><code>${c.commitId}</code></td>
        <td>${c.author}</td>
        <td>${c.date}</td>
        <td>${c.msg}</td>
      </tr>
    `).join(''));

    const rem = this.commits.length - this.index;
    document.getElementById('seeMoreCommitsContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('commitsRemainingCount').textContent = rem;
  }
};
