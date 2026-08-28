// Azure DevOps Intelligence Hub - Pipelines & Release Management Module
window.PipelineModule = {
  runs: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',

  async fetch(org, project, pat, topRuns, deploymentFilter) {
    this.currentOrg = org;
    this.currentProject = project;
    const auth = 'Basic ' + btoa(':' + pat);
    const topLimit = parseInt(topRuns, 10) || 50;
    const deployFilter = (deploymentFilter || 'all').toLowerCase();
    let allBuilds = [];
    let allReleases = [];
    let allDeployments = [];
    const releaseDetailCache = {};

    window.HubApp.setStatus(`Fetching builds and matching release pipelines for "${project}"...`, 'info');

    // Helper: Fetch Full Detailed Release with Environment Deployment States
    const getFullRelease = async (releaseId) => {
      if (!releaseId) return null;
      if (releaseDetailCache[releaseId]) return releaseDetailCache[releaseId];

      try {
        const resUrl = `https://vsrm.dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/release/releases/${releaseId}?api-version=7.1-preview.8`;
        const res = await fetch(resUrl, { headers: { 'Authorization': auth, 'Accept': 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          releaseDetailCache[releaseId] = data;
          return data;
        }
      } catch (err) {
        console.warn(`Could not fetch details for release ${releaseId}:`, err);
      }
      return null;
    };

    // 1. Fetch Build Runs
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

    // Fallback: If no direct builds returned, query pipeline definitions
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

    // 2. Concurrently fetch Release Management Deployments & Releases
    const fetchReleasesPromise = async () => {
      try {
        const releasesUrl = `https://vsrm.dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/release/releases?api-version=7.1-preview.8&$top=100&$expand=environments,artifacts`;
        const res = await fetch(releasesUrl, { headers: { 'Authorization': auth, 'Accept': 'application/json' } });
        if (res.ok) {
          const rData = await res.json();
          allReleases = rData.value || [];
          // Sort releases descending by ID so latest release is checked first
          allReleases.sort((a, b) => (b.id || 0) - (a.id || 0));
        }
      } catch (relErr) {
        console.warn('Release query notice (vsrm host):', relErr);
      }

      try {
        const deployUrl = `https://vsrm.dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/release/deployments?api-version=7.1-preview.1&$top=200`;
        const dRes = await fetch(deployUrl, { headers: { 'Authorization': auth, 'Accept': 'application/json' } });
        if (dRes.ok) {
          const dData = await dRes.json();
          allDeployments = dData.value || [];
        }
      } catch (dErr) {
        console.warn('Deployments query notice:', dErr);
      }
    };

    await fetchReleasesPromise();

    // 3. Correlate Releases & Environments with Builds
    let cicdCounts = {
      deployed: 0,
      deploy_failed: 0,
      deploy_pending: 0,
      build_failed: 0,
      in_progress: 0,
      build_only: 0
    };

    const processedRuns = await Promise.all(allBuilds.map(async (b, idx) => {
      let rawResult = (b.result || b.status || 'unknown').toLowerCase();
      let buildResult = 'unknown';

      if (rawResult.includes('success')) {
        buildResult = 'succeeded';
      } else if (rawResult.includes('fail')) {
        buildResult = 'failed';
      } else if (rawResult.includes('progress') || rawResult.includes('notstarted') || rawResult.includes('running')) {
        buildResult = 'inProgress';
      } else if (rawResult.includes('cancel')) {
        buildResult = 'canceled';
      } else if (rawResult.includes('partially')) {
        buildResult = 'partiallySucceeded';
      } else {
        buildResult = rawResult;
      }

      // Resolve Trigger Reason
      let triggerReason = b.reason || 'Manual';
      if (triggerReason === 'individualCI' || triggerReason === 'batchedCI') triggerReason = 'CI Trigger';
      if (triggerReason === 'schedule') triggerReason = 'Scheduled';
      if (triggerReason === 'pullRequest') triggerReason = 'PR Validation';

      // Format branch name
      let branchName = (b.sourceBranch || '-').replace(/^refs\/heads\//, '').replace(/^refs\/pull\//, 'PR #');

      // STRICT Pipeline Definition and Build ID matching
      const buildIdStr = String(b.id);
      const buildNumStr = String(b.buildNumber || '').trim();
      const buildDefId = b.definition?.id ? String(b.definition.id) : null;
      const buildDefName = (b.definition?.name || b.name || '').trim().toLowerCase();

      let linkedRelease = allReleases.find(r => {
        return (r.artifacts || []).some(a => {
          const defRef = a.definitionReference || {};
          
          // 1. Pipeline Definition Verification:
          // The artifact definition ID / name MUST match the build's definition ID / name
          const artDefId = defRef.definition?.id || a.sourceId;
          const artDefName = (defRef.definition?.name || a.alias || '').trim().toLowerCase().replace(/^_/, '');

          let defMatch = false;
          if (buildDefId && artDefId && String(artDefId) === buildDefId) {
            defMatch = true;
          } else if (artDefName && buildDefName && (artDefName === buildDefName || artDefName.includes(buildDefName) || buildDefName.includes(artDefName))) {
            defMatch = true;
          }

          // If the pipeline definition does not match, NEVER link this release
          if (!defMatch) {
            return false;
          }

          // 2. Exact Build ID or Build Number Verification
          const artBuildId = defRef.version?.id || defRef.buildId?.id;
          if (artBuildId && String(artBuildId) === buildIdStr) {
            return true;
          }

          const artBuildNum = (defRef.version?.name || '').trim();
          if (artBuildNum && buildNumStr && artBuildNum === buildNumStr) {
            return true;
          }

          return false;
        });
      });

      let environments = [];
      let releaseName = '';
      let releaseDefName = '';
      let releaseUrl = '';
      let releaseId = null;

      if (linkedRelease) {
        releaseName = linkedRelease.name;
        releaseId = linkedRelease.id;
        releaseDefName = linkedRelease.releaseDefinition?.name || 'Release Pipeline';
        releaseUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_releaseProgress?_a=release-pipeline-progress&releaseId=${linkedRelease.id}`;

        // Fetch detailed release to get live, non-truncated environment statuses and step execution results
        const fullRelease = (await getFullRelease(releaseId)) || linkedRelease;
        const rawEnvironments = fullRelease.environments || linkedRelease.environments || [];

        environments = rawEnvironments.map(env => {
          const rawStatus = env.status;
          const statusStr = String(rawStatus || '').toLowerCase();
          const deploySteps = env.deploySteps || [];
          const lastStep = deploySteps.length > 0 ? deploySteps[deploySteps.length - 1] : null;
          const stepStatus = String(lastStep?.status || '').toLowerCase();
          const stepOpStatus = String(lastStep?.operationStatus || '').toLowerCase();

          let normalizedEnvStatus = 'notStarted';

          // Check Azure DevOps integer enums and string statuses:
          // 4 = Succeeded, 32 = PartiallySucceeded, 2 = InProgress, 16 = Rejected/Failed, 8 = Canceled, 1 = NotStarted
          if (
            rawStatus === 4 ||
            rawStatus === 32 ||
            statusStr === '4' ||
            statusStr === '32' ||
            statusStr.includes('success') ||
            statusStr.includes('completed') ||
            statusStr.includes('partially') ||
            stepStatus.includes('success') ||
            stepStatus.includes('completed') ||
            stepOpStatus.includes('phasesucceeded')
          ) {
            normalizedEnvStatus = 'succeeded';
          } else if (
            rawStatus === 16 ||
            statusStr === '16' ||
            statusStr.includes('fail') ||
            statusStr.includes('reject') ||
            stepStatus.includes('fail') ||
            stepStatus.includes('reject') ||
            stepOpStatus.includes('phasefailed')
          ) {
            normalizedEnvStatus = 'failed';
          } else if (
            rawStatus === 2 ||
            statusStr === '2' ||
            statusStr.includes('progress') ||
            statusStr.includes('queued') ||
            statusStr.includes('scheduled') ||
            statusStr.includes('pending') ||
            stepStatus.includes('progress') ||
            stepStatus.includes('queued')
          ) {
            normalizedEnvStatus = 'inProgress';
          } else if (
            rawStatus === 8 ||
            statusStr === '8' ||
            statusStr.includes('cancel') ||
            statusStr.includes('skip') ||
            stepStatus.includes('cancel')
          ) {
            normalizedEnvStatus = 'canceled';
          } else {
            // Check deployments list fallback
            const matchingDep = allDeployments.find(d => {
              return (
                String(d.release?.id) === String(releaseId) &&
                (String(d.releaseEnvironment?.id) === String(env.id) ||
                 (d.releaseEnvironment?.name || '').toLowerCase() === (env.name || '').toLowerCase())
              );
            });

            if (matchingDep) {
              const depStatus = String(matchingDep.deploymentStatus || '').toLowerCase();
              if (depStatus.includes('success') || depStatus.includes('completed')) normalizedEnvStatus = 'succeeded';
              else if (depStatus.includes('fail') || depStatus.includes('reject')) normalizedEnvStatus = 'failed';
              else if (depStatus.includes('inprog') || depStatus.includes('queued')) normalizedEnvStatus = 'inProgress';
              else if (depStatus.includes('cancel')) normalizedEnvStatus = 'canceled';
            }
          }

          let displayStatus = 'Not Started';
          if (normalizedEnvStatus === 'succeeded') displayStatus = 'Succeeded';
          else if (normalizedEnvStatus === 'failed') displayStatus = 'Failed';
          else if (normalizedEnvStatus === 'inProgress') displayStatus = 'In Progress';
          else if (normalizedEnvStatus === 'canceled') displayStatus = 'Canceled';

          return {
            id: env.id,
            name: env.name || 'Environment',
            status: normalizedEnvStatus,
            rawStatus: displayStatus
          };
        });

      } else if (b.id) {
        // If no classic release is linked, check if this is a Multi-Stage YAML Pipeline with deployment stages
        try {
          const timelineUrl = `${encodeURIComponent(project)}/_apis/build/builds/${b.id}/timeline?api-version=6.0`;
          const tData = await window.HubApp.fetchAdo(org, timelineUrl, auth);
          const records = tData.records || [];
          const stages = records.filter(r => r.type === 'Stage');

          if (stages.length > 1) {
            const deployStages = stages.filter(s => {
              const sName = (s.name || '').toLowerCase();
              return sName.includes('deploy') || sName.includes('release') || sName.includes('prod') || sName.includes('dev') || sName.includes('qa') || sName.includes('staging') || sName.includes('uat');
            });

            const candidateStages = deployStages.length ? deployStages : stages.slice(1);
            if (candidateStages.length > 0) {
              releaseName = `${b.definition?.name || 'Pipeline'} Stages`;
              releaseDefName = 'YAML Multi-Stage Deployment';
              releaseUrl = b._links?.web?.href || `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_build/results?buildId=${b.id}`;

              environments = candidateStages.map(s => {
                let normStatus = 'notStarted';
                const sResult = (s.result || s.state || '').toLowerCase();
                if (sResult.includes('success') || sResult.includes('completed')) normStatus = 'succeeded';
                else if (sResult.includes('fail') || sResult.includes('rejected')) normStatus = 'failed';
                else if (sResult.includes('inprog') || sResult.includes('running')) normStatus = 'inProgress';
                else if (sResult.includes('cancel') || sResult.includes('skipped')) normStatus = 'canceled';

                let displayStatus = 'Not Started';
                if (normStatus === 'succeeded') displayStatus = 'Succeeded';
                else if (normStatus === 'failed') displayStatus = 'Failed';
                else if (normStatus === 'inProgress') displayStatus = 'In Progress';
                else if (normStatus === 'canceled') displayStatus = 'Canceled';

                return {
                  id: s.id,
                  name: s.name,
                  status: normStatus,
                  rawStatus: displayStatus
                };
              });
            }
          }
        } catch (tErr) {
          // ignore if no timeline available
        }
      }

      // Determine Overall Unified CI/CD Status
      let overallCicdState = 'build_only';
      let overallStatusLabel = 'Build Passed (CI Only)';

      if (buildResult === 'failed') {
        overallCicdState = 'build_failed';
        overallStatusLabel = 'Build Failed';
        cicdCounts.build_failed++;
      } else if (buildResult === 'inProgress') {
        overallCicdState = 'in_progress';
        overallStatusLabel = 'Building...';
        cicdCounts.in_progress++;
      } else if (buildResult === 'canceled') {
        overallCicdState = 'canceled';
        overallStatusLabel = 'Canceled';
      } else if (buildResult === 'succeeded' || buildResult === 'partiallySucceeded') {
        if (environments.length > 0) {
          const succeededEnvs = environments.filter(e => e.status === 'succeeded');
          const failedEnvs = environments.filter(e => e.status === 'failed');
          const inProgressEnvs = environments.filter(e => e.status === 'inProgress');
          const notStartedEnvs = environments.filter(e => e.status === 'notStarted');

          if (failedEnvs.length > 0) {
            overallCicdState = 'deploy_failed';
            overallStatusLabel = `Deploy Failed (${failedEnvs[0].name})`;
            cicdCounts.deploy_failed++;
          } else if (inProgressEnvs.length > 0) {
            overallCicdState = 'in_progress';
            overallStatusLabel = `Deploying (${inProgressEnvs[0].name})...`;
            cicdCounts.in_progress++;
          } else if (succeededEnvs.length > 0) {
            // When deployed environment(s) succeeded!
            overallCicdState = 'deployed';
            if (notStartedEnvs.length > 0) {
              overallStatusLabel = `Deployed (${succeededEnvs.map(e => e.name).join(', ')})`;
            } else {
              overallStatusLabel = 'Build & Deployed';
            }
            cicdCounts.deployed++;
          } else if (notStartedEnvs.length > 0) {
            // Only if NO deployment has run yet (all environments not started / pending manual trigger)
            overallCicdState = 'deploy_pending';
            overallStatusLabel = 'Deploy Pending';
            cicdCounts.deploy_pending++;
          } else {
            overallCicdState = 'deployed';
            overallStatusLabel = 'Build & Deployed';
            cicdCounts.deployed++;
          }
        } else {
          overallCicdState = 'build_only';
          overallStatusLabel = 'Build Passed (No Release)';
          cicdCounts.build_only++;
        }
      }

      return {
        id: b.id || idx,
        name: b.definition?.name || b.pipeline?.name || 'Pipeline Definition',
        buildNumber: b.buildNumber || `#${b.id}`,
        branch: branchName,
        trigger: triggerReason,
        author: b.requestedFor?.displayName || b.requestedBy?.displayName || 'Automated Service',
        authorEmail: b.requestedFor?.uniqueName || b.requestedBy?.uniqueName || 'service-principal@azure.net',
        buildResult: buildResult,
        rawBuildResult: b.result || b.status || 'N/A',
        agentPool: b.queue?.pool?.name || b.queue?.name || 'Azure Pipelines (Hosted Runners)',
        startTime: b.startTime ? new Date(b.startTime).toLocaleString() : 'N/A',
        finishTime: b.finishTime ? new Date(b.finishTime).toLocaleString() : (b.startTime ? 'Running since ' + new Date(b.startTime).toLocaleTimeString() : 'Pending Queue'),
        sourceVersion: b.sourceVersion ? b.sourceVersion.substring(0, 8) : 'HEAD',
        url: b._links?.web?.href || `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_build/results?buildId=${b.id}`,
        rawObject: b,
        // Release Data
        hasRelease: environments.length > 0,
        releaseId: releaseId,
        releaseName: releaseName,
        releaseDefName: releaseDefName,
        releaseUrl: releaseUrl,
        environments: environments,
        overallCicdState: overallCicdState,
        overallStatusLabel: overallStatusLabel
      };
    }));

    // 4. Apply Deployment Filter
    let filtered = processedRuns;
    if (deployFilter === 'deployed') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'deployed');
    } else if (deployFilter === 'deploy_failed') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'deploy_failed');
    } else if (deployFilter === 'deploy_pending') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'deploy_pending');
    } else if (deployFilter === 'build_failed') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'build_failed');
    }

    this.runs = filtered;
    this.index = 0;

    // 5. Update KPI cards
    const buildsPassed = processedRuns.filter(r => r.buildResult === 'succeeded').length;
    const fullyDeployed = processedRuns.filter(r => r.overallCicdState === 'deployed').length;

    window.HubApp.setKpis(
      project,
      'Total CI/CD Runs',
      processedRuns.length,
      'Builds Passed',
      buildsPassed,
      'Fully Deployed',
      fullyDeployed
    );

    this.render(false);

    // 6. Render Chart with Unified CI/CD Breakdown
    const chartLabels = ['Build & Deployed', 'Build Passed (No Release)', 'Deploy Pending', 'Deploy Failed', 'Build Failed'];
    const chartVals = [
      cicdCounts.deployed,
      cicdCounts.build_only,
      cicdCounts.deploy_pending,
      cicdCounts.deploy_failed,
      cicdCounts.build_failed
    ];

    window.HubApp.renderChart(chartLabels, chartVals, 'CI/CD Build & Deployment Delivery Matrix');
  },

  getBuildBadge(result) {
    if (result === 'succeeded') {
      return `
        <span class="badge badge-succeeded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Build Passed
        </span>
      `;
    } else if (result === 'failed') {
      return `
        <span class="badge badge-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Build Failed
        </span>
      `;
    } else if (result === 'inProgress') {
      return `
        <span class="badge badge-inprogress">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line></svg>
          Building...
        </span>
      `;
    }
    return `<span class="badge badge-canceled">${result}</span>`;
  },

  getReleasePills(run) {
    if (!run.hasRelease || run.environments.length === 0) {
      return `<span class="text-muted" style="font-size:12px; font-style:italic;">No linked release</span>`;
    }

    const envPills = run.environments.map(env => {
      let badgeClass = 'badge-canceled';
      let icon = '•';
      if (env.status === 'succeeded') {
        badgeClass = 'badge-succeeded';
        icon = '✓';
      } else if (env.status === 'failed') {
        badgeClass = 'badge-failed';
        icon = '✕';
      } else if (env.status === 'inProgress') {
        badgeClass = 'badge-inprogress';
        icon = '↻';
      } else if (env.status === 'notStarted') {
        badgeClass = 'badge-canceled';
        icon = '⏳';
      }

      return `<span class="badge ${badgeClass}" style="font-size:11px; padding:2px 7px; margin-right:3px;" title="${env.name}: ${env.rawStatus}">${env.name}: ${icon}</span>`;
    }).join('');

    return `
      <div>
        <strong style="font-size:12px; color:var(--text-main); display:block; margin-bottom:3px;">${run.releaseName || 'Release'}</strong>
        <div style="display:flex; flex-wrap:wrap; gap:2px;">${envPills}</div>
      </div>
    `;
  },

  getCicdBadge(state, label) {
    if (state === 'deployed') {
      return `
        <span class="badge badge-succeeded" style="font-weight:700;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          ${label || 'Build & Deployed'}
        </span>
      `;
    }
    if (state === 'deploy_failed') {
      return `
        <span class="badge badge-failed" style="font-weight:700;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          ${label || 'Deploy Failed'}
        </span>
      `;
    }
    if (state === 'deploy_pending') {
      return `
        <span class="badge badge-warning" style="font-weight:700;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
          ${label || 'Deploy Pending'}
        </span>
      `;
    }
    if (state === 'build_failed') {
      return `
        <span class="badge badge-failed" style="font-weight:700;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Build Failed
        </span>
      `;
    }
    if (state === 'in_progress') {
      return `
        <span class="badge badge-inprogress" style="font-weight:700;">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle></svg>
          ${label || 'In Progress'}
        </span>
      `;
    }
    return `<span class="badge badge-blue">${label || 'CI Build Passed'}</span>`;
  },

  render(append = false) {
    const tbody = document.getElementById('pipelineTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    if (this.runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No matching build or release runs found for this project.</td></tr>`;
      document.getElementById('seeMorePipelinesContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.runs.slice(this.index, this.index + this.pageSize);

    slice.forEach((r, localIdx) => {
      const globalIdx = this.index + localIdx;
      const buildBadge = this.getBuildBadge(r.buildResult);
      const releasePills = this.getReleasePills(r);
      const cicdBadge = this.getCicdBadge(r.overallCicdState, r.overallStatusLabel);

      const tr = document.createElement('tr');
      tr.title = 'Click to open Azure Blade Telemetry for Build & Release details';
      tr.innerHTML = `
        <td>
          <div style="font-weight:700; color:var(--text-main);">${r.name}</div>
          <code style="font-size:11px;">${r.buildNumber}</code>
        </td>
        <td>
          <span class="badge badge-purple" style="font-size:11px;">${r.branch}</span>
          <span class="subtext" style="display:block; font-size:11px; margin-top:2px;">${r.trigger}</span>
        </td>
        <td>${buildBadge}</td>
        <td>${releasePills}</td>
        <td>${cicdBadge}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${r.finishTime}</td>
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

    const isBuildSuccess = run.buildResult === 'succeeded';
    const isBuildFailed = run.buildResult === 'failed';
    const isDeploySuccess = run.overallCicdState === 'deployed';
    const isDeployFailed = run.overallCicdState === 'deploy_failed';

    window.BladeController.openBlade({
      title: `${run.name} #${run.buildNumber}`,
      subtitle: run.hasRelease ? `End-to-End Build & ${run.releaseName} Telemetry` : `CI/CD Build Pipeline Telemetry`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Pipelines > ${run.buildNumber}`,
      adoUrl: run.hasRelease && run.releaseUrl ? run.releaseUrl : run.url,
      rawData: { build: run.rawObject, release: run.hasRelease ? { releaseName: run.releaseName, environments: run.environments } : null },
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
              Build & Release Summary
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">PIPELINE NAME</span>
                <span class="blade-kv-value">${run.name}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">OVERALL CI/CD STATE</span>
                <span class="blade-kv-value">${this.getCicdBadge(run.overallCicdState, run.overallStatusLabel)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">BUILD RESULT</span>
                <span class="blade-kv-value">${this.getBuildBadge(run.buildResult)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TARGET BRANCH</span>
                <span class="blade-kv-value"><code>${run.branch}</code></span>
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

          ${run.hasRelease ? `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Linked Release Deployment (${run.releaseName})
              </div>
              <div class="blade-kv-grid" style="margin-bottom:12px;">
                <div class="blade-kv-item">
                  <span class="blade-kv-label">RELEASE PIPELINE</span>
                  <span class="blade-kv-value">${run.releaseDefName}</span>
                </div>
                <div class="blade-kv-item">
                  <span class="blade-kv-label">RELEASE INSTANCE</span>
                  <span class="blade-kv-value"><strong>${run.releaseName}</strong></span>
                </div>
              </div>
              
              <div style="background:var(--azure-surface-alt); padding:12px; border-radius:var(--radius-md); border:1px solid var(--azure-border);">
                <span class="blade-kv-label" style="margin-bottom:6px; display:block;">TARGET ENVIRONMENT GATES</span>
                <div style="display:flex; flex-direction:column; gap:8px;">
                  ${run.environments.map(e => `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <span style="font-size:13px; font-weight:600; color:var(--text-main);">🌐 ${e.name}</span>
                      <span class="badge ${e.status === 'succeeded' ? 'badge-succeeded' : (e.status === 'failed' ? 'badge-failed' : (e.status === 'inProgress' ? 'badge-inprogress' : 'badge-canceled'))}">
                        ${e.rawStatus}
                      </span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect></svg>
                Infrastructure & Runtime Scope
              </div>
              <p style="font-size:12.5px; color:var(--text-secondary); line-height: 1.5;">
                Standalone CI build provisioned on <strong>${run.agentPool}</strong> with automated artifact publish drop.
              </p>
            </div>
          `}
        `,

        stages: () => {
          return `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                End-to-End Build & Release Topology
              </div>
              
              <div class="stage-flow-container" style="flex-wrap:wrap; gap:12px 6px;">
                <!-- Stage 1: Checkout -->
                <div class="stage-node succeeded">
                  <div class="stage-node-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <span class="stage-node-name">Checkout</span>
                  <span class="stage-node-time">0m 14s</span>
                </div>
                <div class="stage-flow-connector active"></div>

                <!-- Stage 2: Build & Test -->
                <div class="stage-node ${isBuildFailed ? 'failed' : (run.buildResult === 'inProgress' ? 'in-progress' : 'succeeded')}">
                  <div class="stage-node-icon">
                    ${isBuildFailed ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' : (run.buildResult === 'inProgress' ? '<span class="pulse-dot pulse-blue"></span>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>')}
                  </div>
                  <span class="stage-node-name">Build & Test</span>
                  <span class="stage-node-time">${isBuildFailed ? 'Failed' : 'Compiled'}</span>
                </div>
                <div class="stage-flow-connector ${isBuildSuccess ? 'active' : ''}"></div>

                <!-- Stage 3: Artifact Drop -->
                <div class="stage-node ${isBuildSuccess ? 'succeeded' : 'pending'}">
                  <div class="stage-node-icon">
                    ${isBuildSuccess ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>'}
                  </div>
                  <span class="stage-node-name">Publish Drop</span>
                  <span class="stage-node-time">${isBuildSuccess ? 'Published' : 'Skipped'}</span>
                </div>

                ${run.hasRelease ? run.environments.map(env => `
                  <div class="stage-flow-connector ${env.status === 'succeeded' || env.status === 'inProgress' ? 'active' : ''}"></div>
                  <div class="stage-node ${env.status === 'succeeded' ? 'succeeded' : (env.status === 'failed' ? 'failed' : (env.status === 'inProgress' ? 'in-progress' : 'pending'))}">
                    <div class="stage-node-icon">
                      ${env.status === 'succeeded' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : (env.status === 'failed' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' : '<circle cx="12" cy="12" r="10"></circle>')}
                    </div>
                    <span class="stage-node-name">${env.name}</span>
                    <span class="stage-node-time">${env.rawStatus}</span>
                  </div>
                `).join('') : ''}
              </div>
            </div>

            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
                Execution Step Breakdown
              </div>
              <table style="font-size:12px;">
                <thead>
                  <tr>
                    <th>PHASE</th>
                    <th>TARGET SCOPE</th>
                    <th>RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>CI Build Step</code></td>
                    <td>Build Compilation & Unit Tests</td>
                    <td>${this.getBuildBadge(run.buildResult)}</td>
                  </tr>
                  <tr>
                    <td><code>Artifact Drop</code></td>
                    <td>Drop Staging (${run.buildNumber})</td>
                    <td><span class="badge ${isBuildSuccess ? 'badge-succeeded' : 'badge-failed'}">${isBuildSuccess ? 'Published' : 'Failed'}</span></td>
                  </tr>
                  ${run.hasRelease ? run.environments.map(env => `
                    <tr>
                      <td><code>CD Release Gate</code></td>
                      <td>${run.releaseName} &gt; ${env.name}</td>
                      <td><span class="badge ${env.status === 'succeeded' ? 'badge-succeeded' : (env.status === 'failed' ? 'badge-failed' : 'badge-canceled')}">${env.rawStatus}</span></td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td><code>CD Release Gate</code></td>
                      <td>No Linked Release Pipeline</td>
                      <td><span class="badge badge-canceled">N/A</span></td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          `;
        },

        logs: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              Build & Release Diagnostic Log Stream
            </div>
            <div class="log-console-wrapper">
              <div class="log-console-header">
                <span>Agent: ${run.agentPool}</span>
                <span>Build: ${run.buildNumber}</span>
                ${run.hasRelease ? `<span>Release: ${run.releaseName}</span>` : ''}
              </div>
              <pre class="log-console-content">
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-info">##[section]Starting: Initialize Build Run #${run.id}</span>
<span class="log-line-time">[${run.startTime}]</span> Synchronizing commit ${run.sourceVersion} on branch refs/heads/${run.branch}...
<span class="log-line-time">[${run.startTime}]</span> <span class="log-line-success">##[section]Build compilation completed (${run.buildResult}).</span>
${run.hasRelease ? `
<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-info">##[section]Triggering Release Pipeline: ${run.releaseDefName} (${run.releaseName})</span>
${run.environments.map(e => `<span class="log-line-time">[${run.finishTime}]</span> Deployment Target: '${e.name}' => Status: ${e.rawStatus}`).join('\n')}
` : `<span class="log-line-time">[${run.finishTime}]</span> No downstream release pipeline triggered.`}
<span class="log-line-time">[${run.finishTime}]</span> <span class="log-line-info">##[section]CI/CD Execution Assessment: ${run.overallStatusLabel}</span>
              </pre>
            </div>
          </div>
        `
      }
    });
  }
};
