import type { LogEntry, LogPayload, Severity } from './logTypes';

/** RFC 4180-compatible CSV parser that handles multiline quoted fields. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    // skip bare newlines between rows
    while (i < n && (text[i] === '\r' || text[i] === '\n')) i++;
    if (i >= n) break;

    const row: string[] = [];
    while (i < n) {
      let field = '';
      if (text[i] === '"') {
        i++; // skip opening "
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              field += '"'; i += 2; // "" → "
            } else {
              i++; break; // closing "
            }
          } else {
            field += text[i++];
          }
        }
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i++];
        }
      }
      row.push(field);
      if (i < n && text[i] === ',') {
        i++; // next field
      } else {
        if (i < n && text[i] === '\r') i++;
        if (i < n && text[i] === '\n') i++;
        break; // end of row
      }
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

function normSeverity(s?: string): Severity {
  if (!s) return 'INFO';
  const u = s.toUpperCase();
  if (u === 'ERROR' || u === 'CRITICAL' || u === 'FATAL') return 'ERROR';
  if (u === 'WARNING' || u === 'WARN') return 'WARN';
  if (u === 'DEBUG') return 'DEBUG';
  return 'INFO';
}

export function parseLog(row: string[], id: number): LogEntry {
  const [ts = '', container = '', jsonStr = ''] = row;
  let payload: LogPayload = {};
  try {
    payload = JSON.parse(jsonStr) as LogPayload;
  } catch {
    payload = { message: jsonStr, severity: 'DEBUG' };
  }

  const severity = normSeverity(payload.severity);
  const payloadTs = payload.timestamp ? Date.parse(payload.timestamp) : 0;
  return {
    id,
    ts: ts.trim(),
    payloadTs,
    container: container.trim(),
    payload,
    severity,
    message: payload.message || payload.error || '(no message)',
    corrId: payload['X-Correlation-ID'] || '',
    error: payload.error || '',
    httpReq: payload.httpRequest,
    callUrl: payload.call_to_url || payload.call_to_api || undefined,
    httpSC: payload.http_status_code,
  };
}

export function parseLogs(csvText: string): LogEntry[] {
  const rows = parseCSV(csvText);
  // Skip header row (row[0])
  return rows
    .slice(1)
    .filter((r) => r.length >= 3)
    .map((r, i) => parseLog(r, i));
}
