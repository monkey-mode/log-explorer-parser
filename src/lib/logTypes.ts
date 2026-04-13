export type Severity = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface HttpRequest {
  requestMethod?: string;
  requestUrl?: string;
  status?: number;
  latency?: string;
  remoteIp?: string;
  userAgent?: string;
  cacheHit?: boolean;
  protocol?: string;
}

export interface LogPayload {
  message?: string;
  severity?: string;
  timestamp?: string;
  error?: string;
  caller?: string;
  stacktrace?: string;
  'X-Correlation-ID'?: string;
  'X-Request-ID'?: string;
  'X-TransactionRef-ID'?: string;
  'X-Channel'?: string;
  'X-Channel-ID'?: string;
  httpRequest?: HttpRequest;
  call_to_url?: string;
  call_to_api?: string;
  http_status_code?: number;
  http_status?: string;
  http_response_body?: string;
  response_body?: string;
  request_datetime?: string;
  response_datetime?: string;
  value?: string;        // stream log: JSON string containing correlationId
  _source?: string;      // internal: 'text_payload' when json_payload was "-"
  serviceContext?: { service?: string };
  context?: unknown;
  'logging.googleapis.com/sourceLocation'?: {
    file?: string;
    function?: string;
    line?: string | number;
  };
  [key: string]: unknown;
}

export interface LogEntry {
  id: number;
  ts: string;
  payloadTs: number; // parsed from payload.timestamp, used for sorting
  container: string;
  payload: LogPayload;
  severity: Severity;
  message: string;
  corrId: string;
  error: string;
  httpReq?: HttpRequest;
  callUrl?: string;
  httpSC?: number;
}

export interface FilterState {
  search: string;
  severity: string;
  services: string[];
  corrId: string;
}
