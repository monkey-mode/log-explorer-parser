const fromUrlEl  = document.getElementById('from-url');
const infoEl     = document.getElementById('info');
const webUrlEl   = document.getElementById('web-url');
const sendBtn    = document.getElementById('send-btn');
const statusEl   = document.getElementById('status');

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

// ── Parse OSD hash params ─────────────────────────────────────────────────
// OSD uses rison in the hash: #?_a=(...)&_g=(...)&_q=(...)

function parseOSDHash(tabUrl) {
  try {
    const hash = decodeURIComponent((tabUrl.split('#')[1] ?? '').replace(/^\?/, ''));

    // Time range from _g: time:(from:now-1w,to:now)
    const timeMatch = hash.match(/time:\(from:([^,)]+),to:([^)&,]+)/);
    const timeFrom  = (timeMatch?.[1]?.trim() ?? 'now-1h').replace(/^'|'$/g, '');
    const timeTo    = (timeMatch?.[2]?.trim() ?? 'now').replace(/^'|'$/g, '');

    // Index pattern UUID from _a: metadata:(indexPattern:uuid,view:...)
    const idMatch       = hash.match(/indexPattern:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    const indexPatternId = idMatch?.[1] ?? null;

    // Container names from _q: params:!(name1,name2,...)
    // rison encodes array as !(...) — extract what's between !( and )
    const paramsMatch = hash.match(/params:!\(([^)]+)\)/);
    const containers  = paramsMatch
      ? paramsMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
      : [];

    return { timeFrom, timeTo, indexPatternId, containers };
  } catch {
    return { timeFrom: 'now-1h', timeTo: 'now', indexPatternId: null, containers: [] };
  }
}

// ── Resolve index pattern ID → title via OSD saved-objects API ────────────
// Called directly from the extension popup with credentials:include so the
// browser automatically sends the stored session cookies for the OSD domain.
// No scripting permission needed.

async function resolveIndexPattern(origin, patternId) {
  if (!patternId) return null;
  try {
    const r = await fetch(`${origin}/api/saved_objects/index-pattern/${patternId}`, {
      credentials: 'include',
      headers: { 'osd-xsrf': 'osd-fetch' },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.attributes?.title ?? null;
  } catch { return null; }
}

// ── Session state ──────────────────────────────────────────────────────────

let currentTab    = null;
let parsedParams  = null;
let osdOrigin     = null; // the OSD origin to fetch from (may differ from active tab)

function renderInfo(p, indexPattern) {
  if (!p || (!p.indexPatternId && p.containers.length === 0)) {
    infoEl.innerHTML = '<span class="dim">No OSD search state found in URL</span>';
    return;
  }
  const index = indexPattern ?? (p.indexPatternId ? `ID: ${p.indexPatternId.slice(0, 8)}…` : '—');
  infoEl.innerHTML = `
    <div class="info-row"><span class="key">index</span><span class="val">${index}</span></div>
    <div class="info-row"><span class="key">time </span><span class="val">${p.timeFrom} → ${p.timeTo}</span></div>
    ${p.containers.length ? `<div class="info-row"><span class="key">svcs </span><span class="val dim">${p.containers.join(', ')}</span></div>` : ''}
  `;
}

async function loadFromTab(tab) {
  const origin = new URL(tab.url).origin;
  const params = parseOSDHash(tab.url);

  if (params.indexPatternId || params.containers.length > 0) {
    // Current tab is an OSD tab with active search state — use it
    osdOrigin = origin;
    parsedParams = params;
    fromUrlEl.textContent = origin;
    renderInfo(params, null);
    const indexPattern = await resolveIndexPattern(origin, params.indexPatternId);
    parsedParams.indexPattern = indexPattern;
    renderInfo(params, indexPattern);
    return true;
  }
  return false;
}

async function loadFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get('lastSession', ({ lastSession }) => {
      if (!lastSession) return resolve(false);
      osdOrigin    = lastSession.origin;
      parsedParams = lastSession.params;
      fromUrlEl.textContent = lastSession.origin;
      renderInfo(parsedParams, parsedParams.indexPattern);
      sendBtn.textContent = 'Refresh logs';
      setStatus('Using last session — open OSD tab to pick up new search state', '');
      resolve(true);
    });
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Load stored web app URL
  chrome.storage.local.get('webBase', ({ webBase }) => {
    if (webBase) webUrlEl.value = webBase;
  });

  if (tab?.url) {
    try {
      const isOsd = await loadFromTab(tab);
      if (!isOsd) await loadFromStorage();
    } catch {
      await loadFromStorage();
    }
  } else {
    await loadFromStorage();
  }
}

init();

// ── Fetch logs directly from OSD (runs in browser → VPN-aware, no proxy) ──

async function fetchLogs(origin, params) {
  const index = params.indexPattern ?? 'logs-*';

  const containerFilter = params.containers.length > 0 ? {
    bool: {
      minimum_should_match: 1,
      should: params.containers.map(c => ({
        match_phrase: { 'kubernetes.container_name': c },
      })),
    },
  } : null;

  const filters = [
    { match_all: {} },
    ...(containerFilter ? [containerFilter] : []),
    { range: { '@timestamp': { gte: params.timeFrom, lte: params.timeTo, format: 'strict_date_optional_time' } } },
  ];

  const body = {
    params: {
      index,
      body: {
        sort: [{ '@timestamp': { order: 'desc', unmapped_type: 'boolean' } }],
        size: 500,
        version: true,
        stored_fields: ['*'],
        script_fields: {},
        docvalue_fields: [{ field: '@timestamp', format: 'date_time' }],
        _source: { excludes: [] },
        query: { bool: { must: [], filter: filters, should: [], must_not: [] } },
      },
    },
  };

  const r = await fetch(`${origin}/internal/search/opensearch-with-long-numerals`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'osd-xsrf': 'osd-fetch' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`OSD ${r.status}: ${text.slice(0, 120)}`);
  }
  const data = await r.json();
  return data.rawResponse?.hits?.hits ?? [];
}

