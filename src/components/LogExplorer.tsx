'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { LogEntry, FilterState } from '@/lib/logTypes';
import { parseLogs } from '@/lib/csvParser';
import { parseOSResponse, isOSResponse } from '@/lib/osParser';
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
        <div className="absolute top-full right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-xl min-w-[220px] max-h-72 overflow-y-auto">
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

// ── curl parser ────────────────────────────────────────────────────────────

interface ParsedCurl {
  url: string;
  cookie: string;
  body: unknown;
}

function parseCurl(raw: string): ParsedCurl | null {
  // Extract URL — first bare argument after 'curl'
  const urlMatch = raw.match(/curl\s+'([^']+)'/) ?? raw.match(/curl\s+"([^"]+)"/) ?? raw.match(/curl\s+(\S+)/);
  if (!urlMatch) return null;
  const url = urlMatch[1];

  // Extract cookie from -b / --cookie or -H 'cookie: ...'
  const cookieB = raw.match(/(?:-b|--cookie)\s+'([^']+)'/) ?? raw.match(/(?:-b|--cookie)\s+"([^"]+)"/);
  const cookieH = raw.match(/-H\s+'[Cc]ookie:\s*([^']+)'/) ?? raw.match(/-H\s+"[Cc]ookie:\s*([^"]+)"/);
  const cookie = (cookieB?.[1] ?? cookieH?.[1] ?? '').trim();

  // Extract body from --data-raw / --data / -d
  const bodyMatch =
    raw.match(/(?:--data-raw|--data|-d)\s+'([\s\S]+?)'\s*(?:-[A-Z]|$)/) ??
    raw.match(/(?:--data-raw|--data|-d)\s+'([\s\S]+?)'$/) ??
    raw.match(/(?:--data-raw|--data|-d)\s+"([\s\S]+?)"$/);

  let body: unknown = null;
  if (bodyMatch) {
    try { body = JSON.parse(bodyMatch[1]); } catch { /* keep null */ }
  }

  return { url, cookie, body };
}

// ── Connect panel ──────────────────────────────────────────────────────────

const LS_CURL = 'os_proxy_curl';

interface ConnectPanelProps {
  onLogs: (logs: LogEntry[], label: string) => void;
}

async function proxyFetch(url: string, body: unknown, cookie: string): Promise<unknown> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, body, cookie }),
  });
  const data = await res.json() as unknown;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

interface ExtData {
  baseUrl: string;
  indexPattern: string | null;
  indexPatternId: string | null;
  timeFrom: string;
  timeTo: string;
  containers: string[];
}

