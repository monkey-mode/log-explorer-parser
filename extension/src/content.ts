// Proxy OpenSearch API requests through the page's authenticated session.
// The content script runs on the OpenSearch Dashboards page so fetch()
// here uses the browser's existing cookies — no separate login needed.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'OS_SEARCH' && msg.type !== 'OS_COUNT') return false;

  const { indexPattern, body } = msg as { indexPattern: string; body: object };
  const path = msg.type === 'OS_COUNT'
    ? `/${indexPattern}/_count`
    : `/${indexPattern}/_search`;

  fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'osd-xsrf': 'true',  // required by OpenSearch Dashboards
      'kbn-xsrf': 'true',  // backward compat
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
    .then((r) => {
      if (!r.ok) return r.text().then((t) => { throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); });
      return r.json();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));

  return true; // keep response channel open for async sendResponse
});