// ── Send ──────────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', async () => {
  sendBtn.disabled = true;
  sendBtn.textContent = 'Fetching…';
  setStatus('Querying OSD…');

  try {
    if (!osdOrigin) throw new Error('No OSD session — open OSD tab first.');

    const origin  = osdOrigin;
    const webBase = webUrlEl.value.replace(/\/$/, '');
    chrome.storage.local.set({ webBase });

    // Fetch logs from OSD in the browser (VPN-accessible, no server proxy needed)
    const hits = await fetchLogs(origin, parsedParams ?? { indexPattern: null, timeFrom: 'now-1h', timeTo: 'now', containers: [] });

    const payload = JSON.stringify({
      baseUrl:        origin,
      indexPattern:   parsedParams?.indexPattern   ?? null,
      indexPatternId: parsedParams?.indexPatternId ?? null,
      timeFrom:       parsedParams?.timeFrom       ?? 'now-1h',
      timeTo:         parsedParams?.timeTo         ?? 'now',
      containers:     parsedParams?.containers     ?? [],
      hits,
      ts: Date.now(),
    });

    // Find or open the web app tab (but don't focus yet — focusing closes this popup)
    const existing = await chrome.tabs.query({ url: `${webBase}/*` });
    let webTab = existing[0] ?? null;

    if (!webTab) {
      webTab = await new Promise((resolve) => {
        chrome.tabs.create({ url: webBase }, (tab) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(tab);
            }
          });
        });
      });
    }

    // Write to localStorage via scripting, then focus (order matters —
    // focusing the tab closes this popup, aborting any pending async calls)
    await chrome.scripting.executeScript({
      target: { tabId: webTab.id },
      func: (data) => localStorage.setItem('ext_logs', data),
      args: [payload],
    });

    await chrome.tabs.update(webTab.id, { active: true });
    if (webTab.windowId) await chrome.windows.update(webTab.windowId, { focused: true });

    // Persist session so future popup opens can refresh without being on OSD tab
    chrome.storage.local.set({ lastSession: { origin, params: parsedParams } });

    sendBtn.textContent = `✓ ${hits.length} logs sent`;
    sendBtn.className = 'btn ok';
    const cnt = parsedParams?.containers?.length ?? 0;
    setStatus(`${hits.length} logs · ${cnt} filter${cnt !== 1 ? 's' : ''}`, 'ok');

  } catch (e) {
    sendBtn.textContent = 'Send to Log Explorer';
    sendBtn.className = 'btn';
    sendBtn.disabled = false;
    setStatus(e.message, 'err');
  }
});
