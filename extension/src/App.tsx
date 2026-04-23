import { useEffect, useState } from 'react';
import type { OSConfig } from './lib/opensearch';
import { loadConfig } from './lib/opensearch';
import { Settings } from './components/Settings';
import { OpenSearchExplorer } from './components/OpenSearchExplorer';

type View = 'loading' | 'settings' | 'explorer';

export function App() {
  const [view, setView] = useState<View>('loading');
  const [config, setConfig] = useState<OSConfig | null>(null);

  useEffect(() => {
    loadConfig().then((saved) => {
      if (saved.baseUrl && saved.indexPattern) {
        setConfig(saved as OSConfig);
        setView('explorer');
      } else {
        setView('settings');
      }
    });
  }, []);

  const onSaved = (cfg: OSConfig) => {
    setConfig(cfg);
    setView('explorer');
  };

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-500 text-xs animate-pulse">
        Loading…
      </div>
    );
  }

  if (view === 'settings' || !config) {
    return <Settings initial={config ?? {}} onSaved={onSaved} />;
  }

  return (
    <OpenSearchExplorer
      config={config}
      onOpenSettings={() => setView('settings')}
    />
  );
}
