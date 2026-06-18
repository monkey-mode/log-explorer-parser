'use strict';

const OSD_HOST = 'logging-nonprd.gcp.ktbapp.tech';
const SEV_BUTTONS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

const state = {
  allLogs: [],
  filters: { search: '', severity: 'ALL', services: [], corrId: '' },
  expanded: new Set(),
  myTabId: null,
};

const el = {
  conn: document.getElementById('conn'),
  stats: document.getElementById('stats'),
  search: document.getElementById('search'),
  sevButtons: document.getElementById('sev-buttons'),
  servicePicker: document.getElementById('service-picker'),
  corrChip: document.getElementById('corr-chip'),
  countBar: document.getElementById('count-bar'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  emptyMsg: document.getElementById('empty-msg'),
};

// ── helpers ────────────────────────────────────────────────────────────────
function isOsdUrl(url) {
  try { return new URL(url).host === OSD_HOST; } catch (_) { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const iso = ts.match(/T(\d{2}:\d{2}:\d{2})\.(\d{3})/);
  if (iso) return `${iso[1]}.${iso[2]}`;
  const m = ts.match(/(\d{2}:\d{2}:\d{2}[.,]\d+)/);
  return m ? m[1] : ts;
}

function shortCorrId(id) { return id ? id.substring(0, 8) + '…' : ''; }

function httpStatusColor(status) {
  if (!status) return '';
  if (status >= 500) return 'red';
  if (status >= 400) return 'yellow';
  if (status >= 200) return 'green';
  return '';
}

// ── data binding (per-tab) ──────────────────────────────────────────────────
function applyData(data) {
  const logs = window.OSParser.parseResponse(data);
  if (!logs.length) return;
  state.allLogs = logs;
  // New response = new ids, so existing expansions no longer map; reset them.
  // Filters are intentionally preserved across live refreshes.
  state.expanded = new Set();
  el.conn.className = 'dot dot-live';
  el.conn.title = 'Receiving OSD search results';
  renderServicePicker();
  render();
}

async function loadForTab() {
  if (state.myTabId == null) return;
  const key = 'tab_' + state.myTabId;
  const obj = await chrome.storage.session.get(key);
  if (obj[key] && obj[key].data) applyData(obj[key].data);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) state.myTabId = tab.id;
  await loadForTab();
  renderSevButtons();
  renderControls();
  render();
}

chrome.storage.session.onChanged.addListener((changes) => {
  const key = 'tab_' + state.myTabId;
  if (changes[key] && changes[key].newValue) applyData(changes[key].newValue.data);
});

// Follow the active OSD tab so the panel always reflects the page in view.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isOsdUrl(tab.url)) {
      state.myTabId = tabId;
      state.allLogs = [];
      el.conn.className = 'dot dot-wait';
      await loadForTab();
      render();
    }
  } catch (_) { /* tab gone */ }
});

