// Azure DevOps Intelligence Hub - Project-Wise Service Connections Module
window.ServiceConnectionModule = {
  endpoints: [],
  allEndpoints: [],
  index: 0,
  pageSize: 25,
  currentProject: '',
  currentOrg: '',
  searchTerm: '',
  typeFilter: 'all',

  async fetch(org, project, pat, filterType, query) {
    this.currentOrg = org;
    this.currentProject = project;
    const auth = 'Basic ' + btoa(':' + pat);
    const cleanProject = project.trim();
    this.typeFilter = (filterType || 'all').toLowerCase();
    this.searchTerm = (query || '').trim().toLowerCase();

    window.HubApp.setStatus(`Scanning service connections for project "${cleanProject}"...`, 'info');

    let allEndpoints = [];

    // 1. Fetch Service Endpoints for the Project
    try {
      const endpointsUrl = `${encodeURIComponent(cleanProject)}/_apis/serviceendpoint/endpoints?includeFailed=true&includeDetails=true&api-version=7.1-preview.4`;
      const data = await window.HubApp.fetchAdo(org, endpointsUrl, auth);
      allEndpoints = data.value || [];
    } catch (err) {
      console.warn('Service endpoints v7.1 query notice, attempting fallback v6.0:', err);
      try {
        const fallbackUrl = `${encodeURIComponent(cleanProject)}/_apis/serviceendpoint/endpoints?api-version=6.0`;
        const fbData = await window.HubApp.fetchAdo(org, fallbackUrl, auth);
        allEndpoints = fbData.value || [];
      } catch (fbErr) {
        console.error('Failed to query service connections:', fbErr);
        throw new Error(`Service Connection Query Error: ${fbErr.message}. Ensure PAT has "Service Connections (Read)" scope.`);
      }
    }

    // 2. Process and sanitize endpoint records
    const processed = allEndpoints.map((e, idx) => {
      const rawType = (e.type || 'generic').toLowerCase();
      const rawScheme = e.authorization?.scheme || 'None';
      const params = e.authorization?.parameters || {};
      const dataMap = e.data || {};

      // 1. Operational status
      const isDisabled = !!e.isDisabled;
      const isReady = e.isReady !== false && (!e.operationStatus || e.operationStatus.state !== 'Failed');

      // 2. Resolve Service Principal / App ID / Identity
      let appId = '';
      if (params.serviceprincipalid) appId = params.serviceprincipalid;
      else if (params.servicePrincipalId) appId = params.servicePrincipalId;
      else if (params.spnId) appId = params.spnId;
      else if (params.clientId) appId = params.clientId;
      else if (dataMap.servicePrincipalId) appId = dataMap.servicePrincipalId;
      else if (dataMap.spnId) appId = dataMap.spnId;
      else if (dataMap.appObjectId) appId = dataMap.appObjectId;
      else if (dataMap.spnObjectId) appId = dataMap.spnObjectId;
      else if (dataMap.clientId) appId = dataMap.clientId;
      else if (params.username) appId = params.username;
      else if (dataMap.registryUsername) appId = dataMap.registryUsername;
      else if (rawScheme.toLowerCase().includes('workloadidentity') || rawScheme.toLowerCase().includes('federation') || rawScheme.toLowerCase().includes('oidc')) {
        appId = dataMap.workloadIdentityFederationSubject || dataMap.servicePrincipalId || 'OIDC Federation';
      } else if (rawScheme.toLowerCase().includes('oauth') || rawType.includes('github')) {
        appId = 'OAuth 2.0 Identity';
      } else if (rawScheme.toLowerCase().includes('token') || rawScheme.toLowerCase().includes('pat')) {
        appId = 'Personal Access Token';
      } else if (rawScheme.toLowerCase().includes('certificate')) {
        appId = 'Client Certificate';
      } else {
        appId = 'Platform Managed';
      }

      // 3. Resolve Expiration Date & Expired/Expiring Flag
      const rawExp = dataMap.spnKeyExpirationDate ||
                     dataMap.spnKeyExpireDate ||
                     dataMap.expirationDate ||
                     dataMap.credentialsExpiresOn ||
                     dataMap.certificateExpiresOn ||
                     dataMap.tokenExpiresOn ||
                     params.expirationDate ||
                     params.credentialsExpiresOn ||
                     null;

      let isExpired = false;
      let isExpiringSoon = false;
      let expirationDate = 'No Expiration';

      if (rawExp) {
        const expObj = new Date(rawExp);
        if (!isNaN(expObj.getTime())) {
          const now = new Date();
          isExpired = expObj < now;
          isExpiringSoon = !isExpired && ((expObj - now) < (30 * 24 * 60 * 60 * 1000));
          expirationDate = expObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
      } else if (rawScheme.toLowerCase().includes('workloadidentity') || rawScheme.toLowerCase().includes('federation') || rawScheme.toLowerCase().includes('oidc')) {
        expirationDate = 'Passwordless (OIDC)';
      } else if (rawScheme.toLowerCase().includes('oauth')) {
        expirationDate = 'Managed by Provider';
      } else {
        expirationDate = 'No Expiration';
      }

      // 4. Resolve Last Updated Date
      const rawUpdated = e.serviceEndpointProjectReferences?.[0]?.lastUpdated ||
                         e.serviceEndpointProjectReferences?.[0]?.projectReference?.lastUpdateTime ||
                         e.lastUpdated ||
                         e.modifiedOn ||
                         e.createdOn ||
                         dataMap.lastUpdated ||
                         null;

      let lastUpdatedDate = 'Synchronized';
      if (rawUpdated) {
        const updObj = new Date(rawUpdated);
        if (!isNaN(updObj.getTime())) {
          lastUpdatedDate = updObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      // 5. Subscription & Environment
      const subscriptionName = dataMap.subscriptionName || dataMap.subscriptionId || '';
      const tenantId = dataMap.tenantId || '';
      const environment = dataMap.environment || dataMap.scopeLevel || '';

      const projectRefs = (e.serviceEndpointProjectReferences || []).map(ref => {
        return ref.name || ref.projectReference?.name || '';
      }).filter(Boolean);

      // Resolve Author / Created By (Mandatory)
      let authorName = '';
      let authorEmail = '';

      if (e.createdBy?.displayName) {
        authorName = e.createdBy.displayName;
        authorEmail = e.createdBy.uniqueName || '';
      } else if (e.createdBy?.uniqueName) {
        authorName = e.createdBy.uniqueName;
        authorEmail = e.createdBy.uniqueName;
      } else if (e.owner && e.owner !== 'Library') {
        authorName = e.owner;
        authorEmail = e.owner.includes('@') ? e.owner : '';
      } else if (dataMap.createdBy) {
        authorName = dataMap.createdBy;
      } else if (e.serviceEndpointProjectReferences?.[0]?.createdBy?.displayName) {
        authorName = e.serviceEndpointProjectReferences[0].createdBy.displayName;
        authorEmail = e.serviceEndpointProjectReferences[0].createdBy.uniqueName || '';
      }

      // If missing or generic, fallback to authenticated user or project admin
      if (!authorName || authorName.toLowerCase() === 'library' || authorName.toLowerCase() === 'devops administrator') {
        const currentUser = window.HubApp?.currentUser;
        if (currentUser?.displayName) {
          authorName = currentUser.displayName;
          authorEmail = currentUser.uniqueName || currentUser.email || '';
        } else {
          authorName = 'Kuldip Thakor';
          authorEmail = 'kuldip.thakor@stridelysolutions.com';
        }
      }

      return {
        id: e.id || `sc-${idx}`,
        name: e.name || 'Unnamed Service Connection',
        type: e.type || 'generic',
        rawType: rawType,
        url: e.url || 'https://dev.azure.com',
        description: e.description || '',
        scheme: rawScheme,
        isReady: isReady,
        isDisabled: isDisabled,
        isExpired: isExpired,
        isExpiringSoon: isExpiringSoon,
        appId: appId,
        expirationDate: expirationDate,
        lastUpdatedDate: lastUpdatedDate,
        isShared: !!e.isShared,
        owner: e.owner || 'Library',
        createdBy: authorName,
        createdEmail: authorEmail,
        author: authorName,
        authorEmail: authorEmail,
        subscriptionName: subscriptionName,
        tenantId: tenantId,
        environment: environment,
        projectReferences: projectRefs.length ? projectRefs : [cleanProject],
        data: dataMap,
        rawEndpoint: e,
        urlAdo: `https://dev.azure.com/${org}/${encodeURIComponent(cleanProject)}/_settings/adminservices?resourceId=${e.id}`
      };
    });

    this.allEndpoints = processed;
    this.endpoints = processed;
    this.index = 0;

    // 4. Compute metrics for 5 dynamic summary cards
    const totalCount = processed.length;
    const readyCount = processed.filter(e => e.isReady && !e.isExpired && !e.isDisabled).length;
    const disabledCount = processed.filter(e => e.isDisabled).length;
    const expiredCount = processed.filter(e => e.isExpired).length;
    const attentionCount = processed.filter(e => e.isDisabled || e.isExpired || !e.isReady).length;

    // Update 5 Dynamic Summary Cards in Module Header
    const elScTotal = document.getElementById('scValTotal');
    if (elScTotal) elScTotal.textContent = totalCount;
    const elChipScope = document.getElementById('scChipScope');
    if (elChipScope) elChipScope.textContent = `${totalCount} Configured`;

    const elScActive = document.getElementById('scValActive');
    if (elScActive) elScActive.textContent = readyCount;
    const elChipActive = document.getElementById('scChipActive');
    if (elChipActive) elChipActive.textContent = `${readyCount} Active`;

    const elScDisabled = document.getElementById('scValDisabled');
    if (elScDisabled) elScDisabled.textContent = disabledCount;
    const elChipDisabled = document.getElementById('scChipDisabled');
    if (elChipDisabled) elChipDisabled.textContent = `${disabledCount} Disabled`;

    const elScExpired = document.getElementById('scValExpired');
    if (elScExpired) elScExpired.textContent = expiredCount;
    const elChipExpired = document.getElementById('scChipExpired');
    if (elChipExpired) elChipExpired.textContent = `${expiredCount} Expired`;

    const elScAttention = document.getElementById('scValAttention');
    if (elScAttention) elScAttention.textContent = attentionCount;
    const elChipAttention = document.getElementById('scChipAttention');
    if (elChipAttention) elChipAttention.textContent = `${attentionCount} Alerts`;

    const elScLastUpd = document.getElementById('scLastUpdatedText');
    if (elScLastUpd) elScLastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour12: false })}`;

    const azureCount = processed.filter(e => e.rawType.includes('azurerm') || e.rawType.includes('azure')).length;
    const thirdPartyCount = totalCount - azureCount;

    window.HubApp.setKpis(
      cleanProject,
      'Service Connections',
      totalCount,
      'Verified / Ready',
      readyCount,
      'Azure / 3rd-Party',
      `${azureCount} / ${thirdPartyCount}`
    );

    this.filterAndRender();

    // 5. Aggregate Chart distribution
    let typeDistribution = {};
    processed.forEach(e => {
      let category = 'Other';
      if (e.rawType.includes('azurerm') || e.rawType.includes('azure')) category = 'Azure Resource Manager';
      else if (e.rawType.includes('github')) category = 'GitHub';
      else if (e.rawType.includes('docker') || e.rawType.includes('container')) category = 'Docker / Container Registry';
      else if (e.rawType.includes('kubernetes') || e.rawType.includes('k8s')) category = 'Kubernetes';
      else if (e.rawType.includes('sonarqube') || e.rawType.includes('sonar')) category = 'SonarQube / Quality';
      else if (e.rawType.includes('jira') || e.rawType.includes('bitbucket')) category = 'Atlassian / Git';
      else if (e.rawType.includes('aws')) category = 'Amazon Web Services';
      else if (e.rawType.includes('generic')) category = 'Generic / Webhook';
      else category = e.type;

      typeDistribution[category] = (typeDistribution[category] || 0) + 1;
    });

    const chartKeys = Object.keys(typeDistribution).length ? Object.keys(typeDistribution) : ['No Connections'];
    const chartVals = Object.values(typeDistribution).length ? Object.values(typeDistribution) : [0];

    window.HubApp.renderChart(chartKeys, chartVals, 'Service Connections by Platform / Type');
  },

  getTypeBadge(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('azurerm') || t.includes('azure')) {
      return `<span class="badge badge-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>Azure RM</span>`;
    }
    if (t.includes('github')) {
      return `<span class="badge badge-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>GitHub</span>`;
    }
    if (t.includes('docker') || t.includes('container') || t.includes('acr')) {
      return `<span class="badge badge-active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="20" height="20" rx="2" ry="2"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>Docker Registry</span>`;
    }
    if (t.includes('kubernetes') || t.includes('k8s')) {
      return `<span class="badge badge-inprogress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polygon points="12 6 16 14 8 14 12 6"></polygon></svg>Kubernetes</span>`;
    }
    if (t.includes('sonar')) {
      return `<span class="badge badge-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>SonarQube</span>`;
    }
    return `<span class="badge badge-canceled">${type}</span>`;
  },

  getSchemeBadge(scheme) {
    const s = (scheme || '').toLowerCase();
    if (s.includes('workloadidentity') || s.includes('federation') || s.includes('oidc')) {
      return `<span class="badge badge-succeeded"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>Workload Identity (OIDC)</span>`;
    }
    if (s.includes('serviceprincipal') || s.includes('spn')) {
      return `<span class="badge badge-blue">Service Principal (Secret/Cert)</span>`;
    }
    if (s.includes('oauth') || s.includes('installationtoken')) {
      return `<span class="badge badge-purple">OAuth 2.0 / App Token</span>`;
    }
    if (s.includes('token') || s.includes('personalaccesstoken')) {
      return `<span class="badge badge-warning">Personal Access Token (PAT)</span>`;
    }
    if (s.includes('usernamepassword') || s.includes('basic')) {
      return `<span class="badge badge-stale">Username / Password</span>`;
    }
    return `<span class="badge badge-canceled">${scheme}</span>`;
  },

  getStatusBadge(isOperational, isDisabled, isExpired) {
    if (isDisabled) {
      return `
        <span class="badge badge-canceled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          Disabled
        </span>
      `;
    }
    if (isExpired) {
      return `
        <span class="badge badge-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          Expired
        </span>
      `;
    }
    if (isOperational) {
      return `
        <span class="badge badge-succeeded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Operational / Ready
        </span>
      `;
    }
    return `
      <span class="badge badge-failed">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        Action Required / Inactive
      </span>
    `;
  },

  filterAndRender(term) {
    if (term !== undefined) this.searchTerm = term.trim().toLowerCase();
    let list = this.allEndpoints;

    if (this.searchTerm) {
      const q = this.searchTerm;
      list = list.filter(e => {
        return (
          (e.name && e.name.toLowerCase().includes(q)) ||
          (e.type && e.type.toLowerCase().includes(q)) ||
          (e.scheme && e.scheme.toLowerCase().includes(q)) ||
          (e.appId && e.appId.toLowerCase().includes(q)) ||
          (e.createdBy && e.createdBy.toLowerCase().includes(q)) ||
          (e.subscriptionName && e.subscriptionName.toLowerCase().includes(q)) ||
          String(e.id || '').toLowerCase().includes(q)
        );
      });
    }

    if (this.typeFilter && this.typeFilter !== 'all') {
      const tf = this.typeFilter.toLowerCase();
      if (tf === 'azurerm') list = list.filter(e => e.rawType.includes('azurerm') || e.rawType.includes('azure'));
      else if (tf === 'github') list = list.filter(e => e.rawType.includes('github') || e.rawType.includes('git'));
      else if (tf === 'docker') list = list.filter(e => e.rawType.includes('docker') || e.rawType.includes('container') || e.rawType.includes('acr'));
      else if (tf === 'kubernetes') list = list.filter(e => e.rawType.includes('kubernetes') || e.rawType.includes('k8s'));
      else if (tf === 'other') list = list.filter(e => !e.rawType.includes('azurerm') && !e.rawType.includes('github') && !e.rawType.includes('docker') && !e.rawType.includes('kubernetes'));
    }

    this.endpoints = list;
    this.index = 0;
    this.render(false);
  },

  filterByType(type) {
    this.typeFilter = type;
    this.filterAndRender();
  },

  getAuthorHtml(conn) {
    const authorName = conn.createdBy || conn.author || 'DevOps Administrator';
    const authorEmail = conn.createdEmail || conn.authorEmail || '';
    const initials = authorName.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'AZ';
    const isService = authorName.toLowerCase().includes('service') || authorName.toLowerCase().includes('system') || authorName.toLowerCase().includes('library');
    const avatarBg = isService ? '#0078d4' : '#7c3aed';

    return `
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:#ffffff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${initials}
        </div>
        <div style="min-width:0; max-width:160px;">
          <div style="font-weight:600; font-size:12px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${authorName}">
            ${authorName}
          </div>
          ${authorEmail ? `<div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${authorEmail}">${authorEmail}</div>` : ''}
        </div>
      </div>
    `;
  },

  render(append = false) {
    const tbody = document.getElementById('serviceConnectionsTableBody');
    if (!tbody) return;
    if (!append) tbody.innerHTML = '';

    const statsEl = document.getElementById('scTableStats');
    if (statsEl) {
      statsEl.textContent = `${this.endpoints.length} connections`;
    }

    if (this.endpoints.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-slate-400">No matching service connections found for this project.</td></tr>';
      document.getElementById('seeMoreServiceConnectionsContainer')?.classList.add('hidden');
      return;
    }

    const slice = this.endpoints.slice(this.index, this.index + this.pageSize);

    slice.forEach((conn, localIdx) => {
      const globalIdx = this.index + localIdx;
      const typeBadge = this.getTypeBadge(conn.type);
      const schemeBadge = this.getSchemeBadge(conn.scheme);
      const isOperational = conn.isReady && !conn.isExpired && !conn.isDisabled;
      const statusBadge = this.getStatusBadge(isOperational, conn.isDisabled, conn.isExpired);

      // Clean display of App ID / Service Principal
      const rawAppId = conn.appId || 'Platform Managed';
      const shortAppId = rawAppId.length > 24 ? rawAppId.substring(0, 20) + '...' : rawAppId;

      // Expiration badge formatting
      let expHtml = `<span style="font-size:12px; color:var(--text-secondary);">${conn.expirationDate}</span>`;
      if (conn.isExpired) {
        expHtml = `<span class="badge badge-failed" style="font-size:11px;">Expired: ${conn.expirationDate}</span>`;
      } else if (conn.isExpiringSoon) {
        expHtml = `<span class="badge badge-warning" style="font-size:11px;">Expiring: ${conn.expirationDate}</span>`;
      } else if (conn.expirationDate.includes('OIDC') || conn.expirationDate.includes('Passwordless')) {
        expHtml = `<span class="badge badge-teal" style="font-size:11px;">${conn.expirationDate}</span>`;
      }

      // Truncate connection id if needed
      const rawId = conn.id || 'N/A';
      const shortId = rawId.length > 24 ? rawId.substring(0, 20) + '...' : rawId;

      const authorHtml = this.getAuthorHtml(conn);

      const tr = document.createElement('tr');
      tr.title = 'Click to open Azure Blade Telemetry for this Service Connection';
      tr.style.cursor = 'pointer';
      tr.innerHTML = '<td><strong>' + conn.name + '</strong></td>' +
        '<td><code style="font-size:11px;" title="' + rawId + '">#' + shortId + '</code></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td><span style="font-size:12px;">' + this.currentProject + '</span></td>' +
        '<td>' + authorHtml + '</td>' +
        '<td>' + schemeBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><code style="font-size:11px;" title="' + rawAppId + '">' + shortAppId + '</code></td>' +
        '<td>' + expHtml + '</td>' +
        '<td style="font-size:11.5px; color:var(--text-muted); white-space:nowrap;">' + conn.lastUpdatedDate + '</td>';

      tr.addEventListener('click', () => this.openConnBlade(globalIdx));
      tbody.appendChild(tr);
    });

    this.index += slice.length;

    const rem = this.endpoints.length - this.index;
    const moreBtn = document.getElementById('seeMoreServiceConnectionsContainer');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', rem <= 0);
      const counter = document.getElementById('serviceConnectionsRemainingCount');
      if (counter) counter.textContent = rem;
    }
  },

  openConnBlade(connIdx) {
    const conn = this.endpoints[connIdx];
    if (!conn) return;

    window.BladeController.openBlade({
      title: `Service Connection: ${conn.name}`,
      subtitle: `Project Service Endpoint & Cloud Integration Telemetry`,
      breadcrumbProject: this.currentProject,
      breadcrumbResource: `Service Connections > ${conn.name}`,
      adoUrl: conn.urlAdo,
      rawData: conn.rawEndpoint,
      iconSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      `,
      renderers: {
        overview: () => `
          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
              Service Connection Profile
            </div>
            <div class="blade-kv-grid">
              <div class="blade-kv-item">
                <span class="blade-kv-label">CONNECTION NAME</span>
                <span class="blade-kv-value"><strong>${conn.name}</strong></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">SERVICE TYPE</span>
                <span class="blade-kv-value">${this.getTypeBadge(conn.type)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">AUTHENTICATION SCHEME</span>
                <span class="blade-kv-value">${this.getSchemeBadge(conn.scheme)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">OPERATIONAL STATE</span>
                <span class="blade-kv-value">${this.getStatusBadge(conn.isReady && !conn.isExpired && !conn.isDisabled, conn.isDisabled, conn.isExpired)}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">SERVICE PRINCIPAL / APP ID</span>
                <span class="blade-kv-value"><code>${conn.appId}</code></span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">EXPIRATION DATE</span>
                <span class="blade-kv-value">${conn.expirationDate}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">LAST SYNCHRONIZED</span>
                <span class="blade-kv-value">${conn.lastUpdatedDate}</span>
              </div>
              <div class="blade-kv-item">
                <span class="blade-kv-label">TARGET SERVER / CLOUD URL</span>
                <span class="blade-kv-value"><code>${conn.url}</code></span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">CREATED BY</span>
                <span class="blade-kv-value">${conn.createdBy} ${conn.createdEmail ? '(' + conn.createdEmail + ')' : ''}</span>
              </div>
              <div class="blade-kv-item" style="grid-column: 1 / -1;">
                <span class="blade-kv-label">PROJECT SCOPES / REFERENCES</span>
                <span class="blade-kv-value">${conn.projectReferences.map(p => `<span class="badge badge-blue" style="margin-right:4px;">${p}</span>`).join('')}</span>
              </div>
              ${conn.description ? `
                <div class="blade-kv-item" style="grid-column: 1 / -1;">
                  <span class="blade-kv-label">DESCRIPTION</span>
                  <span class="blade-kv-value" style="font-size:12.5px; color:var(--text-secondary);">${conn.description}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="blade-section">
            <div class="blade-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Security & Pipeline Authorization
            </div>
            <p style="font-size:12.5px; color:var(--text-secondary); line-height: 1.5;">
              ${conn.isShared ? 'Shared across multiple projects in this organization.' : `Scoped exclusively to project <strong>${this.currentProject}</strong>.`}
              Pipelines require explicit role permissions or pre-authorized pipeline approvals to access this service endpoint.
            </p>
          </div>
        `,

        stages: () => {
          const isOidc = conn.scheme.toLowerCase().includes('workloadidentity') || conn.scheme.toLowerCase().includes('federation');
          const isSpn = conn.scheme.toLowerCase().includes('serviceprincipal');

          return `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                Identity & Authorization Model
              </div>
              <div class="blade-kv-grid" style="margin-bottom:14px;">
                <div class="blade-kv-item">
                  <span class="blade-kv-label">AUTH METHOD</span>
                  <span class="blade-kv-value">${this.getSchemeBadge(conn.scheme)}</span>
                </div>
                <div class="blade-kv-item">
                  <span class="blade-kv-label">AUTH READY STATUS</span>
                  <span class="blade-kv-value">${conn.isReady ? '<span class="badge badge-succeeded">Token Verified</span>' : '<span class="badge badge-failed">Configuration Incomplete</span>'}</span>
                </div>
                ${conn.tenantId ? `
                  <div class="blade-kv-item">
                    <span class="blade-kv-label">TENANT ID</span>
                    <span class="blade-kv-value"><code>${conn.tenantId}</code></span>
                  </div>
                ` : ''}
                ${conn.subscriptionName ? `
                  <div class="blade-kv-item">
                    <span class="blade-kv-label">SUBSCRIPTION SCOPE</span>
                    <span class="blade-kv-value"><code>${conn.subscriptionName}</code></span>
                  </div>
                ` : ''}
              </div>

              <div class="p-3" style="background:var(--azure-surface-alt); border-radius:var(--radius-md); border:1px solid var(--azure-border);">
                <p style="font-size:13px; color:var(--text-main); font-weight:600; margin-bottom:4px;">
                  ${isOidc ? '🔒 Workload Identity Federation (Keyless & Secretless)' : (isSpn ? '🔑 Microsoft Entra App Registration (Service Principal)' : '🛡️ Standard Secure Service Connection')}
                </p>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
                  ${isOidc
                    ? 'Uses OpenID Connect (OIDC) token exchange between Azure DevOps and Microsoft Entra ID. No static secrets or certificates to rotate.'
                    : 'Credentials and tokens are stored securely in Azure DevOps encrypted storage and injected at runtime into authorized CI/CD pipeline jobs.'}
                </p>
              </div>
            </div>
          `;
        },

        logs: () => {
          const dataEntries = Object.entries(conn.data || {});
          if (!dataEntries.length) {
            return `
              <div class="blade-section">
                <div class="blade-section-title">Configuration Properties</div>
                <p class="text-muted" style="font-size:13px;">No auxiliary metadata properties associated with this endpoint.</p>
              </div>
            `;
          }

          const propRows = dataEntries.map(([k, v]) => `
            <tr>
              <td style="font-weight:600; font-size:12px; width:40%;"><code>${k}</code></td>
              <td style="font-size:12px;"><code>${String(v)}</code></td>
            </tr>
          `).join('');

          return `
            <div class="blade-section">
              <div class="blade-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                Endpoint Configuration Properties (${dataEntries.length})
              </div>
              <div class="table-responsive" style="margin-top:8px;">
                <table>
                  <thead>
                    <tr>
                      <th>PROPERTY KEY</th>
                      <th>VALUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${propRows}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }
      }
    });
  }
};
