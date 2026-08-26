window.PipelineModule = {
  runs: [],
  index: 0,
  pageSize: 20,

  async fetch(org, project, pat, topRuns) {
    const auth = 'Basic ' + btoa(':' + pat);
    const topLimit = parseInt(topRuns, 10) || 50;
    let allBuilds = [];
    let statusCounts = {
      succeeded: 0,
      failed: 0,
      inProgress: 0,
      canceled: 0,
      partiallySucceeded: 0
    };

    // 1. Fetch Builds using standard queueTime descending order
    try {
      const buildsUrl = `${encodeURIComponent(project)}/_apis/build/builds?queryOrder=queueTimeDescending&$top=${topLimit}&api-version=6.0`;
      const data = await window.HubApp.fetchAdo(org, buildsUrl, auth);
      allBuilds = data.value || [];
    } catch (err) {
      console.warn('Standard build query fallback, trying preview endpoint:', err);
      try {
        const fallbackUrl = `${encodeURIComponent(project)}/_apis/build/builds?$top=${topLimit}&api-version=7.0`;
        const fbData = await window.HubApp.fetchAdo(org, fallbackUrl, auth);
        allBuilds = fbData.value || [];
      } catch (fbErr) {
        console.error('Failed to fetch build runs:', fbErr);
      }
    }

    // 2. If no direct builds returned, query pipeline definitions to get latest runs
    if (allBuilds.length === 0) {
      try {
        const defsUrl = `${encodeURIComponent(project)}/_apis/build/definitions?includeLatestBuilds=true&api-version=6.0&$top=100`;
        const defsData = await window.HubApp.fetchAdo(org, defsUrl, auth);
        const definitions = defsData.value || [];

        definitions.forEach(d => {
          if (d.latestBuild) {
            allBuilds.push(d.latestBuild);
          } else if (d.latestCompletedBuild) {
            allBuilds.push(d.latestCompletedBuild);
          }
        });
      } catch (defErr) {
        console.warn('Pipeline definitions query notice:', defErr);
      }
    }

    // 3. Process and normalize run properties
    this.runs = allBuilds.map(b => {
      // Determine result status
      let rawResult = (b.result || b.status || 'unknown').toLowerCase();
      let normalizedResult = rawResult;

      if (rawResult.includes('success')) {
        normalizedResult = 'succeeded';
        statusCounts.succeeded++;
      } else if (rawResult.includes('fail')) {
        normalizedResult = 'failed';
        statusCounts.failed++;
      } else if (rawResult.includes('progress') || rawResult.includes('notstarted') || rawResult.includes('running')) {
        normalizedResult = 'inProgress';
        statusCounts.inProgress++;
      } else if (rawResult.includes('cancel')) {
        normalizedResult = 'canceled';
        statusCounts.canceled++;
      } else if (rawResult.includes('partially')) {
        normalizedResult = 'partiallySucceeded';
        statusCounts.partiallySucceeded++;
      } else {
        if (statusCounts[normalizedResult] !== undefined) statusCounts[normalizedResult]++;
        else statusCounts[normalizedResult] = 1;
      }

      // Resolve Trigger Reason
      let triggerReason = b.reason || 'Manual';
      if (triggerReason === 'individualCI' || triggerReason === 'batchedCI') triggerReason = 'CI Trigger';
      if (triggerReason === 'schedule') triggerReason = 'Scheduled';
      if (triggerReason === 'pullRequest') triggerReason = 'PR Validation';

      // Format branch name
      let branchName = (b.sourceBranch || '-').replace(/^refs\/heads\//, '').replace(/^refs\/pull\//, 'PR #');

      return {
        name: b.definition?.name || b.pipeline?.name || 'Pipeline Definition',
        buildNumber: b.buildNumber || `#${b.id}`,
        branch: branchName,
        trigger: triggerReason,
        author: b.requestedFor?.displayName || b.requestedBy?.displayName || 'Automated Service',
        result: normalizedResult,
        rawResult: b.result || b.status || 'N/A',
        finishTime: b.finishTime ? new Date(b.finishTime).toLocaleString() : (b.startTime ? 'Running since ' + new Date(b.startTime).toLocaleTimeString() : 'Pending Queue')
      };
    });

    this.index = 0;

    // Update KPI cards
    window.HubApp.setKpis(
      project,
      'Total Runs',
      this.runs.length,
      'Succeeded',
      statusCounts.succeeded,
      'Failed',
      statusCounts.failed
    );

    this.render(false);

    // Filter out zero-count statuses for cleaner chart display
    const chartData = Object.entries(statusCounts).filter(([_, count]) => count > 0);
    const chartKeys = chartData.length ? chartData.map(([k]) => k) : ['succeeded', 'failed', 'inProgress'];
    const chartVals = chartData.length ? chartData.map(([_, v]) => v) : [0, 0, 0];

    window.HubApp.renderChart(chartKeys, chartVals, 'Build & Pipeline Run Status');
  },

  render(append = false) {
    const tbody = document.getElementById('pipelineTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No build runs recorded for this project.</td></tr>`;
      document.getElementById('seeMorePipelinesContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.runs.slice(this.index, this.index + this.pageSize);
    this.index += slice.length;

    tbody.insertAdjacentHTML(
      'beforeend',
      slice.map(r => {
        let badgeClass = 'badge-active';
        if (r.result === 'failed') badgeClass = 'badge-stale';
        if (r.result === 'inProgress') badgeClass = 'badge-blue';
        if (r.result === 'canceled') badgeClass = 'badge-stale';

        return `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td><code>${r.buildNumber}</code></td>
            <td><code>${r.branch}</code></td>
            <td>${r.author}</td>
            <td><span class="badge ${badgeClass}">${r.rawResult}</span></td>
            <td>${r.finishTime}</td>
          </tr>
        `;
      }).join('')
    );

    const rem = this.runs.length - this.index;
    const moreBtn = document.getElementById('seeMorePipelinesContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('pipelinesRemainingCount');
      if (counter) counter.textContent = rem;
    }
  }
};
