const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';

function isOsd(url?: string) {
  return typeof url === 'string' && url.startsWith(OSD_ORIGIN);
}

// Chrome opens/closes the panel automatically on icon click when enabled.
// No manual open() call needed — this avoids the async race with setOptions.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

function syncPanel(tabId: number, url?: string) {
  chrome.sidePanel.setOptions({ tabId, enabled: isOsd(url) });
}

// Sync the already-active tab when the service worker starts.
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.id) syncPanel(tab.id, tab.url);
});

// Enable only for OSD tabs; disable (and close) for everything else.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => syncPanel(tabId, tab.url));
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined) syncPanel(tabId, info.url);
});
