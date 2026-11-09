'use client';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterOptions, moveIndex, splitMatch, type ComboOption } from '@/lib/combobox-filter';
import { cn } from '@/lib/utils';

export type { ComboOption };

export interface ComboboxProps {
  value: string;
  onChange: (value: string, option?: ComboOption) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** show a clear button while something is selected */
  clearable?: boolean;
  /** the search box is shown when there are more than this many options (default 6); a short list is just a list */
  searchAbove?: number;
  /** adds a "+ Add new" row at the bottom (and offers the typed text) */
  addNew?: { label: string; onAdd: (typed: string) => void };
  className?: string;
  'aria-label'?: string;
}

interface Pos { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/**
 * Searchable dropdown. Type to narrow the list (all words must match the label or code), arrow keys / Home / End / Enter / Escape /
 * Tab work as expected, the list is drawn in a portal so drawers and scrolling tables never clip it, and it opens upwards when
 * there is more room above.
 */
export function Combobox({ value, onChange, options, placeholder = 'Select…', disabled, loading, clearable, searchAbove = 6, addNew, className, ...aria }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const selected = options.find((o) => o.value === value);
  const showSearch = options.length > searchAbove;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 && above > below;
    const width = Math.max(r.width, 220);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setPos(up ? { left, width, bottom: window.innerHeight - r.top + 2, maxHeight: Math.min(320, above) } : { left, width, top: r.bottom + 2, maxHeight: Math.min(320, below) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, shown.length]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) place(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true); document.removeEventListener('pointerdown', onDown); };
  }, [open, place]);

  // the list is drawn once its position is known, so focus it then (not when `open` flips): keys typed right after opening go to it
  const placed = pos !== null;
  useEffect(() => { if (!open) setPos(null); }, [open]);
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open || !placed) return;
    (showSearch ? search.current : list.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placed]);
  useEffect(() => { setActive(shown.length ? 0 : -1); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const close = (refocus = true) => { setOpen(false); setQuery(''); if (refocus) trigger.current?.focus(); };
  const pick = (o: ComboOption) => { onChange(o.value, o); close(); };
  const add = () => { if (!addNew) return; const typed = query.trim(); close(false); addNew.onAdd(typed); };

  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => moveIndex(a, 1, shown.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => moveIndex(a, -1, shown.length)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(shown.length ? 0 : -1); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); else if (addNew && !shown.length) add(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && showSearch) { setQuery(e.key); setOpen(true); e.preventDefault(); }
  };

  return (
    <>
      <span className={cn('relative block', className)}>
        <button ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={aria['aria-label']}
          disabled={disabled} onClick={() => !disabled && setOpen((o) => !o)} onKeyDown={onTriggerKey}
          className={cn('flex h-9 w-full items-center gap-1 rounded-md border border-slate-300 bg-white pl-2.5 pr-1.5 text-left text-sm outline-none transition-colors',
            'focus-visible:border-primary-600 focus-visible:ring-2 focus-visible:ring-primary-600/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400', open && 'border-primary-600')}>
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-slate-400')}>{selected ? selected.label : placeholder}</span>
          {clearable && value && !disabled && (
            <span role="button" tabIndex={-1} aria-label="Clear" className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onChange(''); }}><X size={13} /></span>
          )}
          <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
        </button>
      </span>
      {open && pos && createPortal(
        <div ref={panel} onKeyDown={onKeys} style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          className="z-[70] flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {showSearch && (
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to search…" role="combobox" aria-expanded="true" aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${uid}-o${active}` : undefined} aria-autocomplete="list" autoComplete="off"
              className="h-9 w-full shrink-0 border-0 border-b border-slate-200 px-2.5 text-sm outline-none focus:shadow-none" />
          )}
          <div ref={list} id={listId} role="listbox" tabIndex={showSearch ? -1 : 0} aria-activedescendant={!showSearch && active >= 0 ? `${uid}-o${active}` : undefined} className="min-h-0 flex-1 overflow-y-auto py-1 outline-none">
            {loading && <div className="px-2.5 py-1.5 text-slate-500">Loading…</div>}
            {!loading && shown.length === 0 && <div className="px-2.5 py-1.5 text-slate-500">{options.length ? 'No matches' : 'Nothing to choose from yet'}</div>}
            {shown.map((o, i) => {
              const m = splitMatch(o.label, query);
              return (
                <div key={o.value || `_${i}`} id={`${uid}-o${i}`} data-index={i} role="option" aria-selected={o.value === value}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseMove={() => setActive(i)}
                  className={cn('flex cursor-pointer items-center gap-2 px-2.5 py-1', i === active && 'bg-primary-50', o.value === value && 'font-medium text-primary-700')}>
                  <span className="min-w-0 flex-1 truncate">{m ? <>{m.before}<mark className="bg-transparent font-semibold text-primary-700 underline decoration-primary-300">{m.match}</mark>{m.after}</> : o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-slate-400">{o.hint}</span>}
                  {o.value === value && <Check size={13} className="shrink-0 text-primary-600" />}
                </div>
              );
            })}
          </div>
          {addNew && (
            <button type="button" onClick={add} className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-2.5 py-1.5 text-left font-medium text-primary-700 hover:bg-primary-50">
              <Plus size={14} />{query.trim() ? <span className="truncate">Add new {addNew.label} “{query.trim()}”</span> : <span>Add new {addNew.label}</span>}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