function ConnectPanel({ onLogs }: ConnectPanelProps) {
  const [tab, setTab] = useState<'ext' | 'curl'>('ext');

  // ── Extension tab state ──
  const [extData,  setExtData]  = useState<ExtData | null>(null);
  const [extErr,   setExtErr]   = useState('');
  const lastExtTsRef = useRef<number>(0);

  const checkExtCookie = useCallback(async () => {
    try {
      const res  = await fetch('/api/ext-cookie');
      const data = await res.json() as { hits?: unknown[]; ts?: number } & Partial<ExtData>;
      if (Array.isArray(data.hits) && data.hits.length > 0) {
        const d: ExtData = {
          baseUrl:        data.baseUrl        ?? '',
          indexPattern:   data.indexPattern   ?? null,
          indexPatternId: data.indexPatternId ?? null,
          timeFrom:       data.timeFrom       ?? 'now-1h',
          timeTo:         data.timeTo         ?? 'now',
          containers:     data.containers     ?? [],
        };
        setExtData(d);
        setExtErr('');
        // Auto-display logs when new data arrives
        if (data.ts && data.ts !== lastExtTsRef.current) {
          lastExtTsRef.current = data.ts;
          const logs = parseOSResponse({ rawResponse: { hits: { hits: data.hits } } });
          if (logs.length > 0) onLogs(logs, `${d.indexPattern ?? 'OSD'} (Cookie Bridge)`);
        }
      } else {
        setExtData(null);
      }
    } catch { /* server not ready */ }
  }, [onLogs]);

  useEffect(() => {
    if (tab === 'ext' && !extData) {
      checkExtCookie();
      const id = setInterval(checkExtCookie, 3000);
      return () => clearInterval(id);
    }
  }, [tab, extData, checkExtCookie]);

  // ── cURL tab state ──
  const [curlText, setCurlText] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(LS_CURL) ?? '' : ''
  );
  const [curlLoading, setCurlLoading] = useState(false);
  const [curlErr, setCurlErr]   = useState('');
  const [parsed, setParsed]     = useState<ParsedCurl | null>(null);

  const onPaste = (text: string) => {
    setCurlText(text);
    setParsed(parseCurl(text));
    setCurlErr('');
  };

  const fetchCurl = async () => {
    const p = parsed ?? parseCurl(curlText);
    if (!p) { setCurlErr('Could not parse curl command.'); return; }
    if (!p.cookie) { setCurlErr('No cookie found in curl command.'); return; }
    localStorage.setItem(LS_CURL, curlText);
    setCurlLoading(true);
    setCurlErr('');
    try {
      const data = await proxyFetch(p.url, p.body, p.cookie);
      const logs = parseOSResponse(data);
      if (logs.length === 0) throw new Error('No hits — check the time range in the curl body.');
      const indexMatch = curlText.match(/"index"\s*:\s*"([^"]+)"/);
      onLogs(logs, `${indexMatch?.[1] ?? 'opensearch'} (live)`);
    } catch (e) {
      setCurlErr((e as Error).message);
    } finally {
      setCurlLoading(false);
    }
  };

  const tabCls = (t: 'ext' | 'curl') =>
    `px-3 py-1 text-[11px] font-medium rounded-t border-b-2 transition-colors ${
      tab === t ? 'border-blue-500 text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-300'
    }`;

  return (
    <div className="bg-slate-900 border-b border-slate-700 flex flex-col text-xs">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-slate-800">
        <button className={tabCls('ext')}  onClick={() => setTab('ext')}>Cookie Bridge</button>
        <button className={tabCls('curl')} onClick={() => setTab('curl')}>Paste cURL</button>
        <a
          href="https://github.com/monkey-mode/log-explorer-parser/releases/tag/latest"
          target="_blank"
          rel="noreferrer"
          className="ml-auto mb-1.5 flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Download (.zip)
        </a>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        {tab === 'ext' && (
          <>
            {extData ? (
              <div className="flex flex-col gap-1 px-2.5 py-1.5 bg-green-950/40 border border-green-800/50 rounded text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <span className="text-green-300 font-medium">Logs received</span>
                  <span className="text-green-600 truncate">{extData.baseUrl}</span>
                  <button onClick={checkExtCookie} className="ml-auto text-green-600 hover:text-green-400" title="Re-check">↻</button>
                </div>
                {extData.indexPattern && (
                  <div className="text-slate-500 pl-3.5 text-[10px] font-mono">{extData.indexPattern}</div>
                )}
                {extData.containers.length > 0 && (
                  <div className="text-slate-500 pl-3.5 text-[10px] truncate">
                    svcs: {extData.containers.join(', ')}
                  </div>
                )}
                <div className="text-slate-500 pl-3.5 text-[10px]">
                  {extData.timeFrom} → {extData.timeTo}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-800/60 border border-slate-700 rounded text-[11px] text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0 animate-pulse" />
                Waiting for Cookie Bridge… click its icon on the OSD tab then Send
              </div>
            )}
            {extErr && <span className="text-red-400 text-[11px]">{extErr}</span>}
          </>
        )}

        {tab === 'curl' && (
          <>
            <div className="text-slate-500">
              DevTools → Network → right-click request →{' '}
              <span className="text-slate-300 font-medium">Copy as cURL</span> → paste below
            </div>
            <textarea
              value={curlText}
              onChange={(e) => onPaste(e.target.value)}
              placeholder={"curl 'https://logging-nonprd.gcp.ktbapp.tech/internal/search/...' \\\n  -b 'cookie...' \\\n  --data-raw '{...}'"}
              rows={5}
              className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500 font-mono text-[10px] resize-y leading-relaxed"
            />
            {parsed && (
              <div className="flex gap-4 text-[10px] text-slate-500 font-mono">
                <span><span className="text-slate-600">cookie </span><span className={parsed.cookie ? 'text-green-400' : 'text-red-400'}>{parsed.cookie ? `${parsed.cookie.length} chars ✓` : 'not found'}</span></span>
                <span><span className="text-slate-600">body </span><span className={parsed.body ? 'text-green-400' : 'text-yellow-400'}>{parsed.body ? 'parsed ✓' : 'not found'}</span></span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={fetchCurl}
                disabled={curlLoading || !curlText.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded font-semibold transition-colors"
              >
                {curlLoading ? 'Fetching…' : 'Fetch logs'}
              </button>
              {curlErr && <span className="text-red-400">{curlErr}</span>}
            </div>
          </>
        )}
      </div>
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

export function LogExplorer() {
  const [allLogs,  setAllLogs]  = useState<LogEntry[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [loading,  setLoading]  = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    severity: 'ALL',
    services: [],
    corrId: '',
  });

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const searchRef      = useRef<HTMLInputElement>(null);
  const dropOverlayRef = useRef<HTMLDivElement>(null);

  const services = useMemo(
    () => [...new Set(allLogs.map((l) => l.container))].sort(),
    [allLogs]
  );

  const stats = useMemo(() => {
    if (!allLogs.length) return null;
    return {
      total:  allLogs.length,
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
        const haystack = [
          log.message, log.error, log.container, log.corrId,
          log.callUrl ?? '', log.httpReq?.requestUrl ?? '', log.httpReq?.requestMethod ?? '',
          log.payload.caller ?? '', String(log.httpSC ?? ''), String(log.httpReq?.status ?? ''),
          JSON.stringify(log.payload),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allLogs, filters]);

  const loadLogs = useCallback((logs: LogEntry[], label: string) => {
    setAllLogs(logs.sort((a, b) => a.payloadTs - b.payloadTs));
    setFileName(label);
    setFilters({ search: '', severity: 'ALL', services: [], corrId: '' });
    setShowConnect(false);
  }, []);

  const loadFile = useCallback((file: File) => {
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(text) as unknown;
          if (isOSResponse(data)) {
            loadLogs(parseOSResponse(data), file.name);
          } else {
            alert('JSON file is not an OpenSearch response (missing rawResponse.hits.hits).');
          }
        } else {
          loadLogs(parseLogs(text), file.name);
        }
      } catch {
        alert('Failed to parse file.');
      }
      setLoading(false);
    };
    reader.readAsText(file);
  }, [loadLogs]);

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
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
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
        Drop CSV or JSON file here
      </div>

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span className="font-bold text-white text-[15px] tracking-tight">Log Explorer</span>
        </div>

        {/* Load file button */}
        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold rounded-md cursor-pointer transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Load file
          <input ref={fileInputRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onFileChange} />
        </label>

        {/* Connect button */}
        <button
          onClick={() => setShowConnect((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
            showConnect
              ? 'bg-blue-700 border-blue-600 text-white'
              : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          Connect
        </button>

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

      {/* ── Connect panel ── */}
      {showConnect && <ConnectPanel onLogs={loadLogs} />}

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap">
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

        <ServicePicker services={services} selected={filters.services} onChange={setServices} />

        {filters.corrId && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-950 border border-blue-700 rounded-full text-[11px] text-blue-300">
            <span className="text-blue-500 font-medium">corr-id:</span>
            <span className="font-mono">{filters.corrId.substring(0, 16)}…</span>
            <button onClick={clearCorrId} className="text-blue-400 hover:text-white font-bold leading-none ml-0.5" title="Clear filter (Esc)">×</button>
          </div>
        )}
      </div>

      {/* ── Count bar ── */}
      <div className="px-4 py-1 bg-slate-900/80 border-b border-slate-800 text-[11px] text-slate-500 shrink-0">
        {allLogs.length > 0
          ? `Showing ${filteredLogs.length.toLocaleString()} of ${allLogs.length.toLocaleString()} entries`
          : 'No data loaded'}
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
            </svg>
            <div className="text-center">
              <p className="text-slate-300 font-medium mb-2">Load logs to start exploring</p>
              <div className="text-sm text-slate-500 space-y-1 max-w-sm text-left">
                <p><span className="text-slate-400 font-medium">CSV file</span> — export from OpenSearch Discover</p>
                <p><span className="text-slate-400 font-medium">JSON file</span> — save curl response to <code className="text-slate-400">.json</code> and drop it</p>
                <p><span className="text-slate-400 font-medium">Connect</span> — paste session cookie to query live</p>
              </div>
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
