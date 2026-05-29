const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';

function isOsd(url?: string) {
  return typeof url === 'string' && url.startsWith(OSD_ORIGIN);
}

// Open panel on icon click — only when on the OSD tab.
chrome.action.onClicked.addListener((tab) => {
  if (!isOsd(tab.url) || tab.id == null) return;
  chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true });
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
});

// Close the panel when the user switches to a non-OSD tab.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    chrome.sidePanel.setOptions({ tabId, enabled: isOsd(tab.url) });
  });
});

// Also track URL changes within a tab (e.g. navigating away from OSD).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined) {
    chrome.sidePanel.setOptions({ tabId, enabled: isOsd(info.url) });
  }
});
