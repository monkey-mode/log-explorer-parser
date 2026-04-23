// Proxy OpenSearch Dashboards internal search through the page's existing session.
// The content script runs on the Dashboards tab so fetch() uses the browser's cookies.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'OS_SEARCH') return false;

  const { indexPattern, body } = msg as { indexPattern: string; body: object };

  fetch('/internal/search/opensearch-with-long-numerals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'osd-xsrf': 'osd-fetch',
    },
    body: JSON.stringify({ params: { index: indexPattern, body } }),
    credentials: 'same-origin',
  })
    .then((r) => {
      if (!r.ok) return r.text().then((t) => { throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); });
      return r.json();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));

  return true; // keep channel open for async sendResponse
});
