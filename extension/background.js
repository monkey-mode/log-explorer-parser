// Service worker: stores captured OSD data per-tab and scopes the side panel
// so it is only enabled on OSD tabs (never "traverses" other tabs).

const OSD_HOST = 'logging-nonprd.gcp.ktbapp.tech';

function isOsdUrl(url) {
  try {
    return new URL(url).host === OSD_HOST;
  } catch (_) {
    return false;
  }
}

async function syncPanelForTab(tabId, url) {
  try {
    if (isOsdUrl(url)) {
      await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (_) {
    /* tab closed mid-update */
  }
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null) syncPanelForTab(tab.id, tab.url || '');
  }
}

// Open the panel when the toolbar icon is clicked (only effective on tabs
// where the panel is enabled, i.e. OSD tabs).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  syncAllTabs();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  syncAllTabs();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' || info.url) {
    syncPanelForTab(tabId, tab.url || '');
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    syncPanelForTab(tabId, tab.url || '');
  } catch (_) {
    /* tab gone */
  }
});

// Store captured search responses keyed by source tab so the side panel can
// read exactly its own tab's data.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'OS_DATA' && sender.tab && sender.tab.id != null) {
    chrome.storage.session
      .set({ ['tab_' + sender.tab.id]: { data: msg.data, ts: Date.now() } })
      .catch(() => {});
  }
});

// Clean up stored data when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab_' + tabId).catch(() => {});
});
