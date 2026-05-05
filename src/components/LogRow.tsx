'use client';

import { useState, useCallback } from 'react';
import type { LogEntry } from '@/lib/logTypes';
import { JsonViewer } from './JsonViewer';

interface Props {
  log: LogEntry;
  onFilterCorrId: (corrId: string) => void;
}

const SEVERITY_BADGE: Record<string, string> = {
  ERROR: 'bg-red-950 text-red-400 border border-red-800',
  WARN:  'bg-yellow-950 text-yellow-400 border border-yellow-800',
  INFO:  'bg-blue-950 text-blue-400 border border-blue-800',
  DEBUG: 'bg-slate-800 text-slate-400 border border-slate-700',
};

const SEVERITY_LEFT_BORDER: Record<string, string> = {
  ERROR: 'border-l-2 border-l-red-500',
  WARN:  'border-l-2 border-l-yellow-500',
  INFO:  '',
  DEBUG: '',
};

function httpStatusColor(status?: number): string {
  if (!status) return 'text-slate-400';
  if (status >= 500) return 'text-red-400';
  if (status >= 400) return 'text-yellow-400';
  if (status >= 200) return 'text-green-400';
  return 'text-slate-400';
}

function formatTimestamp(ts: string): string {
  // Handles ISO format: "2026-04-11T17:30:51.442015616+07:00"
  const iso = ts.match(/T(\d{2}:\d{2}:\d{2})\.(\d{3})/);
  if (iso) return `${iso[1]}.${iso[2]}`;
  // Fallback for CSV timestamp format
  const m = ts.match(/(\d{2}:\d{2}:\d{2}[\.,]\d+)/);
  return m ? m[1] : ts;
}

function shortCorrId(id: string): string {
  return id ? id.substring(0, 8) + '…' : '';
}

export function LogRow({ log, onFilterCorrId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const toggleExpand = useCallback(() => setExpanded((e) => !e), []);

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const p = log.payload;
  const badge = SEVERITY_BADGE[log.severity] || SEVERITY_BADGE.DEBUG;
  const leftBorder = SEVERITY_LEFT_BORDER[log.severity] || '';

  const summaryMsg = log.message;

  // HTTP info snippet
  let httpSnippet: React.ReactNode = null;
  if (log.httpReq) {
    const { requestMethod: method, requestUrl: url, status, latency } = log.httpReq;
    httpSnippet = (
      <span className={`text-xs shrink-0 font-mono ${httpStatusColor(status)}`}>
        {method} {url} [{status}]{latency ? ` ${latency}` : ''}
      </span>
    );
  } else if (log.callUrl) {
    const urlShort = log.callUrl.replace(/^https?:\/\/[^/]+/, '');
    httpSnippet = (
      <span className={`text-xs shrink-0 font-mono ${httpStatusColor(log.httpSC)}`}>
        → {urlShort}{log.httpSC ? ` [${log.httpSC}]` : ''}
      </span>
    );
  }

  // Key fields to show at top of detail
  const keyFields: { label: string; value: string; color?: string }[] = [];
  if (p['X-Correlation-ID']) keyFields.push({ label: 'Corr-ID', value: p['X-Correlation-ID'], color: 'text-blue-400' });
  if (p['X-Request-ID'])     keyFields.push({ label: 'Req-ID',  value: p['X-Request-ID'] });
  if (p.error)               keyFields.push({ label: 'Error',   value: p.error, color: 'text-red-400' });
  if (p.caller)              keyFields.push({ label: 'Caller',  value: p.caller, color: 'text-slate-400' });
  if (log.httpReq?.requestUrl) {
    keyFields.push({ label: 'URL', value: `${log.httpReq.requestMethod || ''} ${log.httpReq.requestUrl}`, color: 'text-peach-400' });
    if (log.httpReq.status)   keyFields.push({ label: 'Status',  value: String(log.httpReq.status), color: httpStatusColor(log.httpReq.status) });
    if (log.httpReq.latency)  keyFields.push({ label: 'Latency', value: log.httpReq.latency });
  }

  return (
    <div className={`border-b border-slate-800 font-mono text-xs ${expanded ? 'bg-slate-800/30' : ''}`}>
      {/* Summary row */}
      <div
        className={`flex items-baseline gap-2.5 px-4 py-1 cursor-pointer hover:bg-slate-800/50 select-none ${leftBorder}`}
        onClick={toggleExpand}
      >
        <span className="text-slate-600 text-[10px] w-3 shrink-0">
          {expanded ? '▼' : '▶'}
        </span>
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${badge}`}>
          {log.severity}
        </span>
        <span className="text-slate-500 shrink-0 text-[11px]">
          {formatTimestamp(log.payload.timestamp ?? log.ts)}
        </span>
        <span className="text-green-400 shrink-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px]"
          title={log.container}>
          {log.container}
        </span>
        <span
          className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
            log.severity === 'ERROR' ? 'text-red-300' :
            log.severity === 'WARN'  ? 'text-yellow-300' :
            'text-slate-200'
          }`}
          title={summaryMsg}
        >
          {summaryMsg}
        </span>
        {httpSnippet}
        {log.corrId && (
          <span className="text-slate-600 shrink-0 text-[10px]" title={log.corrId}>
            {shortCorrId(log.corrId)}
          </span>
        )}
      </div>

      {/* Detail panel */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-slate-900/60 border-t border-slate-800">
          {/* Actions */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {log.corrId && (
              <button
                className="px-2.5 py-1 text-[11px] rounded border border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-500 hover:text-blue-400 transition-colors"
                onClick={() => onFilterCorrId(log.corrId)}
              >
                🔍 Filter by Corr-ID
              </button>
            )}
            {log.corrId && (
              <button
                className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                  copied === 'corrId'
                    ? 'border-green-500 text-green-400'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-500 hover:text-blue-400'
                }`}
                onClick={() => copy(log.corrId, 'corrId')}
              >
                {copied === 'corrId' ? '✓ Copied!' : '📋 Copy Corr-ID'}
              </button>
            )}
            <button
              className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                copied === 'json'
                  ? 'border-green-500 text-green-400'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-500 hover:text-blue-400'
              }`}
              onClick={() => copy(JSON.stringify(log.payload, null, 2), 'json')}
            >
              {copied === 'json' ? '✓ Copied!' : '📋 Copy JSON'}
            </button>
          </div>

          {/* Key fields chips */}
          {keyFields.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-3">
              {keyFields.map((kf, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 rounded text-[11px]">
                  <span className="text-slate-500">{kf.label}:</span>
                  <span className={`font-medium break-all ${kf.color || 'text-slate-200'}`}>{kf.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* JSON viewer */}
          <div className="bg-slate-950 border border-slate-700 rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700 text-[11px] text-slate-400">
              <span>json_payload</span>
              <span className="text-slate-600">{log.ts} · {log.container}</span>
            </div>
            <div className="p-3 overflow-auto max-h-[420px] text-[12px] leading-relaxed">
              <JsonViewer value={log.payload as never} depth={0} />
            </div>
          </div>

          {/* Stacktrace */}
          {p.stacktrace && (
            <div className="mt-3 bg-slate-950 border border-red-900/40 rounded-md overflow-hidden">
              <div className="px-3 py-1.5 bg-red-950/30 border-b border-red-900/40 text-[11px] text-red-400 font-semibold">
                Stack Trace
              </div>
              <pre className="p-3 text-[11px] text-slate-400 overflow-x-auto leading-relaxed whitespace-pre">
                {p.stacktrace}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
