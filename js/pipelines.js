// Azure DevOps Intelligence Hub - Pipelines & Release Management Module
window.PipelineModule = {
  runs: [],
  allProcessedRuns: [],
  filteredRuns: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',
  currentPat: '',
  searchTerm: '',
  deploymentFilter: 'all',
  eventsBound: false,

  formatDuration(start, finish) {
    if (!start || !finish) return 'â€”';
    const s = new Date(start);
    const f = new Date(finish);
    if (isNaN(s.getTime()) || isNaN(f.getTime())) return 'â€”';
    const diffSec = Math.max(0, Math.floor((f - s) / 1000));
    const m = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    if (m === 0) return `${sec}s`;
    return `${m}m ${sec}s`;
  },

  matchBranchToEnvType(branchName) {
    if (!branchName) return null;
    const b = branchName.toLowerCase().replace(/^refs\/heads\//, '').trim();
    if (b.includes('preprod') || b.includes('pre-prod') || b.includes('pre_prod') || b.includes('staging')) return 'preprod';
    if (b === 'uat' || b.includes('/uat') || b.includes('-uat') || b.includes('_uat') || b.includes('uat/')) return 'uat';
    if (b === 'qa' || b.includes('/qa') || b.includes('-qa') || b.includes('_qa') || b.includes('qa/') || b.includes('test')) return 'qa';
    if (b === 'dev' || b.includes('dev') || b.includes('develop') || b.includes('feature')) return 'dev';
    if (b === 'main' || b === 'master' || b.includes('prod') || b.includes('release')) return 'prod';
    return null;
  },

  matchStageToEnvType(stageName) {
    if (!stageName) return null;
    const s = stageName.toLowerCase().trim();
    if (s.includes('preprod') || s.includes('pre-prod') || s.includes('pre prod') || s.includes('staging')) return 'preprod';
    if (s.includes('uat')) return 'uat';
    if (s.includes('qa') || s.includes('test')) return 'qa';
    if (s.includes('dev') || s.includes('develop')) return 'dev';
    if (s.includes('prod') || s.includes('production')) return 'prod';
    return null;
  },

  initEvents() {
    if (this.eventsBound) return;
    this.eventsBound = true;

    document.getElementById('pipelineSearchInput')?.addEventListener('input', (e) => {
      this.searchTerm = (e.target.value || '').trim().toLowerCase();
      this.filterAndRender();
    });

    document.getElementById('pipelineDeploymentFilter')?.addEventListener('change', (e) => {
      this.deploymentFilter = e.target.value || 'all';
      this.filterAndRender();
    });

    // Note: Do not auto-fetch on runs count change. User selects scope and clicks "Fetch Runs"
    document.getElementById('pipelineRunsTop')?.addEventListener('change', () => {
      // Keeps selected value ready for Fetch Runs execution
    });

    document.getElementById('pipelineProjectSelect')?.addEventListener('change', (e) => {
      const topSelect = document.getElementById('projectSelect');
      if (topSelect && topSelect.value !== e.target.value) {
        topSelect.value = e.target.value;
        window.HubApp.handleProjectSelect();
      }
    });

    document.getElementById('btnRefreshPipelines')?.addEventListener('click', () => {
      this.refreshCurrent();
    });

    document.getElementById('btnMorePipelines')?.addEventListener('click', () => {
      this.render(true);
    });
  },

  refreshCurrent() {
    const org = window.HubApp.getOrg();
    const project = document.getElementById('projectSelect')?.value || '';
    const pat = window.HubApp.getPat();
    const topRuns = document.getElementById('pipelineRunsTop')?.value || 50;
    const filter = document.getElementById('pipelineDeploymentFilter')?.value || 'all';
    if (org && project && pat) {
      this.fetch(org, project, pat, topRuns, filter);
    }
  },

  syncProjectDropdowns(project) {
    const el = document.getElementById('pipelineProjectSelect');
    const topSelect = document.getElementById('projectSelect');
    if (el && topSelect) {
      el.innerHTML = topSelect.innerHTML;
      el.value = project;
    }
  },

  async fetch(org, project, pat, topRuns, deploymentFilter) {
    this.currentOrg = org;
    this.currentProject = project;
    const auth = 'Basic ' + btoa(':' + pat);
    const topLimit = parseInt(topRuns, 10) || 50;
    this.pageSize = topLimit;
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
      let latestDeployTimeRaw = null;

      if (linkedRelease) {
        releaseName = linkedRelease.name;
        releaseId = linkedRelease.id;
        releaseDefName = linkedRelease.releaseDefinition?.name || 'Release Pipeline';
        releaseUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_releaseProgress?_a=release-pipeline-progress&releaseId=${linkedRelease.id}`;

        if (linkedRelease.modifiedOn) latestDeployTimeRaw = linkedRelease.modifiedOn;
        if (linkedRelease.createdOn && !latestDeployTimeRaw) latestDeployTimeRaw = linkedRelease.createdOn;

        // Fetch detailed release to get live, non-truncated environment statuses and step execution results
        const fullRelease = (await getFullRelease(releaseId)) || linkedRelease;
        const rawEnvironments = fullRelease.environments || linkedRelease.environments || [];

        environments = rawEnvironments.map(env => {
          if (env.modifiedOn) {
            if (!latestDeployTimeRaw || new Date(env.modifiedOn) > new Date(latestDeployTimeRaw)) {
              latestDeployTimeRaw = env.modifiedOn;
            }
          }
          if (env.deploySteps && env.deploySteps.length > 0) {
            env.deploySteps.forEach(step => {
              const sDate = step.lastModifiedOn || step.modifiedOn || step.queuedOn;
              if (sDate && (!latestDeployTimeRaw || new Date(sDate) > new Date(latestDeployTimeRaw))) {
                latestDeployTimeRaw = sDate;
              }
            });
          }

          const rawStatus = env.status;
          const statusStr = String(rawStatus || '').toLowerCase();
          const deploySteps = env.deploySteps || [];
          const lastStep = deploySteps.length > 0 ? deploySteps[deploySteps.length - 1] : null;

          let normalizedEnvStatus = 'notStarted';

          // Comprehensive check across env status, deploySteps, tasks, operationStatus, and allDeployments
          const hasSucceededStep = deploySteps.some(step => {
            const sStatus = String(step.status || '').toLowerCase();
            const dStatus = String(step.deploymentStatus || '').toLowerCase();
            const oStatus = String(step.operationStatus || '').toLowerCase();
            return (
              step.status === 4 ||
              step.status === 8 ||
              step.deploymentStatus === 4 ||
              step.deploymentStatus === 8 ||
              sStatus.includes('success') ||
              sStatus.includes('completed') ||
              sStatus.includes('partially') ||
              dStatus.includes('success') ||
              dStatus.includes('completed') ||
              dStatus.includes('partially') ||
              oStatus.includes('phasesucceeded') ||
              oStatus.includes('approved') ||
              (step.tasks && step.tasks.length > 0 && step.tasks.some(t => {
                const ts = String(t.status || '').toLowerCase();
                return ts.includes('success') || ts.includes('complete');
              }))
            );
          });

          const hasFailedStep = deploySteps.some(step => {
            const sStatus = String(step.status || '').toLowerCase();
            const dStatus = String(step.deploymentStatus || '').toLowerCase();
            const oStatus = String(step.operationStatus || '').toLowerCase();
            return (
              step.status === 16 ||
              step.status === 32 ||
              step.deploymentStatus === 16 ||
              step.deploymentStatus === 32 ||
              sStatus.includes('fail') ||
              sStatus.includes('reject') ||
              dStatus.includes('fail') ||
              dStatus.includes('reject') ||
              oStatus.includes('phasefailed')
            );
          });

          const hasInProgressStep = deploySteps.some(step => {
            const sStatus = String(step.status || '').toLowerCase();
            const dStatus = String(step.deploymentStatus || '').toLowerCase();
            const oStatus = String(step.operationStatus || '').toLowerCase();
            return (
              step.status === 2 ||
              step.deploymentStatus === 2 ||
              sStatus.includes('progress') ||
              sStatus.includes('queued') ||
              sStatus.includes('running') ||
              dStatus.includes('progress') ||
              dStatus.includes('queued') ||
              oStatus.includes('phaseinprogress')
            );
          });

          // Check Azure DevOps integer enums and string statuses:
          // 4 = Succeeded, 32 = PartiallySucceeded, 128 = PartiallySucceeded, 2 = InProgress, 16 = Rejected/Failed, 8 = Canceled, 1 = NotStarted
          if (
            rawStatus === 4 ||
            rawStatus === 32 ||
            rawStatus === 128 ||
            statusStr === '4' ||
            statusStr === '32' ||
            statusStr === '128' ||
            statusStr.includes('success') ||
            statusStr.includes('completed') ||
            statusStr.includes('partially') ||
            hasSucceededStep
          ) {
            normalizedEnvStatus = 'succeeded';
          } else if (
            rawStatus === 16 ||
            statusStr === '16' ||
            statusStr.includes('fail') ||
            statusStr.includes('reject') ||
            hasFailedStep
          ) {
            normalizedEnvStatus = 'failed';
          } else if (
            rawStatus === 2 ||
            statusStr === '2' ||
            statusStr.includes('progress') ||
            statusStr.includes('queued') ||
            statusStr.includes('scheduled') ||
            hasInProgressStep
          ) {
            normalizedEnvStatus = 'inProgress';
          } else if (
            rawStatus === 8 ||
            statusStr === '8' ||
            statusStr.includes('cancel') ||
            statusStr.includes('skip')
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
              const depStatus = String(matchingDep.deploymentStatus || matchingDep.status || '').toLowerCase();
              const opStatus = String(matchingDep.operationStatus || '').toLowerCase();
              if (depStatus.includes('success') || depStatus.includes('completed') || opStatus.includes('phasesucceeded') || opStatus.includes('approved')) normalizedEnvStatus = 'succeeded';
              else if (depStatus.includes('fail') || depStatus.includes('reject') || opStatus.includes('phasefailed')) normalizedEnvStatus = 'failed';
              else if (depStatus.includes('inprog') || depStatus.includes('queued') || opStatus.includes('phaseinprogress')) normalizedEnvStatus = 'inProgress';
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
                else if (sResult.includes('cancel') || sResult.includes('skipped')) normStatus = 'notStarted';

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

      // Align environment stage statuses with branch target
      if (environments.length > 0) {
        const branchEnvType = this.matchBranchToEnvType(branchName);
        const hasEnvTypeStages = environments.some(e => this.matchStageToEnvType(e.name));

        if (branchEnvType && hasEnvTypeStages) {
          environments = environments.map(env => {
            const stageEnvType = this.matchStageToEnvType(env.name);
            if (stageEnvType) {
              if (stageEnvType === branchEnvType) {
                // Matching stage for this branch
                if (buildResult === 'succeeded' || buildResult === 'partiallySucceeded') {
                  return { ...env, status: 'succeeded', rawStatus: 'Succeeded' };
                } else if (buildResult === 'inProgress') {
                  return { ...env, status: 'inProgress', rawStatus: 'In Progress' };
                } else {
                  return { ...env, status: 'notStarted', rawStatus: 'Not Started' };
                }
              } else {
                // Non-matching stages for this branch should be normal / not deployed
                return { ...env, status: 'notStarted', rawStatus: 'Not Started' };
              }
            }
            return env;
          });
        }
      }

      // Determine Overall Unified CI/CD Status
      let overallCicdState = 'deployed';
      let overallStatusLabel = 'Deployment Completed';

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

          if (failedEnvs.length > 0) {
            overallCicdState = 'deploy_failed';
            overallStatusLabel = `Deploy Failed (${failedEnvs[0].name})`;
            cicdCounts.deploy_failed++;
          } else if (inProgressEnvs.length > 0) {
            overallCicdState = 'in_progress';
            overallStatusLabel = `Deploying (${inProgressEnvs[0].name})...`;
            cicdCounts.in_progress++;
          } else {
            // For every completed work: Deployment Completed in Green
            overallCicdState = 'deployed';
            overallStatusLabel = 'Deployment Completed';
            cicdCounts.deployed++;
          }
        } else {
          overallCicdState = 'deployed';
          overallStatusLabel = 'Deployment Completed';
          cicdCounts.deployed++;
        }
      }

      const buildFinishTime = b.finishTime ? new Date(b.finishTime).toLocaleString() : (b.startTime ? 'Building since ' + new Date(b.startTime).toLocaleTimeString() : 'Pending Queue');
      
      let deployFinishTime = '-';
      if (linkedRelease) {
        if (latestDeployTimeRaw && (overallCicdState === 'deployed' || overallCicdState === 'deploy_failed')) {
          deployFinishTime = new Date(latestDeployTimeRaw).toLocaleString();
        } else if (overallCicdState === 'in_progress') {
          deployFinishTime = 'Deploying...';
        } else if (overallCicdState === 'deployed') {
          deployFinishTime = b.finishTime ? new Date(b.finishTime).toLocaleString() : '-';
        }
      } else if (overallCicdState === 'deployed') {
        deployFinishTime = b.finishTime ? new Date(b.finishTime).toLocaleString() : '-';
      } else if (overallCicdState === 'in_progress') {
        deployFinishTime = 'In Progress...';
      }

      const durationFormatted = this.formatDuration(b.startTime, b.finishTime);
      const durationSec = b.startTime && b.finishTime ? Math.max(0, Math.floor((new Date(b.finishTime) - new Date(b.startTime)) / 1000)) : 0;
      const pipelineType = (b.definition?.type === 1 || b.process?.type === 1) ? 'Designer' : 'YAML';
      const repoName = b.repository?.name || 'â€”';
      const pipelineId = b.definition?.id || b.pipeline?.id || 'â€”';

      return {
        id: b.id || idx,
        pipelineId: pipelineId,
        pipelineType: pipelineType,
        projectName: project,
        repoName: repoName,
        durationFormatted: durationFormatted,
        durationSec: durationSec,
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
        finishTime: buildFinishTime,
        buildFinishTime: buildFinishTime,
        deployFinishTime: deployFinishTime,
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
    } else if (deployFilter === 'in_progress') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'in_progress');
    } else if (deployFilter === 'build_failed') {
      filtered = processedRuns.filter(r => r.overallCicdState === 'build_failed');
    }

    this.allProcessedRuns = processedRuns;
    this.runs = filtered;
    this.index = 0;

    this.initEvents();
    this.syncProjectDropdowns(project);

    // Compute metrics for 6 dynamic summary cards
    const totalRuns = processedRuns.length;
    const successfulRuns = processedRuns.filter(r => r.buildResult === 'succeeded' || r.buildResult === 'partiallySucceeded').length;
    const failedRuns = processedRuns.filter(r => r.buildResult === 'failed' || r.overallCicdState === 'build_failed' || r.overallCicdState === 'deploy_failed').length;
    const runningRuns = processedRuns.filter(r => r.buildResult === 'inProgress' || r.overallCicdState === 'in_progress').length;
    const cancelledRuns = processedRuns.filter(r => r.buildResult === 'canceled' || r.overallCicdState === 'canceled').length;
    const queuedRuns = processedRuns.filter(r => (r.rawObject?.status || '').toLowerCase() === 'notstarted').length;

    const evaluated = successfulRuns + failedRuns;
    const successRate = evaluated > 0 ? Math.round((successfulRuns / evaluated) * 100) : (totalRuns > 0 ? 100 : 0);

    const completedWithDuration = processedRuns.filter(r => r.durationSec > 0);
    const avgSec = completedWithDuration.length > 0
      ? Math.round(completedWithDuration.reduce((acc, r) => acc + r.durationSec, 0) / completedWithDuration.length)
      : 0;
    const avgDurationStr = avgSec > 0 ? `${Math.floor(avgSec / 60)}m ${avgSec % 60}s` : 'â€”';

    // Update 6 Dynamic Summary Cards
    const elPipeTotal = document.getElementById('pipeValTotal');
    if (elPipeTotal) elPipeTotal.textContent = totalRuns;
    const elPipeRate = document.getElementById('pipeChipSuccessRate');
    if (elPipeRate) elPipeRate.textContent = `${successRate}% Pass Rate`;

    const elPipeSuccess = document.getElementById('pipeValSuccessful');
    if (elPipeSuccess) elPipeSuccess.textContent = successfulRuns;
    const elPipeSuccessCount = document.getElementById('pipeChipSuccessCount');
    if (elPipeSuccessCount) elPipeSuccessCount.textContent = `${successfulRuns} Passed`;

    const elPipeFailed = document.getElementById('pipeValFailed');
    if (elPipeFailed) elPipeFailed.textContent = failedRuns;
    const elPipeFailedCount = document.getElementById('pipeChipFailedCount');
    if (elPipeFailedCount) elPipeFailedCount.textContent = `${failedRuns} Failed`;

    const elPipeRunning = document.getElementById('pipeValRunning');
    if (elPipeRunning) elPipeRunning.textContent = runningRuns;
    const elPipeRunningCount = document.getElementById('pipeChipRunningCount');
    if (elPipeRunningCount) elPipeRunningCount.textContent = `${runningRuns} Running`;

    const elPipeCancelled = document.getElementById('pipeValCancelled');
    if (elPipeCancelled) elPipeCancelled.textContent = cancelledRuns;
    const elPipeCancelledCount = document.getElementById('pipeChipCancelledCount');
    if (elPipeCancelledCount) elPipeCancelledCount.textContent = `${cancelledRuns} Cancelled`;

    const elPipeQueued = document.getElementById('pipeValQueued');
    if (elPipeQueued) elPipeQueued.textContent = queuedRuns;
    const elPipeAvgDur = document.getElementById('pipeChipAvgDuration');
    if (elPipeAvgDur) elPipeAvgDur.textContent = `Avg: ${avgDurationStr}`;

    const elPipeLastUpd = document.getElementById('pipeLastUpdatedText');
    if (elPipeLastUpd) elPipeLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    // 5. Update KPI cards
    const buildsPassed = processedRuns.filter(r => r.buildResult === 'succeeded').length;
    const fullyDeployed = processedRuns.filter(r => r.overallCicdState === 'deployed').length;

    window.HubApp.setKpis(
      project,
      'Total CI/CD Runs',
      processedRuns.length,
      'Builds Passed',
      buildsPassed,
      'Deployment Completed',
      fullyDeployed
    );

    this.render(false);

    // 6. Render Chart with Unified CI/CD Breakdown
    const chartLabels = ['Deployment Completed', 'In Progress', 'Deploy Failed', 'Build Failed'];
    const chartVals = [
      cicdCounts.deployed,
      cicdCounts.in_progress,
      cicdCounts.deploy_failed,
      cicdCounts.build_failed
    ];

    window.HubApp.renderChart(chartLabels, chartVals, 'CI/CD Build & Deployment Delivery Matrix');
  },

  getBuildBadge(result) {
    const res = (result || '').toLowerCase();
    if (res === 'succeeded' || res === 'success') {
      return `
        <span class="badge badge-succeeded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Build Passed
        </span>
      `;
    } else if (res === 'failed' || res === 'failure') {
      return `
        <span class="badge badge-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Build Failed
        </span>
      `;
    } else if (res.includes('progress') || res.includes('build') || res === 'inprogress' || res === 'notstarted' || res === 'running') {
      return `
        <span class="badge badge-inprogress" style="font-weight:700;">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          Building...
        </span>
      `;
    }
    return `<span class="badge badge-canceled">${result}</span>`;
  },

  getReleasePills(run) {
    if (!run.hasRelease || !run.environments || run.environments.length === 0) {
      return '<span style="font-size:12px; font-style:italic; color:var(--text-muted);">No linked release</span>';
    }

    const envPills = run.environments.map(env => {
      let badgeClass = 'badge-canceled';
      let icon = '-';
      if (env.status === 'succeeded') {
        badgeClass = 'badge-succeeded';
        icon = '&#10003;';
      } else if (env.status === 'failed') {
        badgeClass = 'badge-failed';
        icon = '&#10005;';
      } else if (env.status === 'inProgress') {
        badgeClass = 'badge-inprogress';
        icon = '&#9203;';
      } else if (env.status === 'canceled') {
        badgeClass = 'badge-canceled';
        icon = '-';
      } else {
        badgeClass = 'badge-canceled';
        icon = '-';
      }

      return `<span class="badge ${badgeClass}" style="font-size:10.5px; padding:2px 7px; margin-right:3px; margin-bottom:3px; display:inline-flex; align-items:center;" title="${env.name}: ${env.rawStatus}">${env.name}: ${icon}</span>`;
    }).join('');

    return `
      <div>
        <strong style="font-size:12px; font-weight:700; color:var(--text-main); display:block; margin-bottom:3px;">${run.releaseName || 'Release'}</strong>
        <div style="display:flex; flex-wrap:wrap; gap:2px; align-items:center;">${envPills}</div>
      </div>
    `;
  },

  getCicdBadge(state, label) {
    if (state === 'deployed' || state === 'deploy_pending') {
      return `
        <span class="badge badge-succeeded" style="font-weight:700;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          ${label || 'Deployment Completed'}
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
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          ${label || 'Building / Deploying...'}
        </span>
      `;
    }
    return `
      <span class="badge badge-succeeded" style="font-weight:700;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        ${label || 'Deployment Completed'}
      </span>
    `;
  },

  getBuildTimeHtml(r) {
    const res = (r.buildResult || '').toLowerCase();
    if (res === 'succeeded' || res === 'success') {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#107c10" stroke-width="3" style="width:13px; height:13px; color:#107c10; flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span style="color:var(--text-main); font-weight:600;">${r.buildFinishTime}</span>
        </div>
      `;
    } else if (res === 'failed' || res === 'failure') {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#d13438" stroke-width="3" style="width:13px; height:13px; color:#d13438; flex-shrink:0;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          <span style="color:#d13438; font-weight:600;">${r.buildFinishTime}</span>
        </div>
      `;
    } else if (res.includes('prog') || res.includes('build') || res === 'inprogress' || res === 'notstarted' || r.buildFinishTime.includes('Building')) {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="#0078d4" stroke-width="2.5" style="width:13px; height:13px; color:#0078d4; flex-shrink:0;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
          <span style="color:#0078d4; font-weight:600;">${r.buildFinishTime}</span>
        </div>
      `;
    }
    return `
      <div style="display:flex; align-items:center; gap:6px; color:var(--text-secondary);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px; color:var(--text-muted);"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
        <span>${r.buildFinishTime}</span>
      </div>
    `;
  },

  getDeployTimeHtml(r) {
    const st = (r.overallCicdState || '').toLowerCase();
    const timeStr = r.deployFinishTime || '-';
    
    if (st === 'deployed' && timeStr !== '-') {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#107c10" stroke-width="3" style="width:13px; height:13px; color:#107c10; flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span style="color:var(--text-main); font-weight:600;">${timeStr}</span>
        </div>
      `;
    } else if (st === 'deploy_failed' || (timeStr.toLowerCase().includes('fail') && timeStr !== '-')) {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#d13438" stroke-width="3" style="width:13px; height:13px; color:#d13438; flex-shrink:0;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          <span style="color:#d13438; font-weight:600;">${timeStr}</span>
        </div>
      `;
    } else if (st === 'in_progress' || timeStr.includes('Progress') || timeStr.includes('Deploying')) {
      return `
        <div style="display:flex; align-items:center; gap:6px;">
          <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="#0078d4" stroke-width="2.5" style="width:13px; height:13px; color:#0078d4; flex-shrink:0;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
          <span style="color:#0078d4; font-weight:600;">${timeStr}</span>
        </div>
      `;
    }
    return `
      <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted);">
        <span>-</span>
      </div>
    `;
  },

  getTriggeredByHtml(r) {
    const authorName = r.author || 'Automated Service';
    const authorEmail = r.authorEmail && r.authorEmail !== 'service-principal@azure.net' ? r.authorEmail : '';
    const initials = authorName.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'AZ';
    const isService = authorName.toLowerCase().includes('service') || authorName.toLowerCase().includes('microsoft') || authorName.toLowerCase().includes('build');
    const avatarBg = isService ? '#0078d4' : '#7c3aed';

    return `
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:#ffffff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${initials}
        </div>
        <div style="min-width:0; max-width:180px;">
          <div style="font-weight:600; font-size:12.5px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${authorName}">
            ${authorName}
          </div>
          ${authorEmail ? `<div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${authorEmail}">${authorEmail}</div>` : ''}
        </div>
      </div>
    `;
  },

  filterAndRender() {
    let list = this.allProcessedRuns;

    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(r => {
        return (
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.branch && r.branch.toLowerCase().includes(q)) ||
          (r.author && r.author.toLowerCase().includes(q)) ||
          (r.repoName && r.repoName.toLowerCase().includes(q)) ||
          String(r.id).includes(q)
        );
      });
    }

    if (this.deploymentFilter && this.deploymentFilter !== 'all') {
      const df = this.deploymentFilter.toLowerCase();
      if (df === 'deployed') list = list.filter(r => r.overallCicdState === 'deployed');
      else if (df === 'deploy_failed') list = list.filter(r => r.overallCicdState === 'deploy_failed');
      else if (df === 'in_progress') list = list.filter(r => r.overallCicdState === 'in_progress');
      else if (df === 'build_failed') list = list.filter(r => r.overallCicdState === 'build_failed');
    }

    this.runs = list;
    this.index = 0;
    this.render(false);
  },

  render(append = false) {
    const tbody = document.getElementById('pipelineTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const statsEl = document.getElementById('pipelineTableStats');
    if (statsEl) {
      statsEl.textContent = `${this.runs.length} runs`;
    }

    if (this.runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">No matching build or release runs found for this project.</td></tr>';
      document.getElementById('seeMorePipelinesContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.runs.slice(this.index, this.index + this.pageSize);

    slice.forEach((r, localIdx) => {
      const globalIdx = this.index + localIdx;
      const buildBadge = this.getBuildBadge(r.buildResult);
      const releasePills = this.getReleasePills(r);
      const cicdBadge = this.getCicdBadge(r.overallCicdState, r.overallStatusLabel);
      const buildTimeHtml = this.getBuildTimeHtml(r);
      const deployTimeHtml = this.getDeployTimeHtml(r);
      const triggeredByHtml = this.getTriggeredByHtml(r);

      const tr = document.createElement('tr');
      tr.title = 'Click to open Azure Blade Telemetry for Build & Release details';
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td>
          <div style="display:flex; flex-direction:column; gap:2px;">
            <strong style="color:var(--text-main); font-size:12.5px; font-weight:700;">${r.name}</strong>
            <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="commit-hash-link" style="color:var(--azure-blue); font-size:11.5px; text-decoration:none; width:fit-content;" onclick="event.stopPropagation();">${r.buildNumber}</a>
          </div>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:2px;">
            <div><span class="badge badge-purple" style="font-size:10.5px; padding:2px 8px; border-radius:12px;">${r.branch}</span></div>
            <span style="font-size:11px; color:var(--text-muted);">${r.trigger}</span>
          </div>
        </td>
        <td>${triggeredByHtml}</td>
        <td>${buildBadge}</td>
        <td>${releasePills}</td>
        <td>${cicdBadge}</td>
        <td style="white-space:nowrap;">${buildTimeHtml}</td>
        <td style="white-space:nowrap;">${deployTimeHtml}</td>
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
                <span class="blade-kv-label">BUILD FINISH TIME</span>
                <span class="blade-kv-value">${run.buildFinishTime}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">DEPLOYMENT FINISH TIME</span>
                <span class="blade-kv-value">${run.deployFinishTime}</span>
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
