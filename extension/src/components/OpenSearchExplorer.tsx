import { useState, useMemo, useCallback, useEffect } from 'react';
import type { LogEntry } from '@/lib/logTypes';
import { LogRow } from '@/components/LogRow';
import { getActiveTab, injectPageHook, readPageData } from '../lib/opensearch';

interface Props {
  onOpenSettings: () => void;
}

export function OpenSearchExplorer({ onOpenSettings }: Props) {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'empty'>('idle');
  const [fetchError, setFetchError] = useState('');

  // Client-side filters — no API call, instant
  const [corrId, setCorrId] = useState('');
  const [requestId, setRequestId] = useState('');

  const filteredLogs = useMemo(() => {
    const cid = corrId.trim();
    const rid = requestId.trim();
    if (!cid && !rid) return allLogs;
    return allLogs.filter((log) => {
      if (cid && log.corrId !== cid) return false;
      if (rid && log.requestId !== rid) return false;
      return true;
    });
  }, [allLogs, corrId, requestId]);

  const stats = useMemo(() => {
    if (!allLogs.length) return null;
    return {
      total: allLogs.length,
      errors: allLogs.filter(l => l.severity === 'ERROR').length,
      warns:  allLogs.filter(l => l.severity === 'WARN').length,
    };
  }, [allLogs]);

  const reload = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const tab = await getActiveTab();
      if (!tab.id) throw new Error('No active tab.');
      await injectPageHook(tab.id);
      const logs = await readPageData(tab.id);
      if (logs && logs.length > 0) {
        setAllLogs(logs);
        setStatus('ok');
      } else {
        setAllLogs([]);
        setStatus('empty');
      }
    } catch (e) {
      setFetchError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filterByCorrId = useCallback((id: string) => {
    setCorrId(id);
    setRequestId('');
  }, []);

  const clearFilters = () => {
    setCorrId('');
    setRequestId('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') clearFilters();
  };

  const hasFilter = corrId.trim() || requestId.trim();

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <svg className="w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span className="font-bold text-white text-[14px] flex-1">Log Explorer</span>

        {stats && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-slate-500">{stats.total.toLocaleString()}</span>
            {stats.errors > 0 && <span className="text-red-400">{stats.errors}E</span>}
            {stats.warns  > 0 && <span className="text-yellow-400">{stats.warns}W</span>}
          </div>
        )}

        <button
          onClick={reload}
          disabled={loading}
          title="Reload from page"
          className="p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-40"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>

      {/* ── Filter bar ── */}
      <div className="px-3 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-[76px] shrink-0 text-right">Corr-ID</span>
          <input
            type="text"
            value={corrId}
            onChange={(e) => setCorrId(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Filter by X-Correlation-ID (Esc to clear)"
            className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 transition-colors font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-[76px] shrink-0 text-right">Req-ID</span>
          <input
            type="text"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Filter by X-Request-ID (Esc to clear)"
            className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 transition-colors font-mono"
          />
        </div>
        {hasFilter && (
          <div className="flex items-center gap-2 pl-[84px]">
            <span className="text-[10px] text-blue-400">
              {filteredLogs.length.toLocaleString()} of {allLogs.length.toLocaleString()} logs match
            </span>
            <button onClick={clearFilters} className="text-[10px] text-slate-500 hover:text-slate-300">
              clear (Esc)
            </button>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="px-3 py-1 border-b border-slate-800 text-[11px] shrink-0 bg-slate-900/60">
        {fetchError ? (
          <span className="text-red-400">{fetchError}</span>
        ) : loading ? (
          <span className="text-slate-500 animate-pulse">Reading from page…</span>
        ) : status === 'empty' ? (
          <span className="text-slate-500">
            No data — search in OpenSearch Discover first, then click{' '}
            <button onClick={reload} className="text-blue-400 hover:text-blue-300 underline">reload</button>
          </span>
        ) : allLogs.length > 0 ? (
          <span className="text-slate-500">
            {filteredLogs.length.toLocaleString()} logs shown
            {hasFilter && ` (filtered from ${allLogs.length.toLocaleString()})`}
          </span>
        ) : null}
      </div>

      {/* ── Log list ── */}
      <main className="flex-1 overflow-y-auto">
        {filteredLogs.map((log) => (
          <LogRow key={log.id} log={log} onFilterCorrId={filterByCorrId} />
        ))}
      </main>
    </div>
  );
}
