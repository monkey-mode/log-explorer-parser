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
    const timeFrom  = timeMatch?.[1]?.trim() ?? 'now-1h';
    const timeTo    = timeMatch?.[2]?.trim() ?? 'now';

    // Index pattern UUID from _a: metadata:(indexPattern:uuid,view:...)
    const idMatch       = hash.match(/indexPattern:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    const indexPatternId = idMatch?.[1] ?? null;

    // Container names from _q: params:!(name1,name2,...)
    // rison encodes array as !(...) — extract what's between !( and )
    const paramsMatch = hash.match(/params:!\(([^)]+)\)/);
    const containers  = paramsMatch
      ? paramsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
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

// ── Main ──────────────────────────────────────────────────────────────────

let currentTab   = null;
let parsedParams = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (!tab?.url) return;

  try { fromUrlEl.textContent = new URL(tab.url).origin; } catch { fromUrlEl.textContent = tab.url; }

  const origin = new URL(tab.url).origin;
  parsedParams = parseOSDHash(tab.url);
  renderInfo(parsedParams, null); // show immediately without index name

  // Resolve index pattern name in background — direct fetch with session cookies
  const indexPattern = await resolveIndexPattern(origin, parsedParams.indexPatternId);
  parsedParams.indexPattern = indexPattern;
  renderInfo(parsedParams, indexPattern);
}

function renderInfo(p, indexPattern) {
  if (!p.indexPatternId && p.containers.length === 0) {
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

init();

// ── Send ──────────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', async () => {
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  setStatus('');

  try {
    if (!currentTab?.url) throw new Error('No active tab URL.');

    const cookies = await chrome.cookies.getAll({ url: currentTab.url });
    if (cookies.length === 0) throw new Error('No cookies found for this tab.');

    const cookieStr  = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const origin     = new URL(currentTab.url).origin;
    const webBase    = webUrlEl.value.replace(/\/$/, '');

    const payload = {
      cookie:       cookieStr,
      baseUrl:      origin,
      indexPattern: parsedParams?.indexPattern ?? null,
      indexPatternId: parsedParams?.indexPatternId ?? null,
      timeFrom:     parsedParams?.timeFrom ?? 'now-1h',
      timeTo:       parsedParams?.timeTo ?? 'now',
      containers:   parsedParams?.containers ?? [],
    };

    const res = await fetch(`${webBase}/api/ext-cookie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Web app error: ${(await res.text()).slice(0, 100)}`);

    sendBtn.textContent = '✓ Sent';
    sendBtn.className = 'btn ok';
    const cnt = parsedParams?.containers?.length ?? 0;
    setStatus(`${cookies.length} cookies · ${cnt} service filter${cnt !== 1 ? 's' : ''}`, 'ok');

    // Open / focus the web app tab
    const existing = await chrome.tabs.query({ url: `${webBase}/*` });
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: webBase });
    }

  } catch (e) {
    sendBtn.textContent = 'Send to Log Explorer';
    sendBtn.className = 'btn';
    sendBtn.disabled = false;
    setStatus(e.message, 'err');
  }
});
