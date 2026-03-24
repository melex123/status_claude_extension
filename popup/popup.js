const LIMITS = [
  { key: 'five_hour', label: '5-Hour Limit', cssClass: 'bar-five-hour' },
  { key: 'seven_day', label: '7-Day Limit', cssClass: 'bar-seven-day' },
  { key: 'seven_day_opus', label: '7-Day Opus', cssClass: 'bar-seven-day-opus' },
  { key: 'seven_day_sonnet', label: '7-Day Sonnet', cssClass: 'bar-seven-day-sonnet' },
];

const STATUS_LABELS = {
  operational: 'Operational',
  degraded_performance: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  under_maintenance: 'Maintenance',
};

// --- DOM refs ---

const $ = (sel) => document.querySelector(sel);
const usageSection = $('#usageSection');
const usageBars = $('#usageBars');
const statusSection = $('#statusSection');
const statusGrid = $('#statusGrid');
const statusBadge = $('#statusBadge');
const loginPrompt = $('#loginPrompt');
const errorState = $('#errorState');
const errorMessage = $('#errorMessage');
const incidentsSection = $('#incidentsSection');
const incidentsList = $('#incidentsList');
const lastUpdated = $('#lastUpdated');
const refreshBtn = $('#refreshBtn');
const retryBtn = $('#retryBtn');
const loginBtn = $('#loginBtn');
const settingsBtn = $('#settingsBtn');

// --- Security: HTML escape for API-sourced strings ---

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Time formatting ---

function formatResetTime(isoString) {
  if (!isoString) return '';
  const reset = new Date(isoString);
  const now = Date.now();
  const diff = reset.getTime() - now;

  if (diff <= 0) return 'resetting...';

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLastUpdated(timestamp) {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// --- Rendering ---

function renderUsageBars(usage) {
  usageBars.innerHTML = '';

  for (const limit of LIMITS) {
    const data = usage[limit.key];
    if (!data) continue;

    // API returns utilization as percentage (0-100), not decimal
    const pct = Math.round(data.utilization);
    const resetTime = formatResetTime(data.resets_at);
    const isCritical = pct >= 90;

    const item = document.createElement('div');
    item.className = `usage-bar-item ${limit.cssClass}${isCritical ? ' critical' : ''}`;
    item.innerHTML = `
      <div class="usage-bar-header">
        <span class="usage-bar-label">${limit.label}</span>
        <span class="usage-bar-info">${pct}% used · Reset ${resetTime}</span>
      </div>
      <div class="usage-bar-track">
        <div class="usage-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
    usageBars.appendChild(item);
  }
}

function renderShimmer() {
  usageBars.innerHTML = '';
  for (const limit of LIMITS) {
    const item = document.createElement('div');
    item.className = `usage-bar-item ${limit.cssClass} shimmer`;
    item.innerHTML = `
      <div class="usage-bar-header">
        <span class="usage-bar-label">${limit.label}</span>
        <span class="usage-bar-info">Loading...</span>
      </div>
      <div class="usage-bar-track">
        <div class="usage-bar-fill"></div>
      </div>
    `;
    usageBars.appendChild(item);
  }
}

function renderStatusGrid(components) {
  statusGrid.innerHTML = '';

  // Shorten component names for compact display
  const shortNames = {
    'claude.ai': 'claude.ai',
    'platform.claude.com (formerly console.anthropic.com)': 'Platform',
    'Claude API (api.anthropic.com)': 'Claude API',
    'Claude Code': 'Claude Code',
    'Claude for Government': 'Government',
  };

  for (const comp of components) {
    const name = shortNames[comp.name] || comp.name;
    const item = document.createElement('div');
    item.className = 'status-item';
    item.title = `${escapeHtml(comp.name)}: ${escapeHtml(STATUS_LABELS[comp.status] || comp.status)}`;
    item.innerHTML = `
      <span class="dot ${escapeHtml(comp.status)}"></span>
      <span class="name">${escapeHtml(name)}</span>
    `;
    item.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://status.claude.com' });
    });
    statusGrid.appendChild(item);
  }
}

function renderStatusBadge(statusData) {
  const badge = statusBadge;
  const textEl = badge.querySelector('.status-text');

  badge.classList.remove('degraded', 'outage');

  if (!statusData) {
    textEl.textContent = 'Unknown';
    return;
  }

  const indicator = statusData.indicator;

  if (indicator === 'none') {
    textEl.textContent = 'All Operational';
  } else if (indicator === 'minor' || indicator === 'degraded_performance') {
    textEl.textContent = 'Degraded';
    badge.classList.add('degraded');
  } else if (indicator === 'major' || indicator === 'critical') {
    textEl.textContent = 'Outage';
    badge.classList.add('outage');
  } else {
    textEl.textContent = statusData.description || indicator;
  }
}

function renderIncidents(incidents) {
  if (!incidents || incidents.length === 0) {
    incidentsSection.classList.add('hidden');
    return;
  }

  incidentsSection.classList.remove('hidden');
  incidentsList.innerHTML = '';

  for (const inc of incidents) {
    const div = document.createElement('div');
    div.className = `incident${inc.impact === 'minor' ? ' minor' : ''}`;
    div.innerHTML = `
      <div class="incident-name">${escapeHtml(inc.name)}</div>
      <div class="incident-status">${escapeHtml(inc.status)} · ${new Date(inc.created_at).toLocaleDateString()}</div>
    `;
    incidentsList.appendChild(div);
  }
}

// --- Main render ---

function render(data) {
  if (!data) {
    usageSection.classList.remove('hidden');
    renderShimmer();
    return;
  }

  // Usage
  if (data.usage && data.usage.noSession) {
    loginPrompt.classList.remove('hidden');
    usageSection.classList.add('hidden');
    errorState.classList.add('hidden');
  } else if (data.usage && !data.usage.noOrg) {
    loginPrompt.classList.add('hidden');
    errorState.classList.add('hidden');
    usageSection.classList.remove('hidden');
    renderUsageBars(data.usage);
  } else if (data.error) {
    errorState.classList.remove('hidden');
    usageSection.classList.add('hidden');
    loginPrompt.classList.add('hidden');
    errorMessage.textContent = data.error;
  }

  // Status
  if (data.status) {
    statusSection.classList.remove('hidden');
    renderStatusBadge(data.status);
    renderStatusGrid(data.status.components);
    renderIncidents(data.status.incidents);
  }

  // Last updated
  lastUpdated.textContent = `Updated ${formatLastUpdated(data.lastUpdated)}`;
}

// --- Refresh ---

async function doRefresh() {
  refreshBtn.classList.add('refreshing');

  try {
    const data = await chrome.runtime.sendMessage({ action: 'refresh' });
    render(data);
  } catch {
    // Fallback: read from storage
    const { monitorData } = await chrome.storage.local.get('monitorData');
    if (monitorData) render(monitorData);
  }

  refreshBtn.classList.remove('refreshing');
}

// --- Event listeners ---

refreshBtn.addEventListener('click', doRefresh);
retryBtn.addEventListener('click', doRefresh);

loginBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://claude.ai' });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// --- Init ---

(async () => {
  // Show shimmer immediately
  usageSection.classList.remove('hidden');
  renderShimmer();

  // Try stored data first
  const { monitorData } = await chrome.storage.local.get('monitorData');

  if (monitorData) {
    render(monitorData);
  }

  // Then refresh
  doRefresh();
})();
