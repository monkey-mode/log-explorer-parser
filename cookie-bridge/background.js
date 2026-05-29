const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function updatePanel(tabId, url) {
  const enabled = typeof url === 'string' && url.startsWith(OSD_ORIGIN);
  chrome.sidePanel.setOptions({ tabId, enabled });
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined) updatePanel(tabId, info.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => updatePanel(tabId, tab.url));
});
