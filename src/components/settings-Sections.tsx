"use client";
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
type Section = { id: string; label: string };
const Context = createContext<{ active: string; prefix: string; readOnly: boolean } | null>(null);
export function SettingsSections({ sections, children, readOnly = false, label = '设置小节' }: { sections: Section[]; children: ReactNode; readOnly?: boolean; label?: string }) {
  const [selected, setSelected] = useState(sections[0]?.id ?? '');
  const prefix = useId();
  const active = sections.some(s => s.id === selected) ? selected : sections[0]?.id ?? '';
  return <Context.Provider value={{ active, prefix, readOnly }}>
    <div className="grid items-start gap-4 md:grid-cols-[168px_minmax(0,1fr)]">
      <aside className="min-w-0 md:sticky md:top-24">
        <label className="block md:hidden text-xs text-muted-foreground mb-2" htmlFor={`${prefix}-select`}>{label}</label>
        <select id={`${prefix}-select`} className="w-full md:hidden rounded-lg border border-border bg-background p-3 text-sm" value={active} onChange={e => setSelected(e.target.value)}>{sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <nav aria-label={label} className="hidden md:flex flex-col gap-1 rounded-xl border border-border/60 bg-secondary/20 p-2">
          {sections.map(s => <button key={s.id} id={`${prefix}-nav-${s.id}`} type="button" aria-current={active === s.id ? 'page' : undefined} aria-controls={`${prefix}-panel-${s.id}`} onClick={() => setSelected(s.id)} className={cn('rounded-lg px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active === s.id ? 'bg-background text-primary font-semibold shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>{s.label}</button>)}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  </Context.Provider>;
}
export function SettingsSection({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('SettingsSection requires SettingsSections');
  const visible = ctx.active === id;
  // Keep panels mounted to preserve local drafts and avoid re-fetching when switching sections.
  return <section id={`${ctx.prefix}-panel-${id}`} aria-labelledby={`${ctx.prefix}-nav-${id}`} hidden={!visible} style={!visible ? { display: 'none' } : undefined}><fieldset disabled={ctx.readOnly || !visible} className="min-w-0 space-y-4">{children}</fieldset></section>;
}
