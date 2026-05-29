const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';
const PANEL_PATH  = 'src/sidepanel.html';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function syncPanel(tabId: number, url?: string) {
  if (!url) return;
  if (url.startsWith(OSD_ORIGIN)) {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } else {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  }
}

// Handle the tab that's already active when the service worker starts.
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.id) syncPanel(tab.id, tab.url);
});

// URL changes within the same tab (navigation).
chrome.tabs.onUpdated.addListener((_tabId, _info, tab) => {
  if (tab.id && tab.url) syncPanel(tab.id, tab.url);
});

// Switching between tabs.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => syncPanel(tabId, tab.url));
});
