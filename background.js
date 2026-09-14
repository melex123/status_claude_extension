const CLAUDE_API_BASE = 'https://claude.ai';
const STATUS_API = 'https://status.claude.com/api/v2/summary.json';
const DEFAULT_REFRESH_MINUTES = 5;
const DEFAULT_THRESHOLDS = [80, 95]; // [warn, critical], percent
const MAX_BARS = 12; // cap on API-sourced limits (each becomes a bar + notification keys)

const CLAUDE_HEADERS = {
  'accept': '*/*',
  'content-type': 'application/json',
  'anthropic-client-platform': 'web_claude_ai',
  'anthropic-client-version': '1.0.0',
};

const BADGE_COLORS = {
  ok: '#22C55E',
  warn: '#F59E0B',
  critical: '#EF4444',
};

const SEVERITY_RANK = { ok: 0, warn: 1, critical: 2 };

// --- API Calls ---

async function fetchWithAuth(url) {
  // Cookies are sent automatically via credentials: 'include' + host_permissions
  // Do NOT set Cookie header manually — browsers strip it from fetch()
  const response = await fetch(url, {
    method: 'GET',
    headers: CLAUDE_HEADERS,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function fetchOrganizations() {
  return fetchWithAuth(`${CLAUDE_API_BASE}/api/organizations`);
}

async function fetchUsage(orgId) {
  return fetchWithAuth(`${CLAUDE_API_BASE}/api/organizations/${encodeURIComponent(orgId)}/usage`);
}

async function fetchStatus() {
  const response = await fetch(STATUS_API);
  if (!response.ok) {
    throw new Error(`Status API: HTTP ${response.status}`);
  }
  return response.json();
}

// --- Usage normalization ---

// Legacy top-level keys, used only when the response has no `limits[]`.
const LEGACY_LIMITS = [
  { id: 'five_hour', label: '5-Hour Limit' },
  { id: 'seven_day', label: '7-Day Limit' },
  { id: 'seven_day_opus', label: '7-Day Opus' },
  { id: 'seven_day_sonnet', label: '7-Day Sonnet' },
];

const KIND_LABELS = {
  session: { id: 'five_hour', label: '5-Hour Limit' },
  weekly_all: { id: 'seven_day', label: '7-Day Limit' },
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function severityFor(percent, [warn, critical]) {
  if (percent >= critical) return 'critical';
  if (percent >= warn) return 'warn';
  return 'ok';
}

// One entry of `usage.limits[]` -> render-ready bar, or null when the entry
// carries nothing we can name. Model- or surface-scoped weekly limits (e.g.
// Fable) only exist here; they have no top-level key in the response.
function barFromLimit(limit) {
  const scope = limit.scope || {};
  const scopeName = (scope.model && scope.model.display_name) || (scope.surface && scope.surface.display_name);
  const kind = typeof limit.kind === 'string' ? limit.kind : '';

  let id, label;
  if (Object.hasOwn(KIND_LABELS, kind)) {
    ({ id, label } = KIND_LABELS[kind]);
  } else if (typeof scopeName === 'string' && scopeName) {
    const name = scopeName.slice(0, 40); // API-sourced; lands in ids, storage keys and notification titles
    id = `seven_day_${slug(name)}`;
    label = `7-Day ${name}`;
  } else if (kind) {
    id = kind;
    label = kind;
  } else {
    return null;
  }

  return { id, label, percent: limit.percent, resets_at: limit.resets_at };
}

// Raw usage response -> [{ id, label, percent (0-100), resets_at, severity }].
// Badge, notifications and popup all consume this; none of them knows API keys.
// Entries without a usable percent are dropped, the rest clamped to 0-100.
function buildBars(usage, thresholds) {
  let bars;
  if (Array.isArray(usage.limits) && usage.limits.length > 0) {
    bars = usage.limits.map(barFromLimit).filter(Boolean);
    if (bars.length > MAX_BARS) {
      // Keep the fullest ones so the badge and notifications never miss a limit that matters.
      bars = bars.sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, MAX_BARS);
    }
  } else {
    bars = LEGACY_LIMITS
      .filter(({ id }) => usage[id])
      .map(({ id, label }) => ({ id, label, percent: usage[id].utilization, resets_at: usage[id].resets_at }));
  }

  return bars
    .filter((bar) => Number.isFinite(bar.percent))
    .map((bar) => {
      const percent = Math.min(100, Math.max(0, bar.percent));
      return { ...bar, percent, severity: severityFor(percent, thresholds) };
    });
}

// --- Data Refresh ---

async function loadStatus() {
  const statusData = await fetchStatus();
  return {
    indicator: statusData.status.indicator,
    description: statusData.status.description,
    components: statusData.components
      .filter((c) => c.showcase !== false)
      .map((c) => ({ name: c.name, status: c.status })),
    incidents: (statusData.incidents || []).slice(0, 3).map((inc) => ({
      name: inc.name,
      status: inc.status,
      impact: inc.impact,
      created_at: inc.created_at,
    })),
  };
}

async function loadUsage(selectedOrgId, thresholds) {
  const cookie = await chrome.cookies.get({ url: CLAUDE_API_BASE, name: 'sessionKey' });
  if (!cookie) return { noSession: true };

  let orgId = selectedOrgId;
  if (!orgId) {
    const orgs = await fetchOrganizations();
    if (orgs && orgs.length > 0) {
      orgId = orgs[0].uuid;
      await chrome.storage.local.set({
        selectedOrgId: orgId,
        organizations: orgs.map((o) => ({ uuid: o.uuid, name: o.name })),
      });
    }
  }
  if (!orgId) return { noOrg: true };

  const usage = await fetchUsage(orgId);
  return { bars: buildBars(usage, thresholds) };
}

// options.js writes { enabled, thresholds: [a, b] }; default per field and
// keep thresholds ascending so severityFor()'s [warn, critical] order holds.
function resolveSettings(stored) {
  const s = stored || {};
  const thresholds = Array.isArray(s.thresholds) && s.thresholds.length === 2 && s.thresholds.every(Number.isFinite)
    ? [...s.thresholds].sort((a, b) => a - b)
    : DEFAULT_THRESHOLDS;
  return { enabled: s.enabled !== false, thresholds };
}

async function refreshData() {
  const { selectedOrgId, notificationSettings } = await chrome.storage.local.get(['selectedOrgId', 'notificationSettings']);
  const settings = resolveSettings(notificationSettings);

  // Status and usage are independent; fetch them concurrently.
  const [statusRes, usageRes] = await Promise.allSettled([
    loadStatus(),
    loadUsage(selectedOrgId, settings.thresholds),
  ]);

  const errors = [];
  if (statusRes.status === 'rejected') errors.push(`Status fetch failed: ${statusRes.reason.message}`);
  if (usageRes.status === 'rejected') errors.push(`Usage fetch failed: ${usageRes.reason.message}`);

  const result = {
    status: statusRes.status === 'fulfilled' ? statusRes.value : null,
    usage: usageRes.status === 'fulfilled' ? usageRes.value : null,
    error: errors.length ? errors.join(' | ') : null,
    lastUpdated: Date.now(),
  };

  await chrome.storage.local.set({ monitorData: result });
  updateBadge(result);
  await checkNotifications(result, settings);

  return result;
}

// --- Badge Icon ---

function statusSeverity(status) {
  if (!status) return 'ok';

  const outage = status.indicator === 'major'
    || status.components.some((c) => c.status === 'major_outage' || c.status === 'partial_outage');
  if (outage) return 'critical';

  const degraded = status.indicator === 'minor' || status.indicator === 'degraded_performance'
    || status.components.some((c) => c.status === 'degraded_performance');
  return degraded ? 'warn' : 'ok';
}

function worstSeverity(severities) {
  return severities.reduce((worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst), 'ok');
}

function updateBadge(data) {
  const bars = (data.usage && data.usage.bars) || [];
  const severity = worstSeverity([statusSeverity(data.status), ...bars.map((b) => b.severity)]);

  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[severity] });
  chrome.action.setBadgeText({ text: severity === 'ok' ? '' : '!' });
}

// --- Notifications ---

// `fired` holds one key per (bar, threshold) currently over the line, so a
// notification fires once per crossing. It is rebuilt from the current bars,
// so keys for limits that reset, renamed or disappeared drop out automatically.
async function checkNotifications(data, settings) {
  if (!data.usage || !data.usage.bars) return;

  // Read right before use: a popup-triggered refresh can overlap the alarm's.
  const { firedNotifications } = await chrome.storage.local.get('firedNotifications');
  const fired = firedNotifications || {};
  const newFired = {};

  for (const bar of data.usage.bars) {
    const pct = Math.round(bar.percent);

    for (const threshold of settings.thresholds) {
      if (!(pct >= threshold)) continue;

      const notifKey = `${bar.id}_${threshold}`;
      newFired[notifKey] = true;
      if (fired[notifKey] || !settings.enabled) continue;

      chrome.notifications.create(notifKey, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `Claude Monitor - ${bar.label}`,
        message: `Usage reached ${pct}% (threshold: ${threshold}%)`,
        priority: threshold === settings.thresholds[1] ? 2 : 1,
      });
    }
  }

  const oldKeys = Object.keys(fired);
  const newKeys = Object.keys(newFired);
  const changed = oldKeys.length !== newKeys.length || newKeys.some((k) => !fired[k]);
  if (changed) {
    await chrome.storage.local.set({ firedNotifications: newFired });
  }
}

// --- Alarm Setup ---

async function setupAlarm() {
  const { refreshInterval } = await chrome.storage.local.get('refreshInterval');
  const minutes = Math.max(1, parseInt(refreshInterval, 10) || DEFAULT_REFRESH_MINUTES);

  await chrome.alarms.clear('refresh');
  chrome.alarms.create('refresh', { periodInMinutes: minutes });
}

// --- Event Listeners ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') {
    refreshData();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  refreshData();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  refreshData();
});

// Listen for messages from popup/options
function failedRefresh(err) {
  return { status: null, usage: null, error: `Refresh failed: ${err.message}`, lastUpdated: Date.now() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return;

  if (msg.action === 'refresh') {
    refreshData().then(sendResponse, (err) => sendResponse(failedRefresh(err)));
    return true; // async response
  }
  if (msg.action === 'updateAlarm') {
    setupAlarm();
    sendResponse({ ok: true });
  }
  if (msg.action === 'changeOrg') {
    if (!UUID_RE.test(msg.orgId)) return;
    chrome.storage.local.set({ selectedOrgId: msg.orgId })
      .then(refreshData)
      .then(sendResponse, (err) => sendResponse(failedRefresh(err)));
    return true;
  }
});
