const $ = (sel) => document.querySelector(sel);

const refreshInterval = $('#refreshInterval');
const notifEnabled = $('#notifEnabled');
const threshold1 = $('#threshold1');
const threshold2 = $('#threshold2');
const thresholdSettings = $('#thresholdSettings');
const orgSelector = $('#orgSelector');
const saveBtn = $('#saveBtn');
const saveStatus = $('#saveStatus');

// --- Load saved settings ---

async function loadSettings() {
  const data = await chrome.storage.local.get([
    'refreshInterval',
    'notificationSettings',
    'selectedOrgId',
    'organizations',
  ]);

  if (data.refreshInterval) {
    refreshInterval.value = data.refreshInterval;
  }

  if (data.notificationSettings) {
    notifEnabled.checked = data.notificationSettings.enabled;
    const thresholds = data.notificationSettings.thresholds || [80, 95];
    threshold1.value = thresholds[0] || 80;
    threshold2.value = thresholds[1] || 95;
  }

  toggleThresholdVisibility();

  // Populate orgs
  if (data.organizations && data.organizations.length > 0) {
    for (const org of data.organizations) {
      const opt = document.createElement('option');
      opt.value = org.uuid;
      opt.textContent = org.name;
      orgSelector.appendChild(opt);
    }

    if (data.selectedOrgId) {
      orgSelector.value = data.selectedOrgId;
    }
  }
}

function toggleThresholdVisibility() {
  thresholdSettings.style.opacity = notifEnabled.checked ? '1' : '0.4';
  thresholdSettings.style.pointerEvents = notifEnabled.checked ? 'auto' : 'none';
}

notifEnabled.addEventListener('change', toggleThresholdVisibility);

// --- Save ---

saveBtn.addEventListener('click', async () => {
  const settings = {
    refreshInterval: parseInt(refreshInterval.value, 10),
    notificationSettings: {
      enabled: notifEnabled.checked,
      thresholds: [
        Math.min(100, Math.max(1, parseInt(threshold1.value, 10) || 80)),
        Math.min(100, Math.max(1, parseInt(threshold2.value, 10) || 95)),
      ],
    },
  };

  const orgId = orgSelector.value;
  if (orgId) {
    settings.selectedOrgId = orgId;
  }

  await chrome.storage.local.set(settings);

  // Tell background to update alarm
  chrome.runtime.sendMessage({ action: 'updateAlarm' });

  if (orgId) {
    chrome.runtime.sendMessage({ action: 'changeOrg', orgId });
  }

  // Show success
  saveStatus.textContent = 'Saved!';
  saveStatus.classList.add('visible');
  setTimeout(() => saveStatus.classList.remove('visible'), 2000);
});

// --- Init ---

loadSettings();