// ── filtering ───────────────────────────────────────────────────────────────
function filteredLogs() {
  const f = state.filters;
  const q = f.search.toLowerCase().trim();
  return state.allLogs.filter((log) => {
    if (f.severity !== 'ALL' && log.severity !== f.severity) return false;
    if (f.services.length > 0 && !f.services.includes(log.container)) return false;
    if (f.corrId && log.corrId !== f.corrId) return false;
    if (q) {
      const hay = [
        log.message, log.error, log.container, log.corrId,
        log.callUrl || '', (log.httpReq && log.httpReq.requestUrl) || '',
        (log.httpReq && log.httpReq.requestMethod) || '', log.payload.caller || '',
        String(log.httpSC || ''), String((log.httpReq && log.httpReq.status) || ''),
        JSON.stringify(log.payload),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function services() {
  return [...new Set(state.allLogs.map((l) => l.container).filter(Boolean))].sort();
}

// ── JSON tree ───────────────────────────────────────────────────────────────
function buildJson(value, depth) {
  if (value === null) return leaf('jv-null', 'null', 'null');
  const t = typeof value;
  if (t === 'boolean') return leaf('jv-bool', String(value), String(value));
  if (t === 'number') return leaf('jv-num', String(value), String(value));

  if (t === 'string') {
    const trimmed = value.trim();
    if (depth < 4 && trimmed.length > 2 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try {
        const nested = JSON.parse(trimmed);
        const wrap = document.createElement('span');
        wrap.appendChild(span('jv-nested-tag', '[nested JSON]'));
        wrap.appendChild(buildJson(nested, depth));
        return wrap;
      } catch (_) { /* not JSON */ }
    }
    return leaf('jv-str', '"' + value + '"', value);
  }

  const isArr = Array.isArray(value);
  const keys = isArr ? null : Object.keys(value);
  const len = isArr ? value.length : keys.length;
  if (len === 0) return span('jv-punc', isArr ? '[]' : '{}');

  const wrap = document.createElement('span');
  let collapsed = depth >= 2;

  const toggle = document.createElement('span');
  toggle.className = 'jv-toggle';
  const children = document.createElement('span');
  const closer = span('jv-punc', isArr ? ']' : '}');

  function paint() {
    toggle.textContent = '';
    if (collapsed) {
      toggle.appendChild(span('jv-collapsed', isArr ? `[${len} items…]` : `{${len} keys…}`));
      children.style.display = 'none';
      closer.style.display = 'none';
    } else {
      toggle.textContent = isArr ? '[' : '{';
      children.style.display = '';
      closer.style.display = '';
    }
  }
  toggle.addEventListener('click', (e) => { e.stopPropagation(); collapsed = !collapsed; paint(); });

  const kids = document.createElement('div');
  kids.className = 'jv-children';
  const entries = isArr ? value.map((v, i) => [i, v]) : keys.map((k) => [k, value[k]]);
  entries.forEach(([k, v], i) => {
    const line = document.createElement('div');
    line.className = 'jv-line';
    if (!isArr) {
      line.appendChild(span('jv-key', '"' + k + '"'));
      line.appendChild(span('jv-punc', ': '));
    }
    line.appendChild(buildJson(v, depth + 1));
    if (i < entries.length - 1) line.appendChild(span('jv-punc', ','));
    kids.appendChild(line);
  });
  children.appendChild(kids);

  wrap.appendChild(toggle);
  wrap.appendChild(children);
  wrap.appendChild(closer);
  paint();
  return wrap;
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

// A clickable JSON leaf that copies its raw value to the clipboard.
function leaf(cls, display, raw) {
  const s = span(cls + ' jv-leaf', display);
  s.title = 'Click to copy';
  s.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(raw).then(() => {
      s.classList.add('jv-copied');
      setTimeout(() => s.classList.remove('jv-copied'), 800);
    });
  });
  return s;
}

// ── stack trace ─────────────────────────────────────────────────────────────
// Flattened Go stack: "<func> <file>:<line> <func> <file>:<line> …".
// Functions and paths contain no spaces, so tokens pair up func -> location.
function parseStack(raw) {
  const tokens = String(raw).trim().split(/\s+/);
  const frames = [];
  let fnParts = [];
  for (const tok of tokens) {
    const m = tok.match(/^(.*):(\d+)$/);
    if (m && (tok.indexOf('/') !== -1 || tok.indexOf('.go') !== -1)) {
      frames.push({ fn: fnParts.join(' '), file: m[1], line: m[2] });
      fnParts = [];
    } else {
      fnParts.push(tok);
    }
  }
  if (fnParts.length) frames.push({ fn: fnParts.join(' '), file: '', line: '' });
  return frames;
}

function decodePkg(s) {
  return s.replace(/%2e/gi, '.').replace(/%2f/gi, '/');
}

function buildStack(raw) {
  const box = document.createElement('div');
  box.className = 'stack-box';
  const head = document.createElement('div');
  head.className = 'stack-head';

  const frames = parseStack(raw);
  if (frames.length <= 1) {
    // Couldn't split into frames — fall back to the raw text.
    head.textContent = 'Stack Trace';
    box.appendChild(head);
    const body = document.createElement('div');
    body.className = 'stack-body';
    body.textContent = raw;
    box.appendChild(body);
    return box;
  }

  head.textContent = `Stack Trace · ${frames.length} frames`;
  box.appendChild(head);

  const list = document.createElement('div');
  list.className = 'stack-frames';
  frames.forEach((f, i) => {
    const frame = document.createElement('div');
    frame.className = 'stack-frame';
    const idx = span('sf-idx', String(i));
    const fn = span('sf-fn', decodePkg(f.fn));
    frame.appendChild(idx);
    frame.appendChild(fn);
    if (f.file) {
      const loc = span('sf-loc', decodePkg(f.file) + ':' + f.line);
      loc.title = 'Click to copy';
      loc.addEventListener('click', () => {
        navigator.clipboard.writeText(decodePkg(f.file) + ':' + f.line).then(() => {
          loc.classList.add('jv-copied');
          setTimeout(() => loc.classList.remove('jv-copied'), 800);
        });
      });
      frame.appendChild(loc);
    }
    list.appendChild(frame);
  });
  box.appendChild(list);
  return box;
}

// ── rendering ───────────────────────────────────────────────────────────────
function renderSevButtons() {
  el.sevButtons.innerHTML = '';
  SEV_BUTTONS.forEach((sev) => {
    const b = document.createElement('button');
    b.className = 'sev-btn ' + sev + (state.filters.severity === sev ? ' active' : '');
    b.textContent = sev;
    b.addEventListener('click', () => {
      state.filters.severity = sev;
      renderSevButtons();
      render();
    });
    el.sevButtons.appendChild(b);
  });
}

function renderControls() {
  // search
  el.search.value = state.filters.search;
  el.search.oninput = (e) => { state.filters.search = e.target.value; render(); };
  renderServicePicker();
  renderCorrChip();
}

function renderServicePicker() {
  const svcs = services();
  const sel = state.filters.services;
  el.servicePicker.innerHTML = '';
  if (svcs.length === 0) return;

  const label = sel.length === 0 ? 'All Services'
    : sel.length === 1 ? sel[0]
    : `${sel.length} Services`;

  const toggle = document.createElement('button');
  toggle.className = 'sp-toggle' + (sel.length ? ' active' : '');
  toggle.innerHTML = `<span class="label">${escapeHtml(label)}</span><span>▾</span>`;
  el.servicePicker.appendChild(toggle);

  let open = false;
  let menu = null;
  function close() { if (menu) { menu.remove(); menu = null; } open = false; }
  function build() {
    menu = document.createElement('div');
    menu.className = 'sp-menu';
    const actions = document.createElement('div');
    actions.className = 'sp-actions';
    const all = document.createElement('button'); all.textContent = 'Select all';
    const clr = document.createElement('button'); clr.textContent = 'Clear';
    all.onclick = () => { state.filters.services = [...svcs]; renderServicePicker(); render(); };
    clr.onclick = () => { state.filters.services = []; renderServicePicker(); render(); };
    actions.append(all, clr);
    menu.appendChild(actions);
    svcs.forEach((svc) => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sel.includes(svc);
      cb.onchange = () => {
        state.filters.services = cb.checked ? [...state.filters.services, svc]
          : state.filters.services.filter((s) => s !== svc);
        render();
      };
      const txt = document.createElement('span');
      txt.textContent = svc;
      lab.append(cb, txt);
      menu.appendChild(lab);
    });
    el.servicePicker.appendChild(menu);
  }
  toggle.onclick = (e) => {
    e.stopPropagation();
    if (open) { close(); } else { build(); open = true; }
  };
  document.addEventListener('mousedown', (e) => {
    if (open && !el.servicePicker.contains(e.target)) close();
  });
}

function renderCorrChip() {
  const c = state.filters.corrId;
  if (!c) { el.corrChip.className = 'corr-chip hidden'; el.corrChip.innerHTML = ''; return; }
  el.corrChip.className = 'corr-chip';
  el.corrChip.innerHTML =
    `<span>corr-id:</span><span class="mono">${escapeHtml(c.substring(0, 16))}…</span><span class="x" title="Clear (Esc)">×</span>`;
  el.corrChip.querySelector('.x').onclick = () => { state.filters.corrId = ''; renderCorrChip(); render(); };
}

function renderStats() {
  if (!state.allLogs.length) { el.stats.innerHTML = ''; return; }
  const errors = state.allLogs.filter((l) => l.severity === 'ERROR').length;
  const warns = state.allLogs.filter((l) => l.severity === 'WARN').length;
  let html = `<span>${state.allLogs.length.toLocaleString()} entries</span>`;
  if (errors) html += `<span class="err">${errors} errors</span>`;
  if (warns) html += `<span class="warn">${warns} warnings</span>`;
  el.stats.innerHTML = html;
}

function copy(text, btn, label) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1500);
  });
}

