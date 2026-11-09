'use client';
import { COLUMN_MODULE, columnKey, PERMISSION_ACTIONS, TABLE_COLUMNS, type TableName } from '@costing/config';

export interface CatalogEntry { key: string; module: string; action: string }
export type Cell = 'none' | 'allow' | 'deny';

/** Module × action grid. `mode="override"` cycles none → allow → deny; `mode="grant"` toggles on/off. */
export function PermissionMatrix({ catalog, value, onChange, mode, inherited, disabled }: {
  catalog: CatalogEntry[];
  value: Record<string, Cell>;
  onChange: (key: string, next: Cell) => void;
  mode: 'grant' | 'override';
  inherited?: Set<string>;
  disabled?: boolean;
}) {
  const modules = [...new Set(catalog.map((c) => c.module))].filter((m) => m !== COLUMN_MODULE); // columns have their own card
  const keys = new Set(catalog.map((c) => c.key));
  const next = (c: Cell): Cell => (mode === 'grant' ? (c === 'allow' ? 'none' : 'allow') : c === 'none' ? 'allow' : c === 'allow' ? 'deny' : 'none');

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-center text-xs">
        <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Module</th>{PERMISSION_ACTIONS.map((a) => <th key={a} className="p-2">{a.replace('_', ' ')}</th>)}</tr></thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m} className="border-t border-slate-100">
              <td className="px-2 py-1 text-left font-medium">{m.replace(/_/g, ' ')}</td>
              {PERMISSION_ACTIONS.map((a) => {
                const k = `${m}:${a}`;
                if (!keys.has(k)) return <td key={a} />;
                const c = value[k] ?? 'none';
                const inh = inherited?.has(k);
                return (
                  <td key={a} className="p-1">
                    <button type="button" disabled={disabled} onClick={() => onChange(k, next(c))} aria-label={`${k} ${c}`}
                      className={`h-7 w-9 rounded border text-sm ${c === 'allow' ? 'border-green-600 bg-green-100 text-green-800' : c === 'deny' ? 'border-red-600 bg-red-100 text-red-800' : inh ? 'border-dashed border-green-500 text-green-600' : 'border-slate-200 text-slate-300'}`}>
                      {c === 'allow' ? '✓' : c === 'deny' ? '✕' : inh ? '•' : '–'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Which columns of each money table are shown, one tick per column. Shares the value / onChange of the permission grid,
 * so a role or user is saved in one go. `inherited` marks columns a user already gets from a role.
 */
export function ColumnAccess({ value, onChange, mode, inherited, disabled }: {
  value: Record<string, Cell>; onChange: (key: string, next: Cell) => void; mode: 'grant' | 'override'; inherited?: Set<string>; disabled?: boolean;
}) {
  const next = (c: Cell): Cell => (mode === 'grant' ? (c === 'allow' ? 'none' : 'allow') : c === 'none' ? 'allow' : c === 'allow' ? 'deny' : 'none');
  return (
    <div className="space-y-2">
      {(Object.entries(TABLE_COLUMNS) as [TableName, (typeof TABLE_COLUMNS)[TableName]][]).map(([table, def]) => (
        <div key={table} className="rounded-lg border border-slate-200 p-2">
          <div className="mb-1 text-xs font-semibold text-slate-700">{def.label}</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(def.columns).map(([col, label]) => {
              const k = columnKey(table, col);
              const c = value[k] ?? 'none';
              const inh = inherited?.has(k);
              const on = c === 'allow' || (c === 'none' && inh);
              return (
                <button key={k} type="button" disabled={disabled} onClick={() => onChange(k, next(c))} aria-label={`${def.label}: ${label} ${c}`} aria-pressed={on}
                  className={`rounded border px-2 py-0.5 text-xs ${c === 'allow' ? 'border-green-600 bg-green-100 text-green-800' : c === 'deny' ? 'border-red-600 bg-red-100 text-red-800 line-through' : inh ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-200 text-slate-400'}`}>
                  {c === 'allow' ? '✓ ' : c === 'deny' ? '✕ ' : inh ? '• ' : ''}{label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">{mode === 'grant' ? 'Ticked columns are shown to this role on screen and in exports.' : 'Click to allow (✓) or hide (✕) a column for this user; • means the user already gets it from a role.'}</p>
    </div>
  );
}

