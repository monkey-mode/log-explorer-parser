import { useEffect, useState } from 'react';
import type { OSConfig } from './lib/opensearch';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './lib/opensearch';
import { Settings } from './components/Settings';
import { OpenSearchExplorer } from './components/OpenSearchExplorer';

type View = 'loading' | 'settings' | 'explorer';

export function App() {
  const [view, setView] = useState<View>('loading');
  const [config, setConfig] = useState<OSConfig | null>(null);

  useEffect(() => {
    loadConfig().then((saved) => {
      const cfg: OSConfig = {
        indexPattern: saved.indexPattern ?? DEFAULT_CONFIG.indexPattern,
        timeRange:    saved.timeRange    ?? DEFAULT_CONFIG.timeRange,
        size:         saved.size         ?? DEFAULT_CONFIG.size,
      };
      setConfig(cfg);
      saveConfig(cfg);
      setView('explorer');
    });
  }, []);

  const handleSaved = (cfg: OSConfig) => {
    setConfig(cfg);
    setView('explorer');
  };

  if (view === 'loading' || !config) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-500 text-xs animate-pulse">
        Loading…
      </div>
    );
  }

  if (view === 'settings') {
    return (
      <Settings
        initial={config}
        onSaved={handleSaved}
        onCancel={() => setView('explorer')}
      />
    );
  }

  return (
    <OpenSearchExplorer
      onOpenSettings={() => setView('settings')}
    />
  );
}
