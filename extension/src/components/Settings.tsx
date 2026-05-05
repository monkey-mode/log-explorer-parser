import { useState, useEffect } from 'react';
import type { OSConfig } from '../lib/opensearch';
import { saveConfig, testConnection, getActiveTab, DEFAULT_CONFIG } from '../lib/opensearch';

interface Props {
  initial: Partial<OSConfig>;
  onSaved: (config: OSConfig) => void;
  onCancel?: () => void;
}

export function Settings({ initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<Partial<OSConfig>>({ ...DEFAULT_CONFIG, ...initial });
  const [tabOrigin, setTabOrigin] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Detect the current active tab's origin to show the user which OpenSearch instance will be used
  useEffect(() => {
    getActiveTab()
      .then((tab) => setTabOrigin(tab.url ? new URL(tab.url).origin : ''))
      .catch(() => setTabOrigin(''));
  }, []);

  const set = (k: keyof OSConfig, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    if (!form.indexPattern?.trim()) return 'Index pattern is required.';
    return null;
  };

  const handleTest = async () => {
    const err = validate();
    if (err) { setStatus({ ok: false, msg: err }); return; }
    setTesting(true);
    setStatus(null);
    try {
      const count = await testConnection(form as OSConfig);
      setStatus({ ok: true, msg: `✓ Connected — ${count.toLocaleString()} documents in index` });
    } catch (e) {
      setStatus({ ok: false, msg: `Failed: ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setStatus({ ok: false, msg: err }); return; }
    setSaving(true);
    await saveConfig(form);
    setSaving(false);
    onSaved(form as OSConfig);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-auto">
      <header className="flex items-center gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span className="font-bold text-white text-[15px]">Log Explorer</span>
        <span className="text-xs text-slate-500">— Setup</span>
      </header>

      <div className="p-4 flex flex-col gap-4">
        {/* How it works */}
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-md px-3 py-2.5 text-xs text-blue-300 leading-relaxed">
          <strong className="text-blue-200">No login required.</strong> The extension queries OpenSearch through the active
          tab's existing session. Make sure you are on the OpenSearch Dashboards page before fetching logs.
        </div>

        {/* Detected tab */}
        {tabOrigin && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <svg className="w-3.5 h-3.5 text-green-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Active tab: <span className="text-slate-200 font-mono">{tabOrigin}</span></span>
          </div>
        )}

        {/* Index pattern */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Index Pattern *</label>
          <input
            type="text"
            value={form.indexPattern ?? ''}
            onChange={(e) => set('indexPattern', e.target.value)}
            placeholder="logs-mfoa-uat-gke-1-uat*"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500 transition-colors placeholder-slate-500 font-mono"
          />
          <p className="mt-1 text-[10px] text-slate-500">Matches the index pattern shown in OpenSearch Dashboards</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Default Time Range</label>
            <select
              value={form.timeRange ?? 'now-15m'}
              onChange={(e) => set('timeRange', e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="now-15m">Last 15 min</option>
              <option value="now-30m">Last 30 min</option>
              <option value="now-1h">Last 1 hour</option>
              <option value="now-3h">Last 3 hours</option>
              <option value="now-12h">Last 12 hours</option>
              <option value="now-24h">Last 24 hours</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Max Results</label>
            <select
              value={form.size ?? 500}
              onChange={(e) => set('size', Number(e.target.value))}
              className="w-full px-2.5 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500"
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1 000</option>
              <option value={2000}>2 000</option>
            </select>
          </div>
        </div>

        {status && (
          <p className={`text-xs px-3 py-2 rounded-md ${
            status.ok
              ? 'bg-green-950 text-green-400 border border-green-800'
              : 'bg-red-950 text-red-400 border border-red-800'
          }`}>
            {status.msg}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-2 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-2 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 hover:text-white transition-colors disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-3 py-2 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Open Explorer'}
          </button>
        </div>
      </div>
    </div>
  );
}
