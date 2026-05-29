const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';

// Disable globally by default so no tab gets the panel unless it's the OSD origin.
// This runs every time the service worker starts, covering reloads and restarts.
chrome.sidePanel.setOptions({ enabled: false });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

function updatePanel(tabId: number, url?: string) {
  const enabled = typeof url === 'string' && url.startsWith(OSD_ORIGIN);
  chrome.sidePanel.setOptions({ tabId, enabled });
}

// Check the already-active tab on service worker start
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.id) updatePanel(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined) updatePanel(tabId, info.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => updatePanel(tabId, tab.url));
});
