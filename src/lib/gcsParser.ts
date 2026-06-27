import type { HttpRequest, LogEntry, LogPayload, Severity } from './logTypes';

// Parser for Cloud Logging -> GCS sink exports. Each object is newline-delimited
// JSON, one `LogEntry` per line. This mirrors osParser.ts but for the GCS schema
// (severity lives on the entry, payload comes from jsonPayload/textPayload).

/** A Cloud Logging LogEntry as written to a GCS sink (subset of fields). */
interface GcsLogEntry {
  timestamp?: string;
  receiveTimestamp?: string;
  severity?: string;
  logName?: string;
  jsonPayload?: Record<string, unknown> | null;
  textPayload?: string | null;
  protoPayload?: Record<string, unknown> | null;
  resource?: { type?: string; labels?: Record<string, string> };
  labels?: Record<string, string>;
  httpRequest?: HttpRequest;
  [key: string]: unknown;
}

function normSeverity(s?: string): Severity {
  if (!s) return 'INFO';
  const u = s.toUpperCase();
  if (u === 'ERROR' || u === 'CRITICAL' || u === 'FATAL' || u === 'ALERT' || u === 'EMERGENCY') return 'ERROR';
  if (u === 'WARNING' || u === 'WARN') return 'WARN';
  if (u === 'DEBUG') return 'DEBUG';
  return 'INFO'; // INFO, NOTICE, DEFAULT, unknown
}

/** Format an absolute epoch (ms) as HH:MM:SS.mmm in the browser's local time. */
function formatLocalTime(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Derive a container/service name from the entry's resource labels or logName. */
function deriveContainer(entry: GcsLogEntry): string {
  const labels = entry.resource?.labels ?? {};
  const candidate =
    labels.container_name ||
    labels.pod_name ||
    labels.namespace_name ||
    entry.labels?.['k8s-pod/app'] ||
    '';
  if (candidate) return candidate;
  // logName looks like "projects/<p>/logs/stdout"; use the tail.
  if (entry.logName) {
    const tail = entry.logName.split('/logs/')[1] ?? entry.logName;
    return decodeURIComponent(tail);
  }
  return '';
}

function parseGcsEntry(entry: GcsLogEntry, id: number): LogEntry {
  const ts = entry.timestamp || entry.receiveTimestamp || '';
  const container = deriveContainer(entry);

  let payload: LogPayload = {};
  if (entry.jsonPayload && typeof entry.jsonPayload === 'object') {
    payload = entry.jsonPayload as LogPayload;
  } else if (entry.protoPayload && typeof entry.protoPayload === 'object') {
    payload = entry.protoPayload as LogPayload;
  } else if (typeof entry.textPayload === 'string' && entry.textPayload.trim() !== '') {
    payload = { message: entry.textPayload.trim(), severity: entry.severity, _source: 'text_payload' };
  } else {
    payload = { message: '(empty)', severity: entry.severity };
  }

  // correlation id: header field, lowercase variant, or nested payload.value JSON
  let corrId =
    (payload['X-Correlation-ID'] as string) ||
    (payload['x-correlation-id'] as string) ||
    '';
  if (!corrId && typeof payload.value === 'string') {
    try {
      const val = JSON.parse(payload.value) as Record<string, unknown>;
      if (typeof val.correlationId === 'string') corrId = val.correlationId;
    } catch { /* not JSON */ }
  }

  const requestId = (payload['X-Request-ID'] as string) || (payload['x-request-id'] as string) || '';
  // Severity: prefer the payload's own severity, else the entry-level severity.
  const severity = normSeverity((payload.severity as string | undefined) ?? entry.severity);
  // Prefer the payload's own timestamp, but fall back to the entry timestamp when
  // it is missing OR unparseable — otherwise those rows would sort to epoch 0.
  let payloadTs = payload.timestamp ? Date.parse(payload.timestamp as string) : NaN;
  if (Number.isNaN(payloadTs)) payloadTs = Date.parse(ts);
  const safeTs = Number.isNaN(payloadTs) ? 0 : payloadTs;

  return {
    id,
    ts,
    // Display every row in one consistent timezone (browser local), derived from
    // the same absolute instant used for sorting — so display order never looks
    // shuffled regardless of which fields carry +07:00 vs UTC timestamps.
    tsDisplay: formatLocalTime(safeTs),
    payloadTs: safeTs,
    container,
    payload,
    severity,
    message:
      (payload.message as string) ||
      (payload.error as string) ||
      (typeof entry.textPayload === 'string' ? entry.textPayload : '') ||
      '(no message)',
    corrId,
    requestId,
    error: (payload.error as string) || '',
    httpReq: payload.httpRequest || entry.httpRequest,
    callUrl: (payload.call_to_url as string) || (payload.call_to_api as string) || undefined,
    httpSC: payload.http_status_code as number | undefined,
  };
}

/** Parse a newline-delimited JSON GCS export into sorted LogEntry rows. */
export function parseGcsNdjson(text: string, startId = 0): LogEntry[] {
  const entries: LogEntry[] = [];
  let id = startId;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as GcsLogEntry;
      entries.push(parseGcsEntry(entry, id++));
    } catch {
      // tolerate a stray non-JSON line by surfacing it as a raw debug row
      entries.push(parseGcsEntry({ textPayload: trimmed, severity: 'DEBUG' }, id++));
    }
  }
  return entries.sort((a, b) => a.payloadTs - b.payloadTs);
}
