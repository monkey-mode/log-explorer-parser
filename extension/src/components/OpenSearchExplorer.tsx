import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { LogEntry, FilterState } from '@/lib/logTypes';
import { parseLog } from '@/lib/csvParser';
import { LogRow } from '@/components/LogRow';
import type { OSConfig } from '../lib/opensearch';
import { queryOpenSearch, TIME_RANGES } from '../lib/opensearch';

// ── Multi-select service dropdown ──────────────────────────────────────────
interface ServicePickerProps {
  services: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}

function ServicePicker({ services, selected, onChange }: ServicePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const toggle = (svc: string) =>
    onChange(selected.includes(svc) ? selected.filter((s) => s !== svc) : [...selected, svc]);

  const label =
    selected.length === 0 ? 'All Services' :
    selected.length === 1 ? selected[0] :
    `${selected.length} Services`;

  if (services.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
          selected.length > 0
            ? 'bg-blue-950 border-blue-700 text-blue-300'
            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
        }`}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        {selected.length > 0 && (
          <span className="text-blue-400 hover:text-white font-bold" onClick={(e) => { e.stopPropagation(); onChange([]); }}>×</span>
        )}
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-xl min-w-[200px] max-h-64 overflow-y-auto">
          <div className="flex gap-2 px-3 py-2 border-b border-slate-700">
            <button onClick={() => onChange([...services])} className="text-[11px] text-blue-400 hover:text-blue-300">Select all</button>
            <span className="text-slate-600">·</span>
            <button onClick={() => onChange([])} className="text-[11px] text-slate-400 hover:text-slate-200">Clear</button>
          </div>
          {services.map((svc) => (
            <label key={svc} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-300">
              <input type="checkbox" checked={selected.includes(svc)} onChange={() => toggle(svc)} className="w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
              <span className="truncate">{svc}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main explorer ──────────────────────────────────────────────────────────
const SEV_BUTTONS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

const SEV_BTN_ACTIVE: Record<string, string> = {
  ALL:   'bg-blue-600 text-white border-blue-600',
  ERROR: 'bg-red-700 text-white border-red-700',
  WARN:  'bg-yellow-600 text-black border-yellow-600',
  INFO:  'bg-blue-600 text-white border-blue-600',
  DEBUG: 'bg-slate-600 text-white border-slate-600',
};

interface Props {
  config: OSConfig;
  onOpenSettings: () => void;
}

export function OpenSearchExplorer({ config, onOpenSettings }: Props) {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [timeRange, setTimeRange] = useState(config.timeRange);
  const [filters, setFilters] = useState<FilterState>({
    search: '', severity: 'ALL', services: [], corrId: '',
  });
  const searchRef = useRef<HTMLInputElement>(null);

  const services = useMemo(
    () => [...new Set(allLogs.map((l) => l.container))].sort(),
    [allLogs]
  );

  const stats = useMemo(() => {
    if (!allLogs.length) return null;
    return {
      total: allLogs.length,
      errors: allLogs.filter((l) => l.severity === 'ERROR').length,
      warns:  allLogs.filter((l) => l.severity === 'WARN').length,
    };
  }, [allLogs]);

  const filteredLogs = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    return allLogs.filter((log) => {
      if (filters.severity !== 'ALL' && log.severity !== filters.severity) return false;
      if (filters.services.length > 0 && !filters.services.includes(log.container)) return false;
      if (filters.corrId && log.corrId !== filters.corrId) return false;
      if (q) {
        const hay = [
          log.message, log.error, log.container, log.corrId,
          log.callUrl ?? '',
          log.httpReq?.requestUrl ?? '',
          log.httpReq?.requestMethod ?? '',
          log.payload.caller ?? '',
          String(log.httpSC ?? ''),
          String(log.httpReq?.status ?? ''),
          JSON.stringify(log.payload),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allLogs, filters]);

  const fetchLogs = useCallback(async (range = timeRange) => {
    setLoading(true);
    setFetchError('');
    try {
      const rows = await queryOpenSearch({ ...config, timeRange: range });
      const logs = rows
        .filter((r) => r.length >= 3)
        .map((r, i) => parseLog(r, i))
        .sort((a, b) => a.payloadTs - b.payloadTs);
      setAllLogs(logs);
      setFilters({ search: '', severity: 'ALL', services: [], corrId: '' });
    } catch (e) {
      setFetchError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config, timeRange]);

  // Fetch on mount
  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFilters((f) => ({ ...f, corrId: '' })); return; }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const filterByCorrId = useCallback((corrId: string) => setFilters((f) => ({ ...f, corrId })), []);
  const clearCorrId    = useCallback(() => setFilters((f) => ({ ...f, corrId: '' })), []);

  const handleTimeChange = (val: string) => {
    setTimeRange(val);
    fetchLogs(val);
  };

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
        <span className="font-bold text-white text-[14px] truncate flex-1">Log Explorer</span>

        {stats && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span>{stats.total.toLocaleString()}</span>
            {stats.errors > 0 && <span className="text-red-400">{stats.errors}E</span>}
            {stats.warns  > 0 && <span className="text-yellow-400">{stats.warns}W</span>}
          </div>
        )}

        {/* Time range */}
        <select
          value={timeRange}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-300 outline-none"
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Refresh */}
        <button
          onClick={() => fetchLogs()}
          disabled={loading}
          title="Refresh"
          className="p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-40"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>

        {/* Settings */}
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

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search… (press /)"
            className="w-full pl-7 pr-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Severity */}
        <div className="flex gap-1">
          {SEV_BUTTONS.map((sev) => (
            <button
              key={sev}
              onClick={() => setFilters((f) => ({ ...f, severity: sev }))}
              className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-all ${
                filters.severity === sev
                  ? SEV_BTN_ACTIVE[sev]
                  : 'border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        <ServicePicker services={services} selected={filters.services} onChange={(v) => setFilters((f) => ({ ...f, services: v }))} />

        {/* Corr-ID chip */}
        {filters.corrId && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-950 border border-blue-700 rounded-full text-[10px] text-blue-300">
            <span className="text-blue-500 font-medium">corr:</span>
            <span className="font-mono">{filters.corrId.substring(0, 12)}…</span>
            <button onClick={clearCorrId} className="text-blue-400 hover:text-white font-bold" title="Clear (Esc)">×</button>
          </div>
        )}
      </div>

      {/* ── Count / error bar ── */}
      <div className="px-3 py-1 bg-slate-900/80 border-b border-slate-800 text-[11px] shrink-0">
        {fetchError ? (
          <span className="text-red-400">{fetchError}</span>
        ) : allLogs.length > 0 ? (
          <span className="text-slate-500">
            Showing {filteredLogs.length.toLocaleString()} of {allLogs.length.toLocaleString()} · {config.indexPattern}
          </span>
        ) : loading ? (
          <span className="text-slate-500 animate-pulse">Fetching from OpenSearch…</span>
        ) : (
          <span className="text-slate-600">No results</span>
        )}
      </div>

      {/* ── Log list ── */}
      <main className="flex-1 overflow-y-auto">
        {loading && allLogs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-xs animate-pulse">
            Querying {config.baseUrl}…
          </div>
        ) : filteredLogs.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-xs">
            {allLogs.length === 0 ? 'No logs returned. Try a wider time range.' : 'No logs match the current filters.'}
          </div>
        ) : (
          filteredLogs.map((log) => (
            <LogRow key={log.id} log={log} onFilterCorrId={filterByCorrId} />
          ))
        )}
      </main>
    </div>
  );
}
