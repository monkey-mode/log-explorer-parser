// Ports src/lib/osParser.ts to a classic script. Exposes window.OSParser.
(function () {
  'use strict';

  function normSeverity(s) {
    if (!s) return 'INFO';
    const u = String(s).toUpperCase();
    if (u === 'ERROR' || u === 'CRITICAL' || u === 'FATAL') return 'ERROR';
    if (u === 'WARNING' || u === 'WARN') return 'WARN';
    if (u === 'DEBUG') return 'DEBUG';
    return 'INFO';
  }

  // Each hit's _source carries either json_payload (object or string) or
  // text_payload as a fallback.
  function parseHit(hit, id) {
    const src = (hit && hit._source) || {};
    const ts = src['@timestamp'] || '';
    const container = (src.kubernetes && src.kubernetes.container_name) || '';

    let payload = {};
    const jp = src.json_payload;

    if (jp && typeof jp === 'object') {
      payload = jp;
    } else if (typeof jp === 'string' && jp.trim() !== '-' && jp.trim() !== '') {
      try {
        payload = JSON.parse(jp);
      } catch (_) {
        payload = { message: jp, severity: 'INFO' };
      }
    } else if (typeof src.text_payload === 'string' && src.text_payload.trim() !== '-' && src.text_payload.trim() !== '') {
      payload = { message: src.text_payload.trim(), severity: 'INFO', _source: 'text_payload' };
    } else {
      payload = { message: '(empty)', severity: 'INFO' };
    }

    let corrId = payload['X-Correlation-ID'] || payload['x-correlation-id'] || '';
    if (!corrId && typeof payload.value === 'string') {
      try {
        const val = JSON.parse(payload.value);
        if (typeof val.correlationId === 'string') corrId = val.correlationId;
      } catch (_) {
        /* not JSON */
      }
    }

    const requestId = payload['X-Request-ID'] || payload['x-request-id'] || '';
    const severity = normSeverity(payload.severity);
    const payloadTs = payload.timestamp ? Date.parse(payload.timestamp) : Date.parse(ts) || 0;

    return {
      id,
      ts,
      payloadTs,
      container,
      payload,
      severity,
      message: payload.message || payload.error || '(no message)',
      corrId,
      requestId,
      error: payload.error || '',
      httpReq: payload.httpRequest,
      callUrl: payload.call_to_url || payload.call_to_api || undefined,
      httpSC: payload.http_status_code,
    };
  }

  function extractHits(data) {
    if (!data) return null;
    const candidates = [
      data.rawResponse && data.rawResponse.hits && data.rawResponse.hits.hits,
      data.body && data.body.hits && data.body.hits.hits,
      data.hits && data.hits.hits,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return null;
  }

  function parseResponse(data) {
    const hits = extractHits(data);
    if (!Array.isArray(hits) || hits.length === 0) return [];
    return hits.map(parseHit).sort((a, b) => a.payloadTs - b.payloadTs);
  }

  function isResponse(data) {
    return Array.isArray(extractHits(data));
  }

  window.OSParser = { parseResponse, isResponse };
})();
