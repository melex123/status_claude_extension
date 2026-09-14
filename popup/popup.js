// Bars arrive render-ready from background.js (`monitorData.usage.bars`).
// This map only picks colors; unknown bar ids fall back to a neutral palette.
const BAR_COLORS = {
  five_hour: ['#d97706', '#f59e0b'],
  seven_day: ['#8b5cf6', '#a78bfa'],
  seven_day_opus: ['#06b6d4', '#22d3ee'],
  seven_day_sonnet: ['#10b981', '#34d399'],
  seven_day_fable: ['#ec4899', '#f472b6'],
};
const FALLBACK_COLORS = ['#64748b', '#94a3b8'];
const CRITICAL_COLORS = ['#ef4444', '#f87171'];

// Placeholder rows while nothing is cached yet; these two limits always exist.
const SHIMMER_BARS = [
  { id: 'five_hour', label: '5-Hour Limit' },
  { id: 'seven_day', label: '7-Day Limit' },
];

// Skip the network round-trip on open when the alarm refreshed recently.
const STALE_MS = 60_000;

const STATUS_LABELS = {
  operational: 'Operational',
  degraded_performance: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  under_maintenance: 'Maintenance',
};

// Shorten status.claude.com component names for the 2-column grid: drop a
// trailing "(host)" and apply the few explicit renames. Anything else is shown
// as-is and truncated with ellipsis by CSS.
const SHORT_NAMES = {
  'Claude for Government': 'Government',
};

function shortComponentName(name) {
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, '');
  return Object.hasOwn(SHORT_NAMES, stripped) ? SHORT_NAMES[stripped] : stripped;
}

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

// The three panels are mutually exclusive; 'loading' shows the usage section with shimmer.
const VIEWS = {
  loading: usageSection,
  usage: usageSection,
  login: loginPrompt,
  error: errorState,
};

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

function renderBars(rows) {
  usageBars.innerHTML = '';

  for (const { label, info, pct, colors, extraClass = '' } of rows) {
    const item = document.createElement('div');
    item.className = `usage-bar-item${extraClass}`;
    if (colors) {
      item.style.setProperty('--bar-c1', colors[0]);
      item.style.setProperty('--bar-c2', colors[1]);
    }
    item.innerHTML = `
      <div class="usage-bar-header">
        <span class="usage-bar-label">${escapeHtml(label)}</span>
        <span class="usage-bar-info">${escapeHtml(info)}</span>
      </div>
      <div class="usage-bar-track">
        <div class="usage-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
    usageBars.appendChild(item);
  }
}

function renderUsageBars(bars) {
  renderBars(bars.map((bar) => {
    const pct = Math.round(bar.percent);
    const isCritical = bar.severity === 'critical';
    return {
      label: bar.label,
      info: `${pct}% used · Reset ${formatResetTime(bar.resets_at)}`,
      pct,
      colors: isCritical ? CRITICAL_COLORS : (Object.hasOwn(BAR_COLORS, bar.id) ? BAR_COLORS[bar.id] : FALLBACK_COLORS),
      extraClass: isCritical ? ' critical' : '',
    };
  }));
}

function renderShimmer() {
  renderBars(SHIMMER_BARS.map((bar) => ({ label: bar.label, info: 'Loading...', pct: 100, extraClass: ' shimmer' })));
}

function renderStatusGrid(components) {
  statusGrid.innerHTML = '';

  for (const comp of components) {
    const name = shortComponentName(comp.name);
    const statusLabel = Object.hasOwn(STATUS_LABELS, comp.status) ? STATUS_LABELS[comp.status] : comp.status;
    const item = document.createElement('div');
    item.className = 'status-item';
    item.title = `${comp.name}: ${statusLabel}`;
    item.innerHTML = `
      <span class="dot ${escapeHtml(comp.status)}"></span>
      <span class="name">${escapeHtml(name)}</span>
    `;
    statusGrid.appendChild(item);
  }
}

function renderStatusBadge(statusData) {
  const textEl = statusBadge.querySelector('.status-text');
  const indicator = statusData.indicator;

  statusBadge.classList.remove('degraded', 'outage');

  if (indicator === 'none') {
    textEl.textContent = 'All Operational';
  } else if (indicator === 'minor' || indicator === 'degraded_performance') {
    textEl.textContent = 'Degraded';
    statusBadge.classList.add('degraded');
  } else if (indicator === 'major' || indicator === 'critical') {
    textEl.textContent = 'Outage';
    statusBadge.classList.add('outage');
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

function usageErrorMessage(usage) {
  if (usage && usage.noOrg) return 'No organization found for this account';
  if (usage && usage.bars) return 'No usage limits reported';
  // Data written by an older background.js (no `bars`): the popup reloads from
  // disk on open, the service worker only after an extension reload.
  return 'Extension was updated. Reload it in chrome://extensions';
}

function viewFor(data) {
  if (!data) return 'loading';
  if (data.usage && data.usage.noSession) return 'login';
  if (data.usage && data.usage.bars && data.usage.bars.length > 0) return 'usage';
  return 'error';
}

function setView(view) {
  for (const el of Object.values(VIEWS)) {
    el.classList.toggle('hidden', VIEWS[view] !== el);
  }
  return view;
}

function render(data) {
  const view = setView(viewFor(data));

  if (view === 'loading') {
    renderShimmer();
    return;
  }
  if (view === 'usage') renderUsageBars(data.usage.bars);
  if (view === 'error') {
    errorMessage.textContent = data.error || usageErrorMessage(data.usage);
  }

  if (data.status) {
    statusSection.classList.remove('hidden');
    renderStatusBadge(data.status);
    renderStatusGrid(data.status.components);
    renderIncidents(data.status.incidents);
  }

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

statusGrid.addEventListener('click', (e) => {
  if (e.target.closest('.status-item')) {
    chrome.tabs.create({ url: 'https://status.claude.com' });
  }
});

loginBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://claude.ai' });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// --- Init ---

(async () => {
  const { bgColor, monitorData } = await chrome.storage.local.get(['bgColor', 'monitorData']);

  if (bgColor) {
    document.body.style.background = bgColor;
  }

  render(monitorData || null);

  if (!monitorData || Date.now() - monitorData.lastUpdated > STALE_MS) {
    doRefresh();
  }
})();
