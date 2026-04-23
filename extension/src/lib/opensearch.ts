import type { LogEntry, LogPayload, Severity } from '@/lib/logTypes';

export interface OSConfig {
  indexPattern: string;
  timeRange: string;
  size: number;
}

export const DEFAULT_CONFIG: Partial<OSConfig> = {
  indexPattern: 'logs-*',
  timeRange: 'now-15m',
  size: 500,
};

export const TIME_RANGES = [
  { label: '15 min', value: 'now-15m' },
  { label: '30 min', value: 'now-30m' },
  { label: '1 hour', value: 'now-1h' },
  { label: '3 hours', value: 'now-3h' },
  { label: '12 hours', value: 'now-12h' },
  { label: '24 hours', value: 'now-24h' },
] as const;

// ── _source shape from OpenSearch hit ─────────────────────────────────────

interface OSSource {
  '@timestamp': string;
  kubernetes?: { container_name?: string };
  json_payload?: LogPayload | string | null;
  text_payload?: string | null;
}

interface OSHit {
  _source: OSSource;
}

// ── Parse a single OpenSearch hit into a LogEntry ─────────────────────────

function normSeverity(s?: string): Severity {
  if (!s) return 'INFO';
  const u = s.toUpperCase();
  if (u === 'ERROR' || u === 'CRITICAL' || u === 'FATAL') return 'ERROR';
  if (u === 'WARNING' || u === 'WARN') return 'WARN';
  if (u === 'DEBUG') return 'DEBUG';
  return 'INFO';
}

function parseOSHit(hit: OSHit, id: number): LogEntry {
  const src = hit._source;
  const ts        = src['@timestamp'] ?? '';
  const container = src.kubernetes?.container_name ?? '';

  // json_payload from OpenSearch is already an object (unlike the CSV export where it is a string)
  let payload: LogPayload = {};
  const jp = src.json_payload;

  if (jp && typeof jp === 'object') {
    payload = jp as LogPayload;
  } else if (typeof jp === 'string' && jp.trim() !== '-' && jp.trim() !== '') {
    try { payload = JSON.parse(jp) as LogPayload; }
    catch { payload = { message: jp, severity: 'INFO' }; }
  } else if (src.text_payload && src.text_payload.trim() !== '-') {
    payload = { message: src.text_payload.trim(), severity: 'INFO', _source: 'text_payload' };
  } else {
    payload = { message: '(empty)', severity: 'INFO' };
  }

  // Stream logs have correlationId inside the JSON-encoded payload.value field
  let corrId = (payload['X-Correlation-ID'] as string) || '';
  if (!corrId && typeof payload.value === 'string') {
    try {
      const val = JSON.parse(payload.value) as Record<string, unknown>;
      if (typeof val.correlationId === 'string') corrId = val.correlationId;
    } catch { /* not JSON */ }
  }

  const severity  = normSeverity(payload.severity as string | undefined);
  // Prefer the precise ISO timestamp inside the payload; fall back to @timestamp
  const payloadTs = payload.timestamp
    ? Date.parse(payload.timestamp as string)
    : Date.parse(ts);

  return {
    id,
    ts,
    payloadTs,
    container,
    payload,
    severity,
    message:  (payload.message  as string) || (payload.error as string) || '(no message)',
    corrId,
    error:    (payload.error    as string) || '',
    httpReq:  payload.httpRequest,
    callUrl:  (payload.call_to_url as string) || (payload.call_to_api as string) || undefined,
    httpSC:   payload.http_status_code as number | undefined,
  };
}

// ── Chrome tab helpers ─────────────────────────────────────────────────────

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) resolve(tabs[0]);
      else reject(new Error('No active tab found.'));
    });
  });
}

/** Send a message to the content script on the given tab and await the response. */
async function proxyMessage(tabId: number, msg: object): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(
          chrome.runtime.lastError.message ??
          'Content script not ready. Make sure you are on the OpenSearch Dashboards tab.'
        ));
      } else {
        resolve(response as { ok: boolean; data?: unknown; error?: string });
      }
    });
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function queryOpenSearch(config: OSConfig): Promise<LogEntry[]> {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('Cannot communicate with the active tab.');

  const body = {
    size: config.size,
    sort: [{ '@timestamp': { order: 'asc' } }],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte: config.timeRange, lte: 'now' } } },
        ],
      },
    },
  };

  const res = await proxyMessage(tab.id, {
    type: 'OS_SEARCH',
    indexPattern: config.indexPattern,
    body,
  });

  if (!res.ok) throw new Error(res.error ?? 'Unknown error from content script.');

  const hits = (res.data as { hits: { hits: OSHit[] } }).hits.hits;
  return hits
    .map((hit, i) => parseOSHit(hit, i))
    .sort((a, b) => a.payloadTs - b.payloadTs);
}

export async function testConnection(config: OSConfig): Promise<number> {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('Cannot communicate with the active tab.');

  const res = await proxyMessage(tab.id, {
    type: 'OS_COUNT',
    indexPattern: config.indexPattern,
    body: {},
  });

  if (!res.ok) throw new Error(res.error ?? 'Connection failed.');
  return (res.data as { count: number }).count;
}

// ── chrome.storage helpers ─────────────────────────────────────────────────

export async function loadConfig(): Promise<Partial<OSConfig>> {
  return new Promise((resolve) => {
    chrome.storage.local.get('osConfig', (result) => {
      resolve((result['osConfig'] as Partial<OSConfig>) ?? {});
    });
  });
}

export async function saveConfig(config: Partial<OSConfig>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ osConfig: config }, resolve);
  });
}
