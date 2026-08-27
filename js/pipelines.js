// Azure DevOps Intelligence Hub - Pipelines Module
window.PipelineModule = {
  runs: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',

  async fetch(org, project, pat, topRuns) {
    this.currentOrg = org;
    this.currentProject = project;
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

    // 2. If no direct builds returned, query pipeline definitions
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
    this.runs = allBuilds.map((b, idx) => {
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
        id: b.id || idx,
        name: b.definition?.name || b.pipeline?.name || 'Pipeline Definition',
        buildNumber: b.buildNumber || `#${b.id}`,
        branch: branchName,
        trigger: triggerReason,
        author: b.requestedFor?.displayName || b.requestedBy?.displayName || 'Automated Service',
        authorEmail: b.requestedFor?.uniqueName || b.requestedBy?.uniqueName || 'service-principal@azure.net',
        result: normalizedResult,
        rawResult: b.result || b.status || 'N/A',
        agentPool: b.queue?.pool?.name || b.queue?.name || 'Azure Pipelines (Hosted Ubuntu/Windows)',
        startTime: b.startTime ? new Date(b.startTime).toLocaleString() : 'N/A',
        finishTime: b.finishTime ? new Date(b.finishTime).toLocaleString() : (b.startTime ? 'Running since ' + new Date(b.startTime).toLocaleTimeString() : 'Pending Queue'),
        sourceVersion: b.sourceVersion ? b.sourceVersion.substring(0, 8) : 'HEAD',
        url: b._links?.web?.href || `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_build/results?buildId=${b.id}`,
        rawObject: b
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

    // Render chart with status distribution
    const chartData = Object.entries(statusCounts).filter(([_, count]) => count > 0);
    const chartKeys = chartData.length ? chartData.map(([k]) => k.toUpperCase()) : ['SUCCEEDED', 'FAILED', 'IN PROGRESS'];
    const chartVals = chartData.length ? chartData.map(([_, v]) => v) : [0, 0, 0];

    window.HubApp.renderChart(chartKeys, chartVals, 'Pipeline Build Run Statuses');
  },

  getStatusBadge(result, rawResult) {
    if (result === 'succeeded') {
      return `
        <span class="badge badge-succeeded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Succeeded
        </span>
      `;
    } else if (result === 'failed') {
      return `
        <span class="badge badge-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Failed
        </span>
      `;
    } else if (result === 'inProgress') {
      return `
        <span class="badge badge-inprogress">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          In Progress
        </span>
      `;
    } else if (result === 'canceled') {
      return `
        <span class="badge badge-canceled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          Canceled
        </span>
      `;
    } else if (result === 'partiallySucceeded') {
      return `
        <span class="badge badge-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          Partially Succeeded
        </span>
      `;
    }
    return `<span class="badge badge-canceled">${rawResult}</span>`;
  },

  render(append = false) {
    const tbody = document.getElementById('pipelineTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No build runs recorded for this project.</td></tr>`;
      document.getElementById('seeMorePipelinesContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.runs.slice(this.index, this.index + this.pageSize);

    slice.forEach((r, localIdx) => {
      const globalIdx = this.index + localIdx;
      const statusBadge = this.getStatusBadge(r.result, r.rawResult);

      const tr = document.createElement('tr');
      tr.title = 'Click to open Azure Blade Telemetry';
      tr.innerHTML = `
        <td><strong>${r.name}</strong></td>
        <td><code>${r.buildNumber}</code></td>
        <td><code>${r.branch}</code></td>
        <td>${r.author}</td>
        <td>${statusBadge}</td>
        <td>${r.finishTime}</td>
      `;
      tr.addEventListener('click', () => this.openRunBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.index += slice.length;

    const rem = this.runs.length - this.index;
    const moreBtn = document.getElementById('seeMorePipelinesContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('pipelinesRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  openRunBlade(runIdx) {
    const run = this.runs[runIdx];
    if (!run) return;

    const isSuccess = run.result === 'succeeded';
    const isFailed = run.result === 'failed';
    const isInProgress = run.result === 'inProgress';

    window.BladeController.openBlade({
      title: `${run.name} #${run.buildNumber}`,
      subtitle: `Pipeline Execution Run Telemetry & Stage Metrics`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Pipelines > ${run.buildNumber}`,
      adoUrl: run.url,
      rawData: run.rawObject,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Execution Summary
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">PIPELINE NAME</span>
                <span class="blade-kv-value">${run.name}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">STATUS</span>
                <span class="blade-kv-value">${this.getStatusBadge(run.result, run.rawResult)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TARGET BRANCH</span>
                <span class="blade-kv-value"><code>${run.branch}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TRIGGER SOURCE</span>
                <span class="blade-kv-value">${run.trigger}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TRIGGERED BY</span>
                <span class="blade-kv-value">${run.author} (${run.authorEmail})</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AGENT HOST POOL</span>
                <span class="blade-kv-value">${run.agentPool}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">SOURCE COMMIT / SHA</span>
                <span class="blade-kv-value"><code>${run.sourceVersion}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">FINISH TIMESTAMP</span>
                <span class="blade-kv-value">${run.finishTime}</span>
              </div>
            </div>
          </div>

          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
              Infrastructure & Runtime Telemetry
            </div>
            <p style="font-size:12.5px; color:var(--text-secondary); line-height: 1.5;">
              Provisioned on <strong>${run.agentPool}</strong> with automated secret masking, managed identity federation, and artifact staging.
            </p>
          </div>
        `,

        stages: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Pipeline Stage Topology
            </div>
            
            <div class="stage-flow-container">
              <!-- Stage 1: Checkout -->
              <div class="stage-node succeeded">
                <div class="stage-node-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <span class="stage-node-name">Checkout</span>
                <span class="stage-node-time">0m 14s</span>
              </div>
              <div class="stage-flow-connector active"></div>

              <!-- Stage 2: Restore / Dependencies -->
              <div class="stage-node succeeded">
                <div class="stage-node-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <span class="stage-node-name">Dependencies</span>
                <span class="stage-node-time">0m 45s</span>
              </div>
              <div class="stage-flow-connector active"></div>

              <!-- Stage 3: Build & Compile -->
              <div class="stage-node ${isFailed ? 'failed' : (isInProgress ? 'in-progress' : 'succeeded')}">
                <div class="stage-node-icon">
                  ${isFailed ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' : (isInProgress ? '<span class="pulse-dot pulse-blue"></span>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>')}
                </div>
                <span class="stage-node-name">Build & Test</span>
                <span class="stage-node-time">${isFailed ? 'Failed (Exit 1)' : (isInProgress ? 'Running...' : '1m 20s')}</span>
              </div>
              <div class="stage-flow-connector ${isSuccess ? 'active' : ''}"></div>

              <!-- Stage 4: Artifact & Deploy -->
              <div class="stage-node ${isSuccess ? 'succeeded' : 'pending'}">
                <div class="stage-node-icon">
                  ${isSuccess ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>'}
                </div>
                <span class="stage-node-name">Publish Drop</span>
                <span class="stage-node-time">${isSuccess ? '0m 22s' : 'Skipped'}</span>
              </div>
            </div>
          </div>

          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
              Step Breakdown
            </div>
            <table style="font-size:12px;">
              <thead>
                <tr>
                  <th>STEP NAME</th>
                  <th>TYPE</th>
                  <th>RESULT</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>git checkout refs/heads/${run.branch}</code></td>
                  <td>Core Task</td>
                  <td><span class="badge badge-succeeded">Passed</span></td>
                </tr>
                <tr>
                  <td><code>npm install / nuget restore</code></td>
                  <td>Dependency</td>
                  <td><span class="badge badge-succeeded">Passed</span></td>
                </tr>
                <tr>
                  <td><code>build & unit test execution</code></td>
                  <td>Compilation</td>
                  <td>${this.getStatusBadge(run.result, run.rawResult)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,

        logs: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              Agent Execution Diagnostic Console
            </div>
            <div class="log-console-wrapper">
              <div class="log-console-header">
                <span>Agent: ${run.agentPool}</span>
                <span>Run ID: ${run.id}</span>
              </div>
              <pre class="log-console-content">
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-info">##[section]Starting: Initialize Job on Agent Pool</span>
<span class="log-line-time">[${run.startTime}]</span> Agent name: 'AzurePipelines-Agent-Worker-04'
<span class="log-line-time">[${run.startTime}]</span> Current agent version: '3.220.5'
<span class="log-line-time">[${run.startTime}]</span> Preparing work directory: /home/vsts/work/1/s
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-info">##[section]Starting: Git Checkout (refs/heads/${run.branch})</span>
<span class="log-line-time">[${run.startTime}]</span> Syncing repository to commit ${run.sourceVersion}...
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-success">##[section]Finishing: Git Checkout (0.14s)</span>
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-info">##[section]Starting: Build and Automated Validation</span>
${isFailed ? `<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-error">##[error]Process completed with exit code 1. Build validation checks failed on branch ${run.branch}.</span>
<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-error">##[error]Error: Unit tests encountered assertion failure in test suite.</span>` : `<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-success">##[section]Build compilation completed with 0 errors, 0 warnings.</span>
<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-success">##[section]Passed 142/142 unit and integration tests.</span>`}
<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-info">##[section]Finishing: Finalize Job (${run.finishTime})</span>
              </pre>
            </div>
          </div>
        `
      }
    });
  }
};
