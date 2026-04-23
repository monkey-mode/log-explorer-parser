export interface OSConfig {
  baseUrl: string;
  indexPattern: string;
  username: string;
  password: string;
  timeRange: string;
  size: number;
}

export const DEFAULT_CONFIG: Partial<OSConfig> = {
  indexPattern: 'logs-*',
  timeRange: 'now-15m',
  size: 500,
  username: '',
  password: '',
};

export const TIME_RANGES = [
  { label: '15 min', value: 'now-15m' },
  { label: '30 min', value: 'now-30m' },
  { label: '1 hour', value: 'now-1h' },
  { label: '3 hours', value: 'now-3h' },
  { label: '12 hours', value: 'now-12h' },
  { label: '24 hours', value: 'now-24h' },
] as const;

function authHeaders(config: OSConfig): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (config.username) {
    headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }
  return headers;
}

/** Fetch log rows from OpenSearch. Returns rows in the same shape as the CSV parser expects. */
export async function queryOpenSearch(config: OSConfig): Promise<string[][]> {
  const base = config.baseUrl.replace(/\/$/, '');
  const url = `${base}/${config.indexPattern}/_search`;

  const body = {
    size: config.size,
    _source: ['@timestamp', 'kubernetes.container_name', 'json_payload', 'text_payload'],
    sort: [{ '@timestamp': { order: 'asc' } }],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte: config.timeRange, lte: 'now' } } },
        ],
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenSearch ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    hits: { total: { value: number }; hits: Array<{ _source: Record<string, string> }> };
  };

  return data.hits.hits.map((hit) => {
    const s = hit._source;
    return [
      s['@timestamp'] ?? '',
      s['kubernetes.container_name'] ?? '',
      s['json_payload'] ?? '',
      s['text_payload'] ?? '',
    ];
  });
}

/** Test connectivity — uses _count which is cheap. */
export async function testConnection(config: OSConfig): Promise<number> {
  const base = config.baseUrl.replace(/\/$/, '');
  const url = `${base}/${config.indexPattern}/_count`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(config) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { count: number };
  return data.count;
}

// ── chrome.storage helpers ──────────────────────────────────────────────────

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
