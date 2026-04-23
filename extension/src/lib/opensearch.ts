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
  // kubernetes is a nested object in the API response
  kubernetes?: { container_name?: string };
  // json_payload comes back as a pre-parsed object from the Dashboards internal API
  json_payload?: Record<string, unknown> | string | null;
  text_payload?: string | null;
  [key: string]: unknown;
}

interface OSHit {
  _source: OSSource;
}

// Shape of the Dashboards internal search response
interface DashboardsSearchResponse {
  rawResponse: {
    hits: {
      total: number | { value: number };
      hits: OSHit[];
    };
  };
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
  const ts = src['@timestamp'] ?? '';
  const container = src.kubernetes?.container_name ?? '';

  // json_payload is a pre-parsed object from the Dashboards internal API.
  // Fall back to text_payload when json_payload is absent or "-".
  let payload: LogPayload = {};
  const jp = src.json_payload;

  if (jp && typeof jp === 'object') {
    payload = jp as LogPayload;
  } else if (typeof jp === 'string' && jp.trim() !== '-' && jp.trim() !== '') {
    try {
      payload = JSON.parse(jp) as LogPayload;
    } catch {
      payload = { message: jp, severity: 'INFO' };
    }
  } else if (src.text_payload && typeof src.text_payload === 'string' && src.text_payload.trim() !== '-') {
    payload = { message: src.text_payload.trim(), severity: 'INFO', _source: 'text_payload' };
  } else {
    payload = { message: '(empty)', severity: 'INFO' };
  }

  // Correlation ID: standard header, lowercase variant (Kong/nginx), or stream log value field
  let corrId = (payload['X-Correlation-ID'] as string)
    || (payload['x-correlation-id'] as string)
    || '';
  if (!corrId && typeof payload.value === 'string') {
    try {
      const val = JSON.parse(payload.value) as Record<string, unknown>;
      if (typeof val.correlationId === 'string') corrId = val.correlationId;
    } catch { /* not JSON */ }
  }

  const severity = normSeverity(payload.severity as string | undefined);
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
    message: (payload.message as string) || (payload.error as string) || '(no message)',
    corrId,
    error:   (payload.error as string) || '',
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

interface FetchResult { ok: boolean; data?: unknown; error?: string }

/**
 * Execute a fetch directly on the active tab using chrome.scripting.executeScript.
 * No content script needed — works immediately without any tab refresh.
 */
async function executeOnTab(tabId: number, indexPattern: string, body: object): Promise<FetchResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (idx: string, reqBody: object): Promise<FetchResult> => {
      try {
        const r = await fetch('/internal/search/opensearch-with-long-numerals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'osd-xsrf': 'osd-fetch' },
          body: JSON.stringify({ params: { index: idx, body: reqBody } }),
          credentials: 'same-origin',
        });
        if (!r.ok) {
          const t = await r.text();
          return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
        }
        return { ok: true, data: await r.json() };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    args: [indexPattern, body],
  });
  return (results[0].result ?? { ok: false, error: 'No result from tab' }) as FetchResult;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function queryOpenSearch(config: OSConfig): Promise<LogEntry[]> {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('Cannot communicate with the active tab.');

  const body = {
    size: config.size,
    version: true,
    stored_fields: ['*'],
    _source: { excludes: [] as string[] },
    sort: [{ '@timestamp': { order: 'asc', unmapped_type: 'boolean' } }],
    query: {
      bool: {
        must: [],
        filter: [
          { match_all: {} },
          { range: { '@timestamp': { gte: config.timeRange, lte: 'now' } } },
        ],
        should: [],
        must_not: [],
      },
    },
  };

  const res = await executeOnTab(tab.id, config.indexPattern, body);
  if (!res.ok) throw new Error(res.error ?? 'Unknown error');

  const { hits } = (res.data as DashboardsSearchResponse).rawResponse.hits;
  return (hits as OSHit[])
    .map((hit, i) => parseOSHit(hit, i))
    .sort((a, b) => a.payloadTs - b.payloadTs);
}

export async function testConnection(config: OSConfig): Promise<number> {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('Cannot communicate with the active tab.');

  const res = await executeOnTab(tab.id, config.indexPattern, { size: 0, query: { match_all: {} } });
  if (!res.ok) throw new Error(res.error ?? 'Connection failed.');

  const total = (res.data as DashboardsSearchResponse).rawResponse.hits.total;
  return typeof total === 'number' ? total : total.value;
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
