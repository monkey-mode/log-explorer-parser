const OSD_ORIGIN = 'https://logging-nonprd.gcp.ktbapp.tech';

// action.onClicked fires when there is no popup — open the side panel only
// when the active tab is the OSD origin, ignore the click otherwise.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url?.startsWith(OSD_ORIGIN) || tab.id == null) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
});
