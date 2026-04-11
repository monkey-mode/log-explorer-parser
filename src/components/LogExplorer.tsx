'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { LogEntry, FilterState } from '@/lib/logTypes';
import { parseLogs } from '@/lib/csvParser';
import { LogRow } from './LogRow';

// ── Multi-select service dropdown ──────────────────────────────────────────
interface ServicePickerProps {
  services: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function ServicePicker({ services, selected, onChange }: ServicePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (svc: string) => {
    onChange(selected.includes(svc) ? selected.filter((s) => s !== svc) : [...selected, svc]);
  };

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
        <span className="max-w-[160px] truncate">{label}</span>
        {selected.length > 0 && (
          <span
            className="text-blue-400 hover:text-white font-bold leading-none ml-0.5"
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            title="Clear"
          >
            ×
          </span>
        )}
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-xl min-w-[220px] max-h-72 overflow-y-auto">
          {/* Select all / clear */}
          <div className="flex gap-2 px-3 py-2 border-b border-slate-700">
            <button
              onClick={() => onChange([...services])}
              className="text-[11px] text-blue-400 hover:text-blue-300"
            >
              Select all
            </button>
            <span className="text-slate-600">·</span>
            <button
              onClick={() => onChange([])}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          </div>
          {services.map((svc) => (
            <label
              key={svc}
              className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-300"
            >
              <input
                type="checkbox"
                checked={selected.includes(svc)}
                onChange={() => toggle(svc)}
                className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
              />
              <span className="truncate">{svc}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const SEV_BUTTONS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

const SEV_BTN_ACTIVE: Record<string, string> = {
  ALL:   'bg-blue-600 text-white border-blue-600',
  ERROR: 'bg-red-700 text-white border-red-700',
  WARN:  'bg-yellow-600 text-black border-yellow-600',
  INFO:  'bg-blue-600 text-white border-blue-600',
  DEBUG: 'bg-slate-600 text-white border-slate-600',
};

export function LogExplorer() {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    severity: 'ALL',
    services: [],
    corrId: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropOverlayRef = useRef<HTMLDivElement>(null);

  // Derived services list
  const services = useMemo(
    () => [...new Set(allLogs.map((l) => l.container))].sort(),
    [allLogs]
  );

  // Stats
  const stats = useMemo(() => {
    if (!allLogs.length) return null;
    const errors = allLogs.filter((l) => l.severity === 'ERROR').length;
    const warns  = allLogs.filter((l) => l.severity === 'WARN').length;
    return { total: allLogs.length, errors, warns };
  }, [allLogs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    return allLogs.filter((log) => {
      if (filters.severity !== 'ALL' && log.severity !== filters.severity) return false;
      if (filters.services.length > 0 && !filters.services.includes(log.container)) return false;
      if (filters.corrId && log.corrId !== filters.corrId) return false;
      if (q) {
        const haystack = [
          log.message,
          log.error,
          log.container,
          log.corrId,
          log.callUrl ?? '',
          log.httpReq?.requestUrl ?? '',
          log.httpReq?.requestMethod ?? '',
          log.payload.caller ?? '',
          String(log.httpSC ?? ''),
          String(log.httpReq?.status ?? ''),
          JSON.stringify(log.payload),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allLogs, filters]);

  // Load CSV
  const loadFile = useCallback((file: File) => {
    setFileName(file.name);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const logs = parseLogs(text).sort((a, b) => a.payloadTs - b.payloadTs);
      setAllLogs(logs);
      setFilters({ search: '', severity: 'ALL', services: [], corrId: '' });
      setLoading(false);
    };
    reader.readAsText(file);
  }, []);

  // File input change
  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  // Drag & drop
  useEffect(() => {
    const overlay = dropOverlayRef.current;
    if (!overlay) return;

    const show = (e: DragEvent) => { e.preventDefault(); overlay.classList.add('flex'); overlay.classList.remove('hidden'); };
    const hide = (e: DragEvent) => { if (!e.relatedTarget) { overlay.classList.remove('flex'); overlay.classList.add('hidden'); } };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      overlay.classList.remove('flex'); overlay.classList.add('hidden');
      const file = e.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    };

    document.addEventListener('dragenter', show);
    document.addEventListener('dragleave', hide);
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragenter', show);
      document.removeEventListener('dragleave', hide);
      document.removeEventListener('drop', drop);
    };
  }, [loadFile]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFilters((f) => ({ ...f, corrId: '' }));
        return;
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const setSearch      = (v: string)   => setFilters((f) => ({ ...f, search: v }));
  const setSeverity    = (v: string)   => setFilters((f) => ({ ...f, severity: v }));
  const setServices    = (v: string[]) => setFilters((f) => ({ ...f, services: v }));
  const filterByCorrId = useCallback((corrId: string) => setFilters((f) => ({ ...f, corrId })), []);
  const clearCorrId    = useCallback(() => setFilters((f) => ({ ...f, corrId: '' })), []);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-hidden">
      {/* Drop overlay */}
      <div
        ref={dropOverlayRef}
        className="hidden fixed inset-0 z-50 items-center justify-center bg-blue-900/20 border-4 border-dashed border-blue-500 text-blue-300 text-xl font-semibold pointer-events-none"
      >
        📂 Drop CSV file here
      </div>

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span className="font-bold text-white text-[15px] tracking-tight">Log Explorer</span>
        </div>

        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md cursor-pointer transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Load CSV
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />
        </label>

        {fileName && (
          <span className="text-xs text-slate-500 truncate max-w-[200px]">{fileName}</span>
        )}

        {stats && (
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span>{stats.total.toLocaleString()} entries</span>
            {stats.errors > 0 && <span className="text-red-400">{stats.errors} errors</span>}
            {stats.warns  > 0 && <span className="text-yellow-400">{stats.warns} warnings</span>}
          </div>
        )}

        {loading && <span className="text-xs text-slate-500 ml-2 animate-pulse">Parsing…</span>}
      </header>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message, error, URL, correlation ID… (press / to focus)"
            className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Severity */}
        <div className="flex gap-1">
          {SEV_BUTTONS.map((sev) => (
            <button
              key={sev}
              onClick={() => setSeverity(sev)}
              className={`px-2.5 py-1 text-[11px] font-bold rounded border transition-all ${
                filters.severity === sev
                  ? SEV_BTN_ACTIVE[sev]
                  : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        {/* Service multi-select */}
        <ServicePicker
          services={services}
          selected={filters.services}
          onChange={setServices}
        />

        {/* Corr-ID chip */}
        {filters.corrId && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-950 border border-blue-700 rounded-full text-[11px] text-blue-300">
            <span className="text-blue-500 font-medium">corr-id:</span>
            <span className="font-mono">{filters.corrId.substring(0, 16)}…</span>
            <button
              onClick={clearCorrId}
              className="text-blue-400 hover:text-white font-bold leading-none ml-0.5"
              title="Clear filter (Esc)"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* ── Count bar ── */}
      <div className="px-4 py-1 bg-slate-900/80 border-b border-slate-800 text-[11px] text-slate-500 shrink-0">
        {allLogs.length > 0
          ? `Showing ${filteredLogs.length.toLocaleString()} of ${allLogs.length.toLocaleString()} entries`
          : 'No file loaded'}
      </div>

      {/* ── Log list ── */}
      <main className="flex-1 overflow-y-auto">
        {allLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
            <svg className="w-16 h-16 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <div className="text-center">
              <p className="text-slate-300 font-medium mb-1">Load a CSV to start exploring logs</p>
              <p className="text-sm text-slate-500 max-w-sm">
                Export from OpenSearch with{' '}
                <code className="text-slate-400">@timestamp</code>,{' '}
                <code className="text-slate-400">kubernetes.container_name</code>,{' '}
                <code className="text-slate-400">json_payload</code> columns.
                <br />You can also drag & drop the file.
              </p>
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            No logs match the current filters.
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
