window.PipelineModule = {
  runs: [],
  index: 0,
  pageSize: 15,

  async fetch(org, project, pat, topRuns) {
    const auth = 'Basic ' + btoa(':' + pat);
    const data = await window.HubApp.fetchAdo(org, `${encodeURIComponent(project)}/_apis/build/builds?$top=${topRuns}&api-version=7.1-preview.1`, auth);
    const builds = data.value || [];

    let counts = { succeeded: 0, failed: 0, inProgress: 0 };
    this.runs = builds.map(b => {
      const res = b.result || b.status || 'unknown';
      if (counts[res] !== undefined) counts[res]++;
      return {
        name: b.definition?.name || 'Pipeline',
        buildNumber: b.buildNumber || b.id,
        branch: (b.sourceBranch || '').replace('refs/heads/', ''),
        author: b.requestedFor?.displayName || 'Automated',
        result: res,
        finishTime: b.finishTime ? new Date(b.finishTime).toLocaleString() : 'Running...'
      };
    });

    this.index = 0;
    window.HubApp.setKpis(project, 'Total Runs', builds.length, 'Succeeded', counts.succeeded || 0, 'Failed', counts.failed || 0);
    this.render(false);
    window.HubApp.renderChart(Object.keys(counts), Object.values(counts), 'Run Status');
  },

  render(append = false) {
    const tbody = document.getElementById('pipelineTableBody');
    if (!append) tbody.innerHTML = '';
    const slice = this.runs.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML('beforeend', slice.map(r => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td>#${r.buildNumber}</td>
        <td><code>${r.branch}</code></td>
        <td>${r.author}</td>
        <td><span class="badge ${r.result === 'succeeded' ? 'badge-active' : 'badge-stale'}">${r.result}</span></td>
        <td>${r.finishTime}</td>
      </tr>
    `).join(''));

    const rem = this.runs.length - this.index;
    document.getElementById('seeMorePipelinesContainer').classList.toggle('hidden', rem <= 0);
    document.getElementById('pipelinesRemainingCount').textContent = rem;
  }
};
