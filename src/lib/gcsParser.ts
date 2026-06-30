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

export interface ParseResult {
  entries: LogEntry[];
  total: number;      // total non-empty lines seen in the input
  matched: number;    // lines passing `match` (== total when no matcher)
  truncated: boolean; // true when more matched than were retained
}

export interface ParseOptions {
  limit?: number;                          // max entries to retain (default unlimited)
  startId?: number;                        // starting id for retained entries
  match?: (entry: LogEntry) => boolean;    // keep only entries passing this predicate
}

/**
 * Parse newline-delimited JSON without allocating a full lines array, retaining
 * at most `limit` entries that pass `match` (the rest are only counted). This
 * bounds memory on huge files: when no matcher is set and we've hit the limit,
 * remaining lines are just counted (not parsed). With a matcher we must parse
 * every line to test it, but still retain only matches up to `limit`.
 */
export function parseGcsNdjson(text: string, opts: ParseOptions = {}): ParseResult {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const match = opts.match;
  let id = opts.startId ?? 0;
  const entries: LogEntry[] = [];
  let total = 0;
  let matched = 0;
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;
    // trim whitespace within [pos, nl) without allocating
    let start = pos, end = nl;
    while (start < end && text.charCodeAt(start) <= 32) start++;
    while (end > start && text.charCodeAt(end - 1) <= 32) end--;
    if (end > start) {
      total++;
      // Fast path: no matcher and already full → just count, skip parsing.
      if (match || entries.length < limit) {
        const line = text.slice(start, end);
        let entry: LogEntry;
        try {
          entry = parseGcsEntry(JSON.parse(line) as GcsLogEntry, id++);
        } catch {
          entry = parseGcsEntry({ textPayload: line, severity: 'DEBUG' }, id++);
        }
        if (!match || match(entry)) {
          matched++;
          if (entries.length < limit) entries.push(entry);
        }
      }
    }
    pos = nl + 1;
  }

  entries.sort((a, b) => a.payloadTs - b.payloadTs);
  // Without a matcher, every line "matches"; the fast path skips counting them.
  const effMatched = match ? matched : total;
  return { entries, total, matched: effMatched, truncated: effMatched > entries.length };
}
