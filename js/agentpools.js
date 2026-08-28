// Azure DevOps Intelligence Hub - Project-Wise Agent Pools & Queues Module
window.AgentPoolModule = {
  pools: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',

  async fetch(org, project, pat, filterType) {
    this.currentOrg = org;
    this.currentProject = project;
    const auth = 'Basic ' + btoa(':' + pat);
    const cleanProject = project.trim();
    const typeFilter = (filterType || 'all').toLowerCase();

    window.HubApp.setStatus(`Scanning agent queues and pools for project "${cleanProject}"...`, 'info');

    let allQueues = [];

    // 1. Query project-level distributed task queues
    try {
      const queuesUrl = `${encodeURIComponent(cleanProject)}/_apis/distributedtask/queues?api-version=7.1-preview.1`;
      const data = await window.HubApp.fetchAdo(org, queuesUrl, auth);
      allQueues = data.value || [];
    } catch (err) {
      console.warn('Queue query v7.1 fallback, trying v6.0:', err);
      try {
        const fallbackUrl = `${encodeURIComponent(cleanProject)}/_apis/distributedtask/queues?api-version=6.0`;
        const fbData = await window.HubApp.fetchAdo(org, fallbackUrl, auth);
        allQueues = fbData.value || [];
      } catch (fbErr) {
        console.warn('Failed to query project queues directly, attempting pool discovery:', fbErr);
      }
    }

    // 2. Fallback: If no project queues returned, attempt pool query
    if (allQueues.length === 0) {
      try {
        const poolsUrl = `_apis/distributedtask/pools?api-version=7.1-preview.1`;
        const poolData = await window.HubApp.fetchAdo(org, poolsUrl, auth);
        const orgPools = poolData.value || [];
        allQueues = orgPools.map(p => ({
          id: p.id,
          name: p.name,
          pool: p,
          projectId: cleanProject
        }));
      } catch (pErr) {
        console.warn('Fallback pool query failed:', pErr);
      }
    }

    // 3. For each queue/pool, fetch detailed agent telemetry (parallel batch)
    const detailedPools = await Promise.all(allQueues.map(async (q) => {
      const poolId = q.pool?.id || q.id;
      const isHosted = !!(q.pool?.isHosted || (q.name || '').toLowerCase().includes('azure pipelines') || (q.name || '').toLowerCase().includes('hosted'));
      let agents = [];
      let jobRequests = [];

      if (poolId && !isHosted) {
        try {
          const agentsUrl = `_apis/distributedtask/pools/${poolId}/agents?includeCapabilities=true&includeAssignedRequest=true&includeLastCompletedRequest=true&api-version=7.1-preview.1`;
          const agentData = await window.HubApp.fetchAdo(org, agentsUrl, auth);
          agents = agentData.value || [];
        } catch (agErr) {
          console.warn(`Could not fetch agents for pool ${poolId}:`, agErr);
        }

        try {
          const jobsUrl = `_apis/distributedtask/pools/${poolId}/jobrequests?top=5&api-version=7.1-preview.1`;
          const jobData = await window.HubApp.fetchAdo(org, jobsUrl, auth);
          jobRequests = jobData.value || [];
        } catch (jErr) {
          console.warn(`Could not fetch job requests for pool ${poolId}:`, jErr);
        }
      }

      const onlineCount = agents.filter(a => (a.status || '').toLowerCase() === 'online').length;
      const offlineCount = agents.filter(a => (a.status || '').toLowerCase() !== 'online').length;
      const totalAgents = isHosted ? (q.pool?.size || 1) : agents.length;

      let status = 'Healthy';
      if (isHosted) {
        status = 'Hosted (Microsoft-Managed)';
      } else if (totalAgents === 0) {
        status = 'No Agents';
      } else if (onlineCount === 0 && totalAgents > 0) {
        status = 'All Offline';
      } else if (offlineCount > 0) {
        status = 'Degraded (Partial Offline)';
      } else {
        status = 'Online & Ready';
      }

      return {
        id: q.id,
        name: q.name,
        poolId: poolId,
        poolType: isHosted ? 'Azure Hosted' : (q.pool?.poolType === 'deployment' ? 'Deployment Pool' : 'Self-Hosted / Private'),
        isHosted: isHosted,
        autoProvision: q.pool?.autoProvision !== false,
        size: totalAgents,
        agents: agents,
        jobRequests: jobRequests,
        onlineAgentsCount: isHosted ? 1 : onlineCount,
        offlineAgentsCount: isHosted ? 0 : offlineCount,
        status: status,
        rawQueue: q,
        url: `https://dev.azure.com/${org}/${encodeURIComponent(cleanProject)}/_settings/agentqueues?queueId=${q.id}`
      };
    }));

    // 4. Apply filter if specified
    let filtered = detailedPools;
    if (typeFilter === 'hosted') {
      filtered = detailedPools.filter(p => p.isHosted);
    } else if (typeFilter === 'selfhosted') {
      filtered = detailedPools.filter(p => !p.isHosted);
    }

    this.pools = filtered;
    this.index = 0;

    // 5. Aggregate KPIs
    const totalPools = this.pools.length;
    const hostedCount = this.pools.filter(p => p.isHosted).length;
    const selfHostedCount = this.pools.filter(p => !p.isHosted).length;
    const totalOnlineAgents = this.pools.reduce((acc, p) => acc + (p.isHosted ? 0 : p.onlineAgentsCount), 0);
    const totalOfflineAgents = this.pools.reduce((acc, p) => acc + (p.isHosted ? 0 : p.offlineAgentsCount), 0);

    window.HubApp.setKpis(
      cleanProject,
      'Total Agent Pools',
      totalPools,
      'Self-Hosted Online',
      totalOnlineAgents,
      'Hosted / Private',
      `${hostedCount} / ${selfHostedCount}`
    );

    this.render(false);

    // 6. Render distribution chart
    const chartLabels = ['Azure Hosted', 'Self-Hosted Online', 'Self-Hosted Offline', 'Empty Pools'];
    const emptyPoolsCount = this.pools.filter(p => !p.isHosted && p.size === 0).length;
    const chartVals = [hostedCount, totalOnlineAgents, totalOfflineAgents, emptyPoolsCount];

    window.HubApp.renderChart(chartLabels, chartVals, 'Agent Pools & Infrastructure Health');
  },

  getStatusBadge(pool) {
    if (pool.isHosted) {
      return `
        <span class="badge badge-succeeded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Hosted Managed
        </span>
      `;
    }
    if (pool.size === 0) {
      return `
        <span class="badge badge-canceled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          No Agents Configured
        </span>
      `;
    }
    if (pool.onlineAgentsCount > 0 && pool.offlineAgentsCount === 0) {
      return `
        <span class="badge badge-active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          ${pool.onlineAgentsCount} Online
        </span>
      `;
    }
    if (pool.onlineAgentsCount > 0 && pool.offlineAgentsCount > 0) {
      return `
        <span class="badge badge-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
          Degraded (${pool.onlineAgentsCount} on, ${pool.offlineAgentsCount} off)
        </span>
      `;
    }
    return `
      <span class="badge badge-failed">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        All Offline (${pool.offlineAgentsCount})
      </span>
    `;
  },

  getTypeBadge(pool) {
    if (pool.isHosted) {
      return `<span class="badge badge-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>Azure Hosted</span>`;
    }
    return `<span class="badge badge-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>Self-Hosted</span>`;
  },

  render(append = false) {
    const tbody = document.getElementById('agentPoolsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.pools.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No agent pools or queues found for this project.</td></tr>`;
      document.getElementById('seeMoreAgentPoolsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.pools.slice(this.index, this.index + this.pageSize);

    slice.forEach((pool, localIdx) => {
      const globalIdx = this.index + localIdx;
      const statusBadge = this.getStatusBadge(pool);
      const typeBadge = this.getTypeBadge(pool);

      const agentCountText = pool.isHosted ? 'Elastic Cloud' : `${pool.onlineAgentsCount} / ${pool.size} Online`;

      const tr = document.createElement('tr');
      tr.title = 'Click to open Azure Blade Telemetry for this Agent Pool';
      tr.innerHTML = `
        <td><strong>${pool.name}</strong></td>
        <td>${typeBadge}</td>
        <td><code>${agentCountText}</code></td>
        <td>${statusBadge}</td>
        <td>${pool.autoProvision ? '<span class="badge badge-active">Auto-Provisioned</span>' : '<span class="badge badge-canceled">Manual</span>'}</td>
        <td><code>#${pool.poolId}</code></td>
      `;
      tr.addEventListener('click', () => this.openPoolBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.index += slice.length;

    const rem = this.pools.length - this.index;
    const moreBtn = document.getElementById('seeMoreAgentPoolsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('agentPoolsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  openPoolBlade(poolIdx) {
    const pool = this.pools[poolIdx];
    if (!pool) return;

    window.BladeController.openBlade({
      title: `Agent Pool: ${pool.name}`,
      subtitle: `Project Queue & Infrastructure Telemetry`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Agent Pools > ${pool.name}`,
      adoUrl: pool.url,
      rawData: pool.rawQueue,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
          <line x1="6" y1="6" x2="6.01" y2="6"></line>
          <line x1="6" y1="18" x2="6.01" y2="18"></line>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Pool & Queue Configuration
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">POOL NAME</span>
                <span class="blade-kv-value"><strong>${pool.name}</strong></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">POOL TYPE</span>
                <span class="blade-kv-value">${this.getTypeBadge(pool)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">HEALTH / STATUS</span>
                <span class="blade-kv-value">${this.getStatusBadge(pool)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">QUEUE ID / POOL ID</span>
                <span class="blade-kv-value"><code>Queue #${pool.id} (Pool #${pool.poolId})</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TOTAL AGENT CAPACITY</span>
                <span class="blade-kv-value">${pool.isHosted ? 'Unlimited Microsoft Cloud Elastic VMs' : `${pool.size} registered agent(s)`}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AUTO-PROVISIONING</span>
                <span class="blade-kv-value">${pool.autoProvision ? 'Enabled for new pipelines' : 'Disabled (Explicit Assignment Required)'}</span>
              </div>
            </div>
          </div>

          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>
              Project Scoping & Permissions
            </div>
            <p style="font-size:12.5px; color:var(--text-secondary); line-height: 1.5;">
              This agent queue provides dedicated build and deployment execution resources for project <strong>${this.currentProject}</strong>.
              ${pool.isHosted ? 'Standard Azure Hosted VM images are patched and updated weekly by Microsoft.' : 'Self-hosted agents run on your own compute infrastructure.'}
            </p>
          </div>
        `,

        stages: () => {
          if (pool.isHosted) {
            return `
              <div class="blade-section">
                <div class="blade-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect></svg>
                  Microsoft-Hosted Agent Fleet
                </div>
                <div class="p-3" style="background:var(--azure-surface-alt); border-radius:var(--radius-md); border:1px solid var(--azure-border);">
                  <p style="font-size:13px; color:var(--text-main); font-weight:600; margin-bottom:4px;">☁️ Dynamic Azure Hosted Cloud Instances</p>
                  <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
                    Includes Ubuntu Latest (22.04/24.04), Windows Server 2022 / 2025, and macOS 13/14 hosted runners with preinstalled SDKs (Docker, .NET, Node.js, Python, Java, Go, Rust, PowerShell).
                  </p>
                </div>
              </div>
            `;
          }

          if (!pool.agents || pool.agents.length === 0) {
            return `
              <div class="blade-section">
                <div class="blade-section-title">Registered Agents</div>
                <p class="text-muted" style="font-size:13px;">No physical or virtual agents currently registered in this pool.</p>
              </div>
            `;
          }

          const agentCardsHtml = pool.agents.map(ag => {
            const isOnline = (ag.status || '').toLowerCase() === 'online';
            const statusBadge = isOnline
              ? `<span class="badge badge-active">Online</span>`
              : `<span class="badge badge-failed">Offline</span>`;
            const enabledBadge = ag.enabled
              ? `<span class="badge badge-succeeded">Enabled</span>`
              : `<span class="badge badge-canceled">Disabled</span>`;

            const currentJob = ag.assignedRequest
              ? `<span class="badge badge-inprogress">Running Job #${ag.assignedRequest.jobId || ''} (${ag.assignedRequest.planType || 'Build'})</span>`
              : `<span class="badge badge-canceled">Idle</span>`;

            return `
              <div class="data-card" style="margin-bottom:12px; padding:12px 14px; background:var(--azure-surface-alt); border:1px solid var(--azure-border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <strong style="font-size:13.5px; color:var(--text-main);">${ag.name}</strong>
                    <code>v${ag.version || 'unknown'}</code>
                  </div>
                  <div style="display:flex; gap:6px;">
                    ${statusBadge}
                    ${enabledBadge}
                  </div>
                </div>
                <div class="blade-kv-grid" style="grid-template-columns: repeat(2, 1fr); gap:6px 12px; margin-top:8px;">
                  <div class="blade-kv-item">
                    <span class="blade-kv-label">OS ENVIRONMENT</span>
                    <span class="blade-kv-value" style="font-size:12px;">${ag.osDescription || 'Standard OS'}</span>
                  </div>
                  <div class="blade-kv-item">
                    <span class="blade-kv-label">CURRENT JOB</span>
                    <span class="blade-kv-value">${currentJob}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>
                Registered Pool Agents (${pool.agents.length})
              </div>
              ${agentCardsHtml}
            </div>
          `;
        },

        logs: () => {
          if (!pool.agents || pool.agents.length === 0) {
            return `
              <div class="blade-section">
                <div class="blade-section-title">System Capabilities Matrix</div>
                <p class="text-muted" style="font-size:13px;">No agents available to inspect capabilities.</p>
              </div>
            `;
          }

          const capabilitiesHtml = pool.agents.map(ag => {
            const sysCaps = ag.systemCapabilities || {};
            const keys = Object.keys(sysCaps).slice(0, 30);
            const tags = keys.map(k => `<span class="badge badge-blue" style="font-size:11px; margin:2px;">${k}=${sysCaps[k]}</span>`).join(' ');

            return `
              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; margin-bottom:6px; color:var(--text-main);">
                  💻 Agent: ${ag.name} (Capabilities: ${Object.keys(sysCaps).length})
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; max-height:220px; overflow-y:auto; padding:8px; background:var(--azure-surface-alt); border-radius:var(--radius-sm); border:1px solid var(--azure-border);">
                  ${tags || '<span class="text-muted" style="font-size:12px;">No capability tags exposed.</span>'}
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                Agent Capability & Tool Demands Matrix
              </div>
              ${capabilitiesHtml}
            </div>
          `;
        }
      }
    });
  }
};