function buildRow(log) {
  const row = document.createElement('div');
  row.className = 'row sev-' + log.severity + (state.expanded.has(log.id) ? ' expanded' : '');

  // summary
  const summary = document.createElement('div');
  summary.className = 'row-summary';

  let httpSnippet = '';
  if (log.httpReq) {
    const h = log.httpReq;
    httpSnippet = `<span class="r-corr ${httpStatusColor(h.status)}">${escapeHtml(h.requestMethod || '')} ${escapeHtml(h.requestUrl || '')} [${escapeHtml(String(h.status || ''))}]</span>`;
  } else if (log.callUrl) {
    const short = log.callUrl.replace(/^https?:\/\/[^/]+/, '');
    httpSnippet = `<span class="r-corr ${httpStatusColor(log.httpSC)}">→ ${escapeHtml(short)}${log.httpSC ? ` [${log.httpSC}]` : ''}</span>`;
  }

  summary.innerHTML =
    `<span class="caret">${state.expanded.has(log.id) ? '▼' : '▶'}</span>` +
    `<span class="badge ${log.severity}">${log.severity}</span>` +
    `<span class="r-time">${escapeHtml(formatTimestamp(log.payload.timestamp || log.ts))}</span>` +
    `<span class="r-container" title="${escapeHtml(log.container)}">${escapeHtml(log.container)}</span>` +
    `<span class="r-msg" title="${escapeHtml(log.message)}">${escapeHtml(log.message)}</span>` +
    httpSnippet +
    (log.corrId ? `<span class="r-corr" title="${escapeHtml(log.corrId)}">${escapeHtml(shortCorrId(log.corrId))}</span>` : '');

  summary.addEventListener('click', () => {
    if (state.expanded.has(log.id)) state.expanded.delete(log.id);
    else state.expanded.add(log.id);
    render();
  });
  row.appendChild(summary);

  // detail
  if (state.expanded.has(log.id)) {
    row.appendChild(buildDetail(log));
  }
  return row;
}

