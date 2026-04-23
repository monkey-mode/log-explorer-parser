import { useState } from 'react';
import type { OSConfig } from '../lib/opensearch';
import { saveConfig, testConnection, DEFAULT_CONFIG } from '../lib/opensearch';

interface Props {
  initial: Partial<OSConfig>;
  onSaved: (config: OSConfig) => void;
}

export function Settings({ initial, onSaved }: Props) {
  const [form, setForm] = useState<Partial<OSConfig>>({ ...DEFAULT_CONFIG, ...initial });
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof OSConfig, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    if (!form.baseUrl?.trim()) return 'Base URL is required.';
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
      setStatus({ ok: false, msg: `Connection failed: ${(e as Error).message}` });
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

  const Field = ({
    label, field, type = 'text', placeholder,
  }: { label: string; field: keyof OSConfig; type?: string; placeholder?: string }) => (
    <div>
      <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={(form[field] as string) ?? ''}
        onChange={(e) => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 outline-none focus:border-blue-500 transition-colors placeholder-slate-500"
        autoComplete="off"
      />
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-auto">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span className="font-bold text-white text-[15px]">Log Explorer</span>
        <span className="ml-1 text-xs text-slate-500">— Setup</span>
      </header>

      <div className="p-4 flex flex-col gap-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          Connect to your OpenSearch instance. The extension queries directly — no export needed.
        </p>

        <Field
          label="OpenSearch Base URL *"
          field="baseUrl"
          type="url"
          placeholder="https://opensearch.internal.example.com"
        />

        <Field
          label="Index Pattern *"
          field="indexPattern"
          placeholder="logs-mfoa-uat-gke-1-uat*"
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Username (optional)" field="username" placeholder="admin" />
          <Field label="Password (optional)" field="password" type="password" placeholder="••••••" />
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

        {/* Status message */}
        {status && (
          <p className={`text-xs px-3 py-2 rounded-md ${status.ok ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
            {status.msg}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
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
