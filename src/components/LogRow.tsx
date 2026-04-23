'use client';

import { useState, useCallback } from 'react';
import type { LogEntry } from '@/lib/logTypes';
import { JsonViewer } from './JsonViewer';

interface Props {
  log: LogEntry;
  onFilterCorrId: (corrId: string) => void;
}

// ── Severity config ────────────────────────────────────────────────────────

const SEV_STYLE: Record<string, {
  border: string; dot: string; row: string; msg: string; label: string;
}> = {
  ERROR: {
    border: 'border-l-red-500',
    dot:    'bg-red-500',
    row:    'hover:bg-red-950/30',
    msg:    'text-red-200',
    label:  'text-red-400',
  },
  WARN: {
    border: 'border-l-yellow-400',
    dot:    'bg-yellow-400',
    row:    'hover:bg-yellow-950/20',
    msg:    'text-yellow-100',
    label:  'text-yellow-400',
  },
  INFO: {
    border: 'border-l-slate-700',
    dot:    'bg-blue-400',
    row:    'hover:bg-slate-800/50',
    msg:    'text-slate-200',
    label:  'text-slate-400',
  },
  DEBUG: {
    border: 'border-l-slate-800',
    dot:    'bg-slate-600',
    row:    'hover:bg-slate-800/40',
    msg:    'text-slate-400',
    label:  'text-slate-500',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function httpStatusColor(s?: number) {
  if (!s) return 'text-slate-400';
  if (s >= 500) return 'text-red-400';
  if (s >= 400) return 'text-yellow-400';
  return 'text-green-400';
}

function formatTs(ts: string): string {
  const iso = ts.match(/T(\d{2}:\d{2}:\d{2})\.(\d{3})/);
  if (iso) return `${iso[1]}.${iso[2]}`;
  const m = ts.match(/(\d{2}:\d{2}:\d{2}[.,]\d+)/);
  return m ? m[1] : ts.slice(0, 12);
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    });
  };
  return (
    <button
      onClick={click}
      className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
        done
          ? 'border-green-600 text-green-400'
          : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      {done ? '✓ copied' : label}
    </button>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function LogRow({ log, onFilterCorrId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded(e => !e), []);

  const sev   = SEV_STYLE[log.severity] ?? SEV_STYLE.DEBUG;
  const ts    = formatTs((log.payload.timestamp as string) ?? log.ts);
  const p     = log.payload;

  // Inline HTTP snippet for the summary line
  let httpChip: { text: string; color: string } | null = null;
  if (log.httpReq) {
    const { requestMethod: m, requestUrl: u, status: s } = log.httpReq;
    const short = (u || '').replace(/^https?:\/\/[^/]+/, '');
    httpChip = { text: `${m || ''} ${short} [${s}]`.trim(), color: httpStatusColor(s) };
  } else if (log.callUrl) {
    const short = log.callUrl.replace(/^https?:\/\/[^/]+/, '');
    httpChip = { text: `→ ${short}${log.httpSC ? ` [${log.httpSC}]` : ''}`, color: httpStatusColor(log.httpSC) };
  }

  return (
    <div className={`border-b border-slate-800/60 border-l-2 ${sev.border} font-mono text-xs`}>

      {/* ── Summary row — single line ── */}
      <div
        onClick={toggle}
        className={`flex items-center gap-2 px-2 h-7 cursor-pointer select-none ${expanded ? 'bg-slate-800/30' : ''} ${sev.row} transition-colors`}
      >
        {/* Expand chevron */}
        <svg
          className={`w-2.5 h-2.5 shrink-0 text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 6 10" fill="currentColor"
        >
          <path d="M1 1l4 4-4 4"/>
        </svg>

        {/* Severity dot */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev.dot}`} />

        {/* Timestamp */}
        <span className="text-slate-500 shrink-0 w-[78px] text-[11px]">{ts}</span>

        {/* Service badge */}
        <span
          className="shrink-0 px-1.5 py-px rounded text-[10px] bg-slate-800 text-cyan-400 max-w-[144px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={log.container}
        >
          {log.container}
        </span>

        {/* Message — takes all remaining space, never wraps */}
        <span className={`flex-1 min-w-0 truncate ${sev.msg}`} title={log.message}>
          {log.message}
        </span>

        {/* HTTP chip */}
        {httpChip && (
          <span className={`shrink-0 text-[11px] truncate max-w-[200px] ${httpChip.color}`} title={httpChip.text}>
            {httpChip.text}
          </span>
        )}

        {/* Corr-ID short */}
        {log.corrId && (
          <span className="text-slate-600 shrink-0 text-[10px]" title={log.corrId}>
            {log.corrId.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="bg-slate-900/70 border-t border-slate-800 px-4 pt-3 pb-4">

          {/* ── Metadata chips ── */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px]">
            <span className="text-slate-500">
              <span className="text-slate-600">time  </span>
              <span className="text-slate-300">{(log.payload.timestamp as string) ?? log.ts}</span>
            </span>
            <span className="text-slate-500">
              <span className="text-slate-600">svc   </span>
              <span className="text-cyan-400">{log.container}</span>
            </span>
            {log.corrId && (
              <span className="text-slate-500">
                <span className="text-slate-600">corr  </span>
                <span className="text-blue-300 break-all">{log.corrId}</span>
              </span>
            )}
            {log.requestId && (
              <span className="text-slate-500">
                <span className="text-slate-600">req   </span>
                <span className="text-slate-300 break-all">{log.requestId}</span>
              </span>
            )}
            {log.httpReq?.requestUrl && (
              <span className="text-slate-500">
                <span className="text-slate-600">url   </span>
                <span className={httpStatusColor(log.httpReq.status)}>
                  {log.httpReq.requestMethod} {log.httpReq.requestUrl} [{log.httpReq.status}]
                  {log.httpReq.latency ? ` · ${log.httpReq.latency}` : ''}
                </span>
              </span>
            )}
            {p.error && (
              <span className="text-slate-500">
                <span className="text-slate-600">error </span>
                <span className="text-red-300 break-all">{p.error as string}</span>
              </span>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {log.corrId && (
              <button
                onClick={(e) => { e.stopPropagation(); onFilterCorrId(log.corrId); }}
                className="px-2 py-0.5 text-[10px] rounded border border-slate-700 bg-slate-800/80 text-blue-400 hover:border-blue-600 hover:text-blue-300 transition-colors"
              >
                filter corr-id
              </button>
            )}
            {log.corrId && <CopyBtn text={log.corrId} label="copy corr-id" />}
            {log.requestId && <CopyBtn text={log.requestId} label="copy req-id" />}
            <CopyBtn text={JSON.stringify(log.payload, null, 2)} label="copy JSON" />
          </div>

          {/* ── JSON payload ── */}
          <div className="rounded border border-slate-700/60 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1 bg-slate-800/60 border-b border-slate-700/60 text-[10px] text-slate-500">
              <span>json_payload</span>
              <span>{log.container}</span>
            </div>
            <div className="p-3 overflow-auto max-h-[400px] text-[11px] leading-relaxed bg-slate-950/60">
              <JsonViewer value={log.payload as never} depth={0} />
            </div>
          </div>

          {/* ── Stack trace ── */}
          {p.stacktrace && (
            <div className="mt-2 rounded border border-red-900/40 overflow-hidden">
              <div className="px-3 py-1 bg-red-950/30 border-b border-red-900/40 text-[10px] text-red-400">
                stacktrace
              </div>
              <pre className="p-3 text-[10px] text-slate-400 overflow-x-auto leading-relaxed whitespace-pre bg-slate-950/60">
                {p.stacktrace as string}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
