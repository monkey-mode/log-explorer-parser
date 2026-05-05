import type { LogEntry, LogPayload, Severity } from './logTypes';

interface OSSource {
  '@timestamp': string;
  kubernetes?: { container_name?: string };
  json_payload?: Record<string, unknown> | string | null;
  text_payload?: string | null;
  [key: string]: unknown;
}

interface OSHit {
  _source: OSSource;
}

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

  let corrId = (payload['X-Correlation-ID'] as string) || (payload['x-correlation-id'] as string) || '';
  if (!corrId && typeof payload.value === 'string') {
    try {
      const val = JSON.parse(payload.value) as Record<string, unknown>;
      if (typeof val.correlationId === 'string') corrId = val.correlationId;
    } catch { /* not JSON */ }
  }

  const requestId = (payload['X-Request-ID'] as string) || (payload['x-request-id'] as string) || '';
  const severity = normSeverity(payload.severity as string | undefined);
  const payloadTs = payload.timestamp ? Date.parse(payload.timestamp as string) : Date.parse(ts);

  return {
    id,
    ts,
    payloadTs,
    container,
    payload,
    severity,
    message: (payload.message as string) || (payload.error as string) || '(no message)',
    corrId,
    requestId,
    error: (payload.error as string) || '',
    httpReq: payload.httpRequest,
    callUrl: (payload.call_to_url as string) || (payload.call_to_api as string) || undefined,
    httpSC: payload.http_status_code as number | undefined,
  };
}

export function parseOSResponse(data: unknown): LogEntry[] {
  const hits = (data as { rawResponse?: { hits?: { hits?: OSHit[] } } })?.rawResponse?.hits?.hits;
  if (!Array.isArray(hits) || hits.length === 0) return [];
  return (hits as OSHit[])
    .map((hit, i) => parseOSHit(hit, i))
    .sort((a, b) => a.payloadTs - b.payloadTs);
}

export function isOSResponse(data: unknown): boolean {
  return Array.isArray(
    (data as { rawResponse?: { hits?: { hits?: unknown } } })?.rawResponse?.hits?.hits
  );
}
