'use client';
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Combobox, type ComboOption } from '@/components/ui/combobox';

/** Plain text of a React node (option labels are strings, numbers or a few of them side by side). */
function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return '';
}

/** <option> elements (also inside fragments and mapped arrays) to combobox options. */
function optionsOf(children: ReactNode): ComboOption[] {
  const out: ComboOption[] = [];
  Children.toArray(children).forEach((c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode }>;
    if (el.type === 'option') out.push({ value: String(el.props.value ?? text(el.props.children)), label: text(el.props.children) });
    else if (el.type === Fragment) out.push(...optionsOf(el.props.children));
  });
  return out;
}

/** Only layout classes of the old <select> survive (width, margins, grid / flex placement); the look comes from the Combobox. */
const LAYOUT = /^(?:[a-z]+:)*(?:w-|min-w-|max-w-|m[lrtbxy]?-|flex-|grow|shrink|col-|row-|self-|justify-self)/;
const layoutOnly = (className?: string) => (className ?? '').split(/\s+/).filter((c) => LAYOUT.test(c)).join(' ');

/**
 * Drop-in replacement for a native <select value onChange> with <option> children: same props, but searchable and styled like the
 * rest of the app. `onChange` receives `{ target: { value } }`, so existing handlers keep working unchanged.
 */
export function SelectBox({ value, onChange, children, className, disabled, ...aria }: {
  value?: string | number | null; onChange?: (e: { target: { value: string } }) => void; children?: ReactNode; className?: string; disabled?: boolean; 'aria-label'?: string; title?: string;
}) {
  return (
    <Combobox value={String(value ?? '')} options={optionsOf(children)} disabled={disabled} aria-label={aria['aria-label']}
      className={layoutOnly(className) || 'min-w-36'} onChange={(v) => onChange?.({ target: { value: v } })} />
  );
}
