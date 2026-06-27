'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { LogEntry, FilterState } from '@/lib/logTypes';
import { parseGcsNdjson } from '@/lib/gcsParser';
import {
  GOOGLE_CLIENT_ID,
  DEFAULT_BUCKET,
  DEFAULT_PROJECT,
  BUCKET_SUFFIX,
  MAX_OBJECT_BYTES,
  requestAccessToken,
  listProjects,
  listBuckets,
  listPrefixes,
  listObjects,
  downloadObject,
  type GcsObject,
  type GcsProject,
} from '@/lib/gcsClient';
import {
  getCached,
  putCached,
  getCachedMeta,
  cacheStats,
  clearCache,
  type CacheMeta,
} from '@/lib/gcsCache';
import { LogRow } from './LogRow';

const TOKEN_STORAGE_KEY = 'gcs_access_token';

type FileState = 'idle' | 'downloading' | 'cached' | 'done' | 'error' | 'skipped';
interface FileStatus {
  state: FileState;
  received?: number;
  total?: number;
  error?: string;
}

// ── Multi-select service dropdown (same UX as the OpenSearch explorer) ──────
interface ServicePickerProps {
  services: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function ServicePicker({ services, selected, onChange }: ServicePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // focus the search box when the dropdown opens; clear query when it closes
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  const toggle = (svc: string) => {
    onChange(selected.includes(svc) ? selected.filter((s) => s !== svc) : [...selected, svc]);
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return q ? services.filter((s) => s.toLowerCase().includes(q)) : services;
  }, [services, query]);

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
        <div className="absolute top-full right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-xl min-w-[240px] flex flex-col max-h-80">
          {/* search box */}
          <div className="p-2 border-b border-slate-700">
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search services…"
                className="w-full pl-7 pr-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 px-3 py-1.5 border-b border-slate-700">
            <button onClick={() => onChange([...new Set([...selected, ...filtered])])} className="text-[11px] text-blue-400 hover:text-blue-300">
              {query ? 'Select matches' : 'Select all'}
            </button>
            <span className="text-slate-600">·</span>
            <button onClick={() => onChange([])} className="text-[11px] text-slate-400 hover:text-slate-200">Clear</button>
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-slate-500 text-center">No services match “{query}”.</div>
            ) : (
              filtered.map((svc) => (
                <label key={svc} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-300">
                  <input type="checkbox" checked={selected.includes(svc)} onChange={() => toggle(svc)} className="w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
                  <span className="truncate">{svc}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Time range filter ───────────────────────────────────────────────────────

type TimeMode = 'relative' | 'absolute';
interface TimeRange { mode: TimeMode; preset: string; from: string; to: string }

const DEFAULT_TIME_RANGE: TimeRange = { mode: 'relative', preset: 'all', from: '', to: '' };

const REL_PRESETS: { key: string; label: string; ms: number }[] = [
  { key: 'all', label: 'All time', ms: 0 },
  { key: '5m',  label: 'Last 5 min',   ms: 5 * 60_000 },
  { key: '15m', label: 'Last 15 min',  ms: 15 * 60_000 },
  { key: '30m', label: 'Last 30 min',  ms: 30 * 60_000 },
  { key: '1h',  label: 'Last 1 hour',  ms: 60 * 60_000 },
  { key: '3h',  label: 'Last 3 hours', ms: 3 * 60 * 60_000 },
  { key: '6h',  label: 'Last 6 hours', ms: 6 * 60 * 60_000 },
  { key: '12h', label: 'Last 12 hours',ms: 12 * 60 * 60_000 },
  { key: '24h', label: 'Last 24 hours',ms: 24 * 60 * 60_000 },
];

/** Best-effort epoch ms for a log entry (payload timestamp, else @timestamp). */
function logTimeMs(log: LogEntry): number {
  if (log.payloadTs && !Number.isNaN(log.payloadTs)) return log.payloadTs;
  const t = Date.parse(log.ts);
  return Number.isNaN(t) ? 0 : t;
}

/** Resolve a TimeRange to an inclusive [from, to] window (ms), or null = no bound. */
function computeWindow(tr: TimeRange, anchorTs: number): { from?: number; to?: number } | null {
  if (tr.mode === 'relative') {
    if (tr.preset === 'all' || !anchorTs) return null;
    const p = REL_PRESETS.find((x) => x.key === tr.preset);
    if (!p || !p.ms) return null;
    return { from: anchorTs - p.ms, to: anchorTs };
  }
  const from = tr.from ? new Date(tr.from).getTime() : undefined;
  const to = tr.to ? new Date(tr.to).getTime() : undefined;
  if (from === undefined && to === undefined) return null;
  return { from, to };
}

function timeRangeLabel(tr: TimeRange): string {
  if (tr.mode === 'relative') return REL_PRESETS.find((p) => p.key === tr.preset)?.label ?? 'Time';
  if (tr.from || tr.to) return 'Custom range';
  return 'All time';
}

function isTimeRangeActive(tr: TimeRange): boolean {
  return (tr.mode === 'relative' && tr.preset !== 'all') || (tr.mode === 'absolute' && Boolean(tr.from || tr.to));
}

/** Format an epoch ms for a datetime-local input value (local time, no seconds). */
function toDatetimeLocal(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

interface TimeFilterProps {
  value: TimeRange;
  onChange: (tr: TimeRange) => void;
  anchorTs: number; // newest loaded entry — relative presets count back from here
  minTs: number;    // oldest loaded entry — used to prefill the absolute inputs
}

function TimeFilter({ value, onChange, anchorTs, minTs }: TimeFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isTimeRangeActive(value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
          active ? 'bg-blue-950 border-blue-700 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
        }`}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>
        </svg>
        <span className="max-w-[140px] truncate">{timeRangeLabel(value)}</span>
        {active && (
          <span
            className="text-blue-400 hover:text-white font-bold leading-none ml-0.5"
            onClick={(e) => { e.stopPropagation(); onChange(DEFAULT_TIME_RANGE); }}
            title="Clear time filter"
          >
            ×
          </span>
        )}
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-xl w-[280px]">
          {/* tabs */}
          <div className="flex border-b border-slate-700">
            {(['relative', 'absolute'] as TimeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onChange({ ...value, mode: m })}
                className={`flex-1 px-3 py-2 text-[11px] font-semibold capitalize transition-colors ${
                  value.mode === m ? 'text-blue-300 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'relative' ? 'Past (relative)' : 'Absolute'}
              </button>
            ))}
          </div>

          {value.mode === 'relative' ? (
            <div className="p-2">
              <div className="grid grid-cols-2 gap-1">
                {REL_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => { onChange({ ...value, mode: 'relative', preset: p.key }); setOpen(false); }}
                    className={`px-2 py-1.5 rounded text-[11px] text-left transition-colors ${
                      value.preset === p.key ? 'bg-blue-700 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 px-1 text-[10px] text-slate-500">
                Counted back from the newest loaded entry.
              </p>
            </div>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              <label className="text-[11px] text-slate-400">
                From
                <input
                  type="datetime-local"
                  step={1}
                  value={value.from}
                  onChange={(e) => onChange({ ...value, mode: 'absolute', from: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </label>
              <label className="text-[11px] text-slate-400">
                To
                <input
                  type="datetime-local"
                  step={1}
                  value={value.to}
                  onChange={(e) => onChange({ ...value, mode: 'absolute', to: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </label>
              <div className="flex justify-between pt-1">
                <button
                  onClick={() => onChange({ mode: 'absolute', preset: 'all', from: toDatetimeLocal(minTs), to: toDatetimeLocal(anchorTs) })}
                  disabled={!anchorTs}
                  className="text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-40"
                >
                  Fill loaded range
                </button>
                <button
                  onClick={() => onChange(DEFAULT_TIME_RANGE)}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SEV_BUTTONS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

const SEV_BTN_ACTIVE: Record<string, string> = {
  ALL:   'bg-blue-600 text-white border-blue-600',
  ERROR: 'bg-red-700 text-white border-red-700',
  WARN:  'bg-yellow-600 text-black border-yellow-600',
  INFO:  'bg-blue-600 text-white border-blue-600',
  DEBUG: 'bg-slate-600 text-white border-slate-600',
};

/** "2026-06-27" + "stdout/" → "stdout/2026/06/27/" */
function dateToPrefix(logPrefix: string, date: string): string {
  const [y, m, d] = date.split('-');
  return `${logPrefix}${y}/${m}/${d}/`;
}

function fileLabel(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] || name;
}

/** "…/00:00:00_00:59:59_S0.json" → "00:00–01:00" (falls back to the raw name). */
function hourRange(name: string): string {
  const base = fileLabel(name);
  const m = base.match(/^(\d{2}):\d{2}:\d{2}_(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return base.replace(/\.json$/, '');
  const start = m[1];
  // round the end (e.g. 00:59:59) up to the next hour for a clean range label
  const end = m[3] === '59' && m[4] === '59' ? String((Number(m[2]) + 1) % 24).padStart(2, '0') : m[2];
  return `${start}:00–${end}:00`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Main explorer ───────────────────────────────────────────────────────────

export function GcsExplorer() {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [loadedLabel, setLoadedLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auth state
  const [token, setToken] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // Project + bucket selection
  const [projects, setProjects] = useState<GcsProject[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [buckets, setBuckets] = useState<string[]>([]);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [metaLoading, setMetaLoading] = useState(false);

  // GCS picker state
  const [logPrefixes, setLogPrefixes] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState('');
  const [date, setDate] = useState(todayStr());
  const [objects, setObjects] = useState<GcsObject[]>([]);

  // Per-file download/cache status + cache stats
  const [fileStatus, setFileStatus] = useState<Record<string, FileStatus>>({});
  const [activeBatch, setActiveBatch] = useState<string[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });
  const refreshCacheInfo = useCallback(() => { cacheStats().then(setCacheInfo); }, []);

  const [filters, setFilters] = useState<FilterState>({
    search: '', severity: 'ALL', services: [], corrId: '',
  });
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);

  const searchRef = useRef<HTMLInputElement>(null);

  // After sign-in, list the user's projects.
  useEffect(() => {
    if (!token) return;
    (async () => {
      setMetaLoading(true);
      try {
        const found = await listProjects(token);
        setProjects(found);
        const def = (DEFAULT_PROJECT && found.find((p) => p.projectId === DEFAULT_PROJECT)?.projectId) || found[0]?.projectId || '';
        setSelectedProject(def);
      } catch (e) {
        setError(e instanceof Error ? `Could not list projects: ${e.message}` : 'Could not list projects');
      } finally {
        setMetaLoading(false);
      }
    })();
  }, [token]);

  // When the project changes, list its *k8s_container_logs buckets.
  useEffect(() => {
    if (!token || !selectedProject) return;
    setBuckets([]);
    setSelectedBucket('');
    setLogPrefixes([]);
    setObjects([]);
    (async () => {
      setMetaLoading(true);
      setError('');
      try {
        const found = await listBuckets(token, selectedProject);
        setBuckets(found);
        if (found.length) {
          setSelectedBucket(found.includes(DEFAULT_BUCKET) ? DEFAULT_BUCKET : found[0]);
        } else {
          setError(`No "*${BUCKET_SUFFIX}" buckets in ${selectedProject} (or no list access).`);
        }
      } catch (e) {
        setError(e instanceof Error ? `Could not list buckets: ${e.message}` : 'Could not list buckets');
      } finally {
        setMetaLoading(false);
      }
    })();
  }, [token, selectedProject]);

  // When the bucket changes, load its log IDs (stdout/, stderr/, …).
  useEffect(() => {
    if (!token || !selectedBucket) return;
    setObjects([]);
    (async () => {
      try {
        const prefixes = await listPrefixes(token, selectedBucket, '');
        setLogPrefixes(prefixes);
        setSelectedLog(prefixes.find((p) => p === 'stdout/') ?? prefixes[0] ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list logs');
      }
    })();
  }, [token, selectedBucket]);

  // Restore a still-valid token from sessionStorage so a refresh doesn't force
  // re-login. sessionStorage clears when the tab closes (short-lived bearer token).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { token: string; expiresAt: number };
      if (saved.token && saved.expiresAt > Date.now()) setToken(saved.token);
      else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError('');
    try {
      const { token: t, expiresAt } = await requestAccessToken(GOOGLE_CLIENT_ID);
      setToken(t);
      try { sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token: t, expiresAt })); } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
    setToken('');
    setProjects([]);
    setSelectedProject('');
    setBuckets([]);
    setSelectedBucket('');
    setLogPrefixes([]);
    setObjects([]);
    setAllLogs([]);
    setLoadedLabel('');
  }, []);

  const services = useMemo(
    () => [...new Set(allLogs.map((l) => l.container))].filter(Boolean).sort(),
    [allLogs]
  );

  const stats = useMemo(() => {
    if (!allLogs.length) return null;
    return {
      total: allLogs.length,
      errors: allLogs.filter((l) => l.severity === 'ERROR').length,
      warns: allLogs.filter((l) => l.severity === 'WARN').length,
    };
  }, [allLogs]);

  // Time bounds of the loaded set (for relative-preset anchor + absolute prefill).
  const { minTs, maxTs } = useMemo(() => {
    let min = Infinity, max = 0;
    for (const l of allLogs) {
      const t = logTimeMs(l);
      if (!t) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    return { minTs: min === Infinity ? 0 : min, maxTs: max };
  }, [allLogs]);

  const timeWindow = useMemo(() => computeWindow(timeRange, maxTs), [timeRange, maxTs]);

  const filteredLogs = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    return allLogs.filter((log) => {
      if (filters.severity !== 'ALL' && log.severity !== filters.severity) return false;
      if (filters.services.length > 0 && !filters.services.includes(log.container)) return false;
      if (filters.corrId && log.corrId !== filters.corrId) return false;
      if (timeWindow) {
        const t = logTimeMs(log);
        if (timeWindow.from !== undefined && t < timeWindow.from) return false;
        if (timeWindow.to !== undefined && t > timeWindow.to) return false;
      }
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
  }, [allLogs, filters, timeWindow]);

  // List the files for the selected log + date.
  const listFiles = useCallback(async () => {
    if (!selectedLog || !token || !selectedBucket) return;
    setError('');
    setObjects([]);
    setFileStatus({});
    const prefix = dateToPrefix(selectedLog, date);
    try {
      const found = await listObjects(token, selectedBucket, prefix);
      setObjects(found);
      if (!found.length) {
        setError(`No files under ${prefix}`);
        return;
      }
      // Seed each file's status from the cache (matching generation = cached).
      const cached: Map<string, CacheMeta> = await getCachedMeta(selectedBucket);
      const seeded: Record<string, FileStatus> = {};
      for (const o of found) {
        if (o.size > MAX_OBJECT_BYTES) seeded[o.name] = { state: 'skipped' };
        else if (cached.get(o.name)?.generation === o.generation) seeded[o.name] = { state: 'cached' };
        else seeded[o.name] = { state: 'idle' };
      }
      setFileStatus(seeded);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list objects');
    }
  }, [selectedLog, date, token, selectedBucket]);

  // Download + parse one or many objects, merge, and show them.
  // Cached files load instantly; others stream with progress. >50 MB are skipped.
  const loadObjects = useCallback(async (targets: GcsObject[], label: string) => {
    if (!targets.length || !token || !selectedBucket) return;
    const tooBig = targets.filter((o) => o.size > MAX_OBJECT_BYTES);
    const ok = targets.filter((o) => o.size <= MAX_OBJECT_BYTES);
    if (!ok.length) {
      setError(`All selected file(s) exceed the ${MAX_OBJECT_BYTES / 1024 / 1024} MB limit.`);
      return;
    }
    setLoading(true);
    setError('');
    setActiveBatch(ok.map((o) => o.name));
    const setStatus = (name: string, s: FileStatus) =>
      setFileStatus((prev) => ({ ...prev, [name]: s }));

    const errors: string[] = [];
    try {
      const merged: LogEntry[] = [];
      for (const obj of ok) {
        try {
          let text: string;
          const hit = await getCached(selectedBucket, obj.name);
          if (hit && hit.generation === obj.generation) {
            setStatus(obj.name, { state: 'cached', received: obj.size, total: obj.size });
            text = hit.text;
          } else {
            setStatus(obj.name, { state: 'downloading', received: 0, total: obj.size });
            text = await downloadObject(token, selectedBucket, obj.name, obj.size, (received, total) =>
              setStatus(obj.name, { state: 'downloading', received, total })
            );
            await putCached({ bucket: selectedBucket, name: obj.name, text, size: obj.size, generation: obj.generation });
            setStatus(obj.name, { state: 'done', received: obj.size, total: obj.size });
          }
          merged.push(...parseGcsNdjson(text));
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'download failed';
          setStatus(obj.name, { state: 'error', error: msg });
          errors.push(`${hourRange(obj.name)}: ${msg}`);
        }
      }
      // re-id and sort the merged set
      merged.sort((a, b) => a.payloadTs - b.payloadTs);
      merged.forEach((l, i) => { l.id = i; });
      setAllLogs(merged);
      setLoadedLabel(label);
      setFilters({ search: '', severity: 'ALL', services: [], corrId: '' });
      setTimeRange(DEFAULT_TIME_RANGE);
      refreshCacheInfo();

      const notes: string[] = [];
      if (tooBig.length) notes.push(`Skipped ${tooBig.length} file(s) over ${MAX_OBJECT_BYTES / 1024 / 1024} MB.`);
      if (errors.length) notes.push(`Failed: ${errors.join('; ')}`);
      setError(notes.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load objects');
    } finally {
      setLoading(false);
    }
  }, [token, selectedBucket, refreshCacheInfo]);

  // Load cache stats once on mount (and refresh after loads/clears).
  useEffect(() => { refreshCacheInfo(); }, [refreshCacheInfo]);

  const handleClearCache = useCallback(async () => {
    await clearCache();
    refreshCacheInfo();
    // Any "cached" markers revert to idle (or skipped for oversized).
    setFileStatus((prev) => {
      const next: Record<string, FileStatus> = {};
      for (const [name, s] of Object.entries(prev)) {
        next[name] = s.state === 'cached' ? { state: 'idle' } : s;
      }
      return next;
    });
  }, [refreshCacheInfo]);

  // Keyboard shortcuts (same as the OpenSearch explorer)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFilters((f) => ({ ...f, corrId: '' })); return; }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const setSearch = (v: string) => setFilters((f) => ({ ...f, search: v }));
  const setSeverity = (v: string) => setFilters((f) => ({ ...f, severity: v }));
  const setServices = (v: string[]) => setFilters((f) => ({ ...f, services: v }));
  const filterByCorrId = useCallback((corrId: string) => setFilters((f) => ({ ...f, corrId })), []);
  const clearCorrId = useCallback(() => setFilters((f) => ({ ...f, corrId: '' })), []);

  // Aggregate stats for the file-list header + the "Load all" affordance.
  const loadableObjects = useMemo(() => objects.filter((o) => o.size <= MAX_OBJECT_BYTES), [objects]);
  const totalSize = useMemo(() => objects.reduce((s, o) => s + o.size, 0), [objects]);
  const loadAll = () => loadObjects(loadableObjects, `${selectedLog.replace(/\/$/, '')} ${date} (${loadableObjects.length} files)`);

  // Overall batch progress (bytes received vs total) for the in-flight load only.
  const overallProgress = useMemo(() => {
    if (!loading || activeBatch.length === 0) return null;
    const sizeByName = new Map(objects.map((o) => [o.name, o.size]));
    let done = 0, totalBytes = 0, gotBytes = 0;
    for (const name of activeBatch) {
      const size = sizeByName.get(name) ?? 0;
      const st = fileStatus[name];
      totalBytes += size;
      if (st?.state === 'done' || st?.state === 'cached') { done += 1; gotBytes += size; }
      else if (st?.state === 'downloading') { gotBytes += st.received ?? 0; }
    }
    const pct = totalBytes ? Math.min(100, Math.round((gotBytes / totalBytes) * 100)) : 0;
    return { done, total: activeBatch.length, pct };
  }, [loading, activeBatch, objects, fileStatus]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-hidden">
      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span className="font-bold text-white text-[15px] tracking-tight">GCS Log Explorer</span>
        </div>

        <Link href="/" className="text-xs text-slate-400 hover:text-blue-300 underline underline-offset-2">
          OpenSearch viewer →
        </Link>

        {!token ? (
          /* Sign-in */
          <button
            onClick={signIn}
            disabled={signingIn || !GOOGLE_CLIENT_ID}
            title={GOOGLE_CLIENT_ID ? '' : 'Set NEXT_PUBLIC_GOOGLE_CLIENT_ID first'}
            className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-800 text-xs font-semibold rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
            </svg>
            {signingIn ? 'Signing in…' : 'Sign in with Google'}
          </button>
        ) : (
          <>
            {/* Project + bucket */}
            <div className="flex items-center gap-2">
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                title="Project"
                className="max-w-[180px] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500"
              >
                {projects.length === 0 && <option value="">(loading projects…)</option>}
                {projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>{p.projectId}</option>
                ))}
              </select>
              <select
                value={selectedBucket}
                onChange={(e) => setSelectedBucket(e.target.value)}
                title={`Buckets ending in *${BUCKET_SUFFIX}`}
                disabled={buckets.length === 0}
                className="max-w-[220px] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500 disabled:opacity-40"
              >
                {buckets.length === 0 && <option value="">(no *{BUCKET_SUFFIX} buckets)</option>}
                {buckets.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* GCS picker */}
            <div className="flex items-center gap-2">
              <select
                value={selectedLog}
                onChange={(e) => { setSelectedLog(e.target.value); setObjects([]); }}
                disabled={logPrefixes.length === 0}
                className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500 disabled:opacity-40"
              >
                {logPrefixes.length === 0 && <option value="">(logs…)</option>}
                {logPrefixes.map((p) => (
                  <option key={p} value={p}>{p.replace(/\/$/, '')}</option>
                ))}
              </select>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setObjects([]); }}
                className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500"
              />
              <button
                onClick={listFiles}
                disabled={!selectedLog || !selectedBucket}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-semibold rounded-md transition-colors"
              >
                List files
              </button>
            </div>

            {metaLoading && <span className="text-[11px] text-slate-500 animate-pulse">loading…</span>}

            <button
              onClick={signOut}
              title="Sign out"
              className="flex items-center gap-1.5 text-[11px] text-green-400 hover:text-slate-300"
            >
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Signed in
            </button>
          </>
        )}

        {loadedLabel && <span className="text-xs text-slate-500 truncate max-w-[220px]">{loadedLabel}</span>}

        {stats && (
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span>{stats.total.toLocaleString()} entries</span>
            {stats.errors > 0 && <span className="text-red-400">{stats.errors} errors</span>}
            {stats.warns > 0 && <span className="text-yellow-400">{stats.warns} warnings</span>}
          </div>
        )}

        {loading && <span className="text-xs text-slate-500 ml-2 animate-pulse">Loading…</span>}
      </header>

      {/* ── File list (after List files) ── */}
      {objects.length > 0 && (
        <div className="px-4 py-2.5 bg-slate-900/60 border-b border-slate-800 shrink-0">
          {/* summary row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-300">
              {selectedLog.replace(/\/$/, '')} · {date}
            </span>
            <span className="text-[11px] text-slate-500">
              {objects.length} file{objects.length === 1 ? '' : 's'} · {formatSize(totalSize)}
            </span>
            <span className="text-[10px] text-slate-600">(max {MAX_OBJECT_BYTES / 1024 / 1024} MB/file)</span>

            {cacheInfo.count > 0 && (
              <button
                onClick={handleClearCache}
                title="Clear locally cached files (IndexedDB)"
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-red-300 border border-slate-700 hover:border-red-800 rounded transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
                Clear cache · {cacheInfo.count} · {formatSize(cacheInfo.bytes)}
              </button>
            )}

            <button
              onClick={loadAll}
              disabled={loading || loadableObjects.length === 0}
              className="ml-auto px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold rounded-md transition-colors"
            >
              Load all ({loadableObjects.length})
            </button>
          </div>

          {/* overall progress bar (while loading) */}
          {overallProgress && (
            <div className="mb-2">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Downloading {overallProgress.done}/{overallProgress.total}…</span>
                <span>{overallProgress.pct}%</span>
              </div>
              <div className="h-1 bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${overallProgress.pct}%` }} />
              </div>
            </div>
          )}

          {/* file grid */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5 max-h-44 overflow-y-auto">
            {objects.map((o) => {
              const tooBig = o.size > MAX_OBJECT_BYTES;
              const st = fileStatus[o.name];
              const state: FileState = tooBig ? 'skipped' : st?.state ?? 'idle';
              const dlPct = st?.total ? Math.min(100, Math.round(((st.received ?? 0) / st.total) * 100)) : 0;
              const subtle =
                state === 'error'   ? 'text-red-400' :
                state === 'cached'  ? 'text-emerald-400' :
                state === 'done'    ? 'text-blue-400' :
                tooBig              ? 'text-red-400' : 'text-slate-500';
              return (
                <button
                  key={o.name}
                  onClick={() => loadObjects([o], hourRange(o.name))}
                  disabled={tooBig || loading}
                  title={tooBig
                    ? `${formatSize(o.size)} — exceeds ${MAX_OBJECT_BYTES / 1024 / 1024} MB limit`
                    : st?.error
                      ? `${fileLabel(o.name)} — ${st.error}`
                      : `${fileLabel(o.name)} · ${formatSize(o.size)}${state === 'cached' ? ' · cached' : ''}`}
                  className={`group relative flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-left transition-colors overflow-hidden ${
                    tooBig
                      ? 'bg-slate-900 border-slate-800 cursor-not-allowed opacity-60'
                      : state === 'cached'
                        ? 'bg-slate-800 border-emerald-900 hover:border-emerald-600'
                        : 'bg-slate-800 border-slate-700 hover:border-blue-600 hover:bg-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 font-mono">{hourRange(o.name)}</div>
                    <div className={`text-[10px] ${subtle}`}>
                      {formatSize(o.size)}
                      {tooBig && ' · too large'}
                      {state === 'cached' && ' · cached'}
                      {state === 'done' && ' · loaded'}
                      {state === 'downloading' && ` · ${dlPct}%`}
                      {state === 'error' && ' · failed'}
                    </div>
                  </div>

                  {/* trailing status icon */}
                  {state === 'downloading' ? (
                    <svg className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : state === 'cached' || state === 'done' ? (
                    <svg className={`w-3.5 h-3.5 shrink-0 ${state === 'cached' ? 'text-emerald-400' : 'text-blue-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : state === 'error' ? (
                    <svg className="w-3.5 h-3.5 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  ) : !tooBig ? (
                    <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  ) : null}

                  {/* per-file progress underline */}
                  {state === 'downloading' && (
                    <span className="absolute left-0 bottom-0 h-0.5 bg-blue-500 transition-all" style={{ width: `${dlPct}%` }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

        <TimeFilter value={timeRange} onChange={setTimeRange} anchorTs={maxTs} minTs={minTs} />

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
        {error && (
          <div className="m-4 px-3 py-2 bg-red-950/60 border border-red-800 rounded text-xs text-red-300 whitespace-pre-wrap">
            {error}
          </div>
        )}
        {allLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500 px-6 text-center">
            <svg className="w-14 h-14 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {!GOOGLE_CLIENT_ID ? (
              <div className="text-sm max-w-md">
                Set <span className="font-mono text-slate-300">NEXT_PUBLIC_GOOGLE_CLIENT_ID</span> in
                <span className="font-mono text-slate-300"> .env.local</span> (see README) and restart, then
                sign in to browse your <span className="font-mono text-slate-300">*{BUCKET_SUFFIX}</span> buckets.
              </div>
            ) : !token ? (
              <div className="text-sm">
                <span className="text-slate-300 font-medium">Sign in with Google</span> to choose a project,
                a <span className="font-mono text-slate-300">*{BUCKET_SUFFIX}</span> bucket, and browse logs.
              </div>
            ) : !selectedBucket ? (
              <div className="text-sm">
                Choose a <span className="text-slate-300 font-medium">project</span> and
                <span className="text-slate-300 font-medium"> bucket</span> above to begin.
              </div>
            ) : (
              <div className="text-sm">
                Pick a log and date, then <span className="text-slate-300 font-medium">List files</span> and load one.
              </div>
            )}
            <p className="text-xs text-slate-600 max-w-md">
              Reads directly from the GCS bucket with your own Google account — your IAM
              permissions apply. Sink files are written in hourly batches, so the latest
              entries may lag.
            </p>
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