function buildDetail(log) {
  const p = log.payload;
  const detail = document.createElement('div');
  detail.className = 'detail';

  // actions
  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  if (log.corrId) {
    const filterBtn = document.createElement('button');
    filterBtn.className = 'btn';
    filterBtn.textContent = '🔍 Filter by Corr-ID';
    filterBtn.onclick = () => { state.filters.corrId = log.corrId; renderCorrChip(); render(); };
    actions.appendChild(filterBtn);

    const copyCorr = document.createElement('button');
    copyCorr.className = 'btn';
    copyCorr.textContent = '📋 Copy Corr-ID';
    copyCorr.onclick = () => copy(log.corrId, copyCorr);
    actions.appendChild(copyCorr);
  }
  const copyJson = document.createElement('button');
  copyJson.className = 'btn';
  copyJson.textContent = '📋 Copy JSON';
  copyJson.onclick = () => copy(JSON.stringify(p, null, 2), copyJson);
  actions.appendChild(copyJson);
  detail.appendChild(actions);

  // key fields
  const kf = [];
  if (log.container) kf.push(['Container', log.container, 'green']);
  if (p['X-Correlation-ID']) kf.push(['Corr-ID', p['X-Correlation-ID'], 'blue']);
  if (p['X-Request-ID']) kf.push(['Req-ID', p['X-Request-ID'], '']);
  if (p.error) kf.push(['Error', p.error, 'red']);
  if (p.caller) kf.push(['Caller', p.caller, '']);
  if (log.httpReq && log.httpReq.requestUrl) {
    kf.push(['URL', `${log.httpReq.requestMethod || ''} ${log.httpReq.requestUrl}`, '']);
    if (log.httpReq.status) kf.push(['Status', String(log.httpReq.status), '']);
    if (log.httpReq.latency) kf.push(['Latency', log.httpReq.latency, '']);
  }
  if (kf.length) {
    const box = document.createElement('div');
    box.className = 'key-fields';
    kf.forEach(([k, v, color]) => {
      const chip = document.createElement('div');
      chip.className = 'kf';
      chip.innerHTML = `<span class="k">${escapeHtml(k)}:</span><span class="v ${color}">${escapeHtml(v)}</span>`;
      box.appendChild(chip);
    });
    detail.appendChild(box);
  }

  // json viewer
  const jbox = document.createElement('div');
  jbox.className = 'json-box';
  const jhead = document.createElement('div');
  jhead.className = 'json-head';
  jhead.innerHTML = `<span>${p._source === 'text_payload' ? 'text_payload' : 'json_payload'}</span><span>${escapeHtml(log.ts)} · ${escapeHtml(log.container)}</span>`;
  jbox.appendChild(jhead);
  const jbody = document.createElement('div');
  jbody.className = 'json-body jv';
  jbody.appendChild(buildJson(p, 0));
  jbox.appendChild(jbody);
  detail.appendChild(jbox);

  // stacktrace
  if (p.stacktrace) {
    detail.appendChild(buildStack(p.stacktrace));
  }
  return detail;
}

