window.RepoModule = {
  branches: [],
  branchIndex: 0,
  prs: [],
  prIndex: 0,
  pageSize: 15,

  async inspect(org, project, pat, targetRepoInput, cachedRepos) {
    let targetRepos = cachedRepos;
    if (targetRepoInput !== '-- All Repositories --' && targetRepoInput) {
      targetRepos = cachedRepos.filter(r => r.name.toLowerCase().includes(targetRepoInput.toLowerCase()));
    }
    if (!targetRepos.length) throw new Error(`No repository matching "${targetRepoInput}"`);

    const auth = 'Basic ' + btoa(':' + pat);
    let counts = {};
    const now = new Date();

    const repoTasks = targetRepos.map(async (r) => {
      try {
        const res = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/refs?filter=heads/&api-version=7.1-preview.1`, auth);
        const refs = res.value || [];
        counts[r.name] = refs.length;

        return await Promise.all(refs.map(async (ref) => {
          const bName = ref.name.replace(/^refs\/heads\//, '');
          const cRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(bName)}&$top=1&api-version=7.1-preview.1`, auth);
          const topC = cRes.value?.[0];
          const d = topC?.author?.date ? new Date(topC.author.date) : null;
          return {
            repo: r.name,
            branch: bName,
            author: topC?.author?.name || 'Unknown',
            date: d ? d.toLocaleDateString() : 'N/A',
            isStale: d ? ((now - d) / (1000 * 60 * 60 * 24)) > 90 : false,
            msg: topC?.comment || ''
          };
        }));
      } catch (e) { return []; }
    });

    const prTasks = targetRepos.map(async (r) => {
      try {
        const prRes = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=50&api-version=7.1-preview.1`, auth);
        return (prRes.value || []).map(pr => ({
          repo: r.name,
          title: pr.title,
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

    window.HubApp.setKpis(targetRepos[0]?.name || project, 'Repositories', targetRepos.length, 'Total Branches', this.branches.length, 'Stale (>90d)', this.branches.filter(b => b.isStale).length);
    this.renderBranches(false);
    this.renderPrs(false);
    window.HubApp.renderChart(Object.keys(counts), Object.values(counts), 'Branches per Repository');
  },

  renderBranches(append = false) {
    const tbody = document.getElementById('branchesTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.branches.slice(this.branchIndex, this.branchIndex + this.pageSize);
    this.branchIndex += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(b => `
      <tr>
        <td><strong>${b.repo}</strong></td>
        <td><code>${b.branch}</code></td>
        <td><span class="badge ${b.isStale ? 'badge-stale' : 'badge-active'}">${b.isStale ? 'Stale' : 'Active'}</span></td>
        <td>${b.author}</td>
        <td>${b.date}</td>
        <td>${b.msg}</td>
      </tr>
    `).join(''));

    const rem = this.branches.length - this.branchIndex;
    const btnContainer = document.getElementById('seeMoreRepoContainer');
    btnContainer.classList.toggle('hidden', rem <= 0);
    document.getElementById('repoRemainingCount').textContent = rem;
  },

  renderPrs(append = false) {
    const tbody = document.getElementById('repoPrsTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.prs.slice(this.prIndex, this.prIndex + this.pageSize);
    this.prIndex += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(p => `
      <tr>
        <td><strong>${p.repo}</strong></td>
        <td>${p.title}</td>
        <td>${p.source} → ${p.target}</td>
        <td>${p.creator}</td>
        <td><span class="badge badge-blue">${p.status}</span></td>
        <td>${p.createdDate}</td>
      </tr>
    `).join(''));

    const rem = this.prs.length - this.prIndex;
    const btnContainer = document.getElementById('seeMoreRepoPrsContainer');
    btnContainer.classList.toggle('hidden', rem <= 0);
    document.getElementById('repoPrsRemainingCount').textContent = rem;
  }
};
