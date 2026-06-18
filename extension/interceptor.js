// Runs in the page's MAIN world at document_start.
// Patches fetch + XHR to capture the OSD search response and post it to the
// ISOLATED-world relay via window.postMessage.
(function () {
  'use strict';

  const TARGET = 'opensearch-with-long-numerals';

  function publish(data) {
    try {
      window.postMessage({ __osdLogExt: true, data }, window.location.origin);
    } catch (_) {
      /* serialization / cross-origin guard */
    }
  }

  function isTarget(url) {
    return typeof url === 'string' && url.indexOf(TARGET) !== -1;
  }

  // ── fetch ──────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isTarget(url)) {
          promise
            .then((res) => {
              res
                .clone()
                .text()
                .then((text) => {
                  try {
                    publish(JSON.parse(text));
                  } catch (_) {
                    /* not JSON */
                  }
                })
                .catch(() => {});
            })
            .catch(() => {});
        }
      } catch (_) {
        /* ignore */
      }
      return promise;
    };
  }

  // ── XMLHttpRequest ─────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__osdLogExtUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (isTarget(this.__osdLogExtUrl)) {
      this.addEventListener('load', function () {
        try {
          publish(JSON.parse(this.responseText));
        } catch (_) {
          /* not JSON */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