function render() {
  renderStats();
  renderCorrChip();

  const total = state.allLogs.length;
  const filtered = filteredLogs();

  el.countBar.textContent = total > 0
    ? `Showing ${filtered.length.toLocaleString()} of ${total.toLocaleString()} entries`
    : 'No data loaded';

  if (total === 0) {
    el.empty.classList.remove('hidden');
    el.emptyMsg.textContent = state.myTabId == null
      ? 'Open this panel from an OpenSearch Dashboards tab.'
      : 'Run a search in OpenSearch Dashboards — logs appear here automatically.';
    // remove any rendered rows
    [...el.list.querySelectorAll('.row, .no-match')].forEach((n) => n.remove());
    return;
  }
  el.empty.classList.add('hidden');
  [...el.list.querySelectorAll('.row, .no-match')].forEach((n) => n.remove());

  if (filtered.length === 0) {
    const nm = document.createElement('div');
    nm.className = 'no-match';
    nm.textContent = 'No logs match the current filters.';
    el.list.appendChild(nm);
    return;
  }
  const frag = document.createDocumentFragment();
  filtered.forEach((log) => frag.appendChild(buildRow(log)));
  el.list.appendChild(frag);
}

// ── keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { state.filters.corrId = ''; renderCorrChip(); render(); return; }
  if (e.key === '/' && document.activeElement !== el.search) {
    e.preventDefault();
    el.search.focus();
  }
});

init();
