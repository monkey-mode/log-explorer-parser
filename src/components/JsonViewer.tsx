'use client';

import { useState } from 'react';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface Props {
  value: JsonValue;
  depth?: number;
}

export function JsonViewer({ value, depth = 0 }: Props) {
  const [collapsed, setCollapsed] = useState(depth >= 2);

  if (value === null) return <span className="text-purple-400">null</span>;
  if (typeof value === 'boolean') return <span className="text-sky-300">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-orange-300">{value}</span>;

  if (typeof value === 'string') {
    // Detect and re-parse nested JSON strings
    const trimmed = value.trim();
    if (
      depth < 4 &&
      trimmed.length > 2 &&
      (trimmed.startsWith('{') || trimmed.startsWith('['))
    ) {
      try {
        const nested = JSON.parse(trimmed) as JsonValue;
        return (
          <span>
            <span className="text-slate-500 text-xs italic mr-1">[nested JSON]</span>
            <JsonViewer value={nested} depth={depth} />
          </span>
        );
      } catch {
        /* not JSON */
      }
    }
    return (
      <span className="text-green-300 break-all">
        &quot;{value}&quot;
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          {collapsed ? (
            <span className="text-slate-500">[{value.length} items…]</span>
          ) : (
            '['
          )}
        </button>
        {!collapsed && (
          <>
            <div className="ml-4 border-l border-slate-700 pl-3">
              {value.map((item, i) => (
                <div key={i} className="my-0.5">
                  <JsonViewer value={item as JsonValue} depth={depth + 1} />
                  {i < value.length - 1 && <span className="text-slate-600">,</span>}
                </div>
              ))}
            </div>
            <span className="text-slate-400">]</span>
          </>
        )}
      </span>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return <span className="text-slate-400">{'{}'}</span>;
    const obj = value as Record<string, JsonValue>;
    return (
      <span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          {collapsed ? (
            <span className="text-slate-500">
              {'{'}{keys.length} keys…{'}'}
            </span>
          ) : (
            '{'
          )}
        </button>
        {!collapsed && (
          <>
            <div className="ml-4 border-l border-slate-700 pl-3">
              {keys.map((k, i) => (
                <div key={k} className="my-0.5">
                  <span className="text-red-300">&quot;{k}&quot;</span>
                  <span className="text-slate-400">: </span>
                  <JsonViewer value={obj[k]} depth={depth + 1} />
                  {i < keys.length - 1 && <span className="text-slate-600">,</span>}
                </div>
              ))}
            </div>
            <span className="text-slate-400">{'}'}</span>
          </>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}
