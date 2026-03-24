const CLAUDE_API_BASE = 'https://claude.ai';
const STATUS_API = 'https://status.claude.com/api/v2/summary.json';
const DEFAULT_REFRESH_MINUTES = 5;

const CLAUDE_HEADERS = {
  'accept': '*/*',
  'content-type': 'application/json',
  'anthropic-client-platform': 'web_claude_ai',
  'anthropic-client-version': '1.0.0',
};

// --- Cookie Extraction ---

async function getSessionKey() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: CLAUDE_API_BASE, name: 'sessionKey' }, (cookie) => {
      resolve(cookie ? cookie.value : null);
    });
  });
}

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
  return fetchWithAuth(`${CLAUDE_API_BASE}/api/organizations/${orgId}/usage`);
}

async function fetchStatus() {
  const response = await fetch(STATUS_API);
  if (!response.ok) {
    throw new Error(`Status API: HTTP ${response.status}`);
  }
  return response.json();
}

// --- Data Refresh ---

async function refreshData() {
  const result = {
    usage: null,
    status: null,
    error: null,
    lastUpdated: Date.now(),
  };

  // Fetch status (no auth needed)
  try {
    const statusData = await fetchStatus();
    result.status = {
      indicator: statusData.status.indicator,
      description: statusData.status.description,
      components: statusData.components
        .filter((c) => c.showcase !== false)
        .map((c) => ({
          name: c.name,
          status: c.status,
        })),
      incidents: (statusData.incidents || []).slice(0, 3).map((inc) => ({
        name: inc.name,
        status: inc.status,
        impact: inc.impact,
        created_at: inc.created_at,
      })),
    };
  } catch (err) {
    result.error = `Status fetch failed: ${err.message}`;
  }

  // Fetch usage (needs auth)
  try {
    const sessionKey = await getSessionKey();
    if (!sessionKey) {
      result.usage = { noSession: true };
    } else {
      const { selectedOrgId } = await chrome.storage.local.get('selectedOrgId');
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

      if (orgId) {
        const usage = await fetchUsage(orgId);
        result.usage = usage;
      } else {
        result.usage = { noOrg: true };
      }
    }
  } catch (err) {
    if (!result.error) {
      result.error = `Usage fetch failed: ${err.message}`;
    } else {
      result.error += ` | Usage fetch failed: ${err.message}`;
    }
  }

  await chrome.storage.local.set({ monitorData: result });

  // Update badge
  updateBadge(result);

  // Check notification thresholds
  checkNotifications(result);

  return result;
}

// --- Badge Icon ---

function updateBadge(data) {
  let color = '#22C55E'; // green

  if (data.status) {
    const indicator = data.status.indicator;
    if (indicator === 'major') {
      color = '#EF4444';
    } else if (indicator === 'minor' || indicator === 'degraded_performance') {
      color = '#F59E0B';
    }

    // Also check individual components
    const hasOutage = data.status.components.some((c) =>
      c.status === 'major_outage' || c.status === 'partial_outage'
    );
    const hasDegraded = data.status.components.some((c) =>
      c.status === 'degraded_performance'
    );

    if (hasOutage) color = '#EF4444';
    else if (hasDegraded) color = '#F59E0B';
  }

  // Check usage levels
  if (data.usage && !data.usage.noSession && !data.usage.noOrg) {
    const limits = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
    for (const key of limits) {
      // API returns utilization as percentage (0-100), not decimal
      if (data.usage[key] && data.usage[key].utilization > 90) {
        color = '#EF4444';
        break;
      } else if (data.usage[key] && data.usage[key].utilization > 80) {
        if (color !== '#EF4444') color = '#F59E0B';
      }
    }
  }

  // Set badge dot
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: color === '#22C55E' ? '' : '!' });
}

// --- Notifications ---

async function checkNotifications(data) {
  if (!data.usage || data.usage.noSession || data.usage.noOrg) return;

  const { notificationSettings } = await chrome.storage.local.get('notificationSettings');
  const settings = notificationSettings || {
    enabled: true,
    thresholds: [80, 95],
  };

  if (!settings.enabled) return;

  const { firedNotifications } = await chrome.storage.local.get('firedNotifications');
  const fired = firedNotifications || {};

  const limits = [
    { key: 'five_hour', label: '5-Hour Limit' },
    { key: 'seven_day', label: '7-Day Limit' },
    { key: 'seven_day_opus', label: '7-Day Opus' },
    { key: 'seven_day_sonnet', label: '7-Day Sonnet' },
  ];

  const newFired = { ...fired };

  for (const limit of limits) {
    const usage = data.usage[limit.key];
    if (!usage) continue;

    // API returns utilization as percentage (0-100), not decimal
    const pct = Math.round(usage.utilization);

    for (const threshold of settings.thresholds) {
      const notifKey = `${limit.key}_${threshold}`;

      if (pct >= threshold && !fired[notifKey]) {
        chrome.notifications.create(notifKey, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: `Claude Monitor - ${limit.label}`,
          message: `Usage reached ${pct}% (threshold: ${threshold}%)`,
          priority: threshold >= 95 ? 2 : 1,
        });
        newFired[notifKey] = true;
      }

      // Reset if usage dropped (after reset)
      if (pct < threshold && fired[notifKey]) {
        delete newFired[notifKey];
      }
    }
  }

  await chrome.storage.local.set({ firedNotifications: newFired });
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return;

  if (msg.action === 'refresh') {
    refreshData().then((data) => sendResponse(data));
    return true; // async response
  }
  if (msg.action === 'updateAlarm') {
    setupAlarm();
    sendResponse({ ok: true });
  }
  if (msg.action === 'changeOrg') {
    if (!UUID_RE.test(msg.orgId)) return;
    chrome.storage.local.set({ selectedOrgId: msg.orgId }).then(() => {
      refreshData().then((data) => sendResponse(data));
    });
    return true;
  }
});
