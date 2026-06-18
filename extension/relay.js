// Runs in the ISOLATED world. Bridges page postMessage -> extension runtime.
(function () {
  'use strict';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__osdLogExt !== true) return;
    try {
      chrome.runtime.sendMessage({ type: 'OS_DATA', data: msg.data }).catch(() => {});
    } catch (_) {
      /* extension context invalidated (reload) */
    }
  });
})();
