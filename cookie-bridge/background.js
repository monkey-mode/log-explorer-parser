chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'WRITE_LOGS') return;

  chrome.scripting.executeScript({
    target: { tabId: msg.tabId },
    func: (data) => localStorage.setItem('ext_logs', data),
    args: [msg.payload],
  })
    .then(() => {
      chrome.tabs.update(msg.tabId, { active: true });
      chrome.windows.update(msg.windowId, { focused: true });
      sendResponse({ ok: true });
    })
    .catch((e) => sendResponse({ ok: false, error: e.message }));

  return true; // keep channel open for async response
});
