import React, { useEffect, useState } from 'react';
import { Activity, Command, FileText, FolderOpen, LayoutGrid, Search, Settings2, X } from 'lucide-react';

export function Button({ variant = 'primary', className = '', children, ...props }) {
  return <button className={`ds-button ds-button-${variant} ${className}`} {...props}>{children}</button>;
}

export function Input(props) { return <input className={`ds-input ${props.className || ''}`} {...props} />; }
export function Select(props) { return <select className={`ds-select ${props.className || ''}`} {...props} />; }
export function Badge({ tone = 'neutral', children }) { return <span className={`ds-badge ds-badge-${tone}`}>{children}</span>; }
export function Panel({ elevation = 1, className = '', children, ...props }) { return <section className={`ds-panel ds-elevation-${elevation} ${className}`} {...props}>{children}</section>; }
export function Table({ children, ...props }) { return <div className="ds-table-frame"><table className="ds-table" {...props}>{children}</table></div>; }
export function Tabs({ items, value, onChange, label = 'Sections' }) {
  return <div className="ds-tabs" role="tablist" aria-label={label}>{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
export function ProgressTrack({ value, max = 100, label }) {
  const progress = Math.max(0, Math.min(100, max ? value / max * 100 : 0));
  return <div className="ds-progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin="0" aria-valuemax={max}><span style={{ width: `${progress}%` }} /></div>;
}
export function ChartFrame({ title, children }) { return <div className="ds-chart-frame"><div className="ds-chart-title">{title}</div>{children}</div>; }
export function EmptyState({ title, children, action }) { return <div className="ds-empty-state"><span className="ds-empty-mark"><FileText size={20} /></span><strong>{title}</strong><p>{children}</p>{action}</div>; }

const items = [
  { name: 'Overview', icon: LayoutGrid },
  { name: 'Reviews', icon: FileText },
  { name: 'Approved sources', icon: FolderOpen },
  { name: 'Insights', icon: Activity },
  { name: 'Settings', icon: Settings2 },
];

export function Rail({ view, onChange, user, onSignOut, expanded, onToggle, onCommand }) {
  const email = user.email || '';
  const initials = email.slice(0, 1).toUpperCase() || 'C';
  return <>
    <aside className={`workspace-rail ${expanded ? 'rail-expanded' : ''}`} aria-label="Workspace navigation">
      <div className="rail-brand-row"><a className="rail-brand" href="/" aria-label="Cleared home"><span className="brand-mark">✓</span>{expanded && <span>cleared<span className="brand-period">.</span></span>}</a><button className="rail-toggle" onClick={onToggle} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded}>⇥</button></div>
      <div className="rail-workspace"><span className="rail-avatar">{initials}</span>{expanded && <span className="rail-workspace-label"><strong>{user.workspace?.name || email.split('@')[0]}</strong><small>{user.role?.replace('_', ' ')}</small></span>}</div>
      <nav className="rail-nav" aria-label="Workspace">
        {items.map(({ name, icon: Icon }) => <button key={name} title={!expanded ? name : undefined} aria-current={view === name ? 'page' : undefined} className={`rail-item ${view === name ? 'active' : ''}`} onClick={() => onChange(name)}><Icon size={19} strokeWidth={1.8} /><span>{name}</span></button>)}
      </nav>
      <div className="rail-bottom"><button className="rail-item rail-command" onClick={onCommand} title="Open command menu"><Command size={18} /><span>Quick actions <kbd>⌘ K</kbd></span></button><button className="rail-account" onClick={onSignOut} title="Sign out"><span className="rail-account-avatar">{email.slice(0, 2).toUpperCase()}</span>{expanded && <span className="rail-account-label"><strong>{email}</strong><small>Sign out</small></span>}</button></div>
    </aside>
    <nav className="mobile-rail" aria-label="Mobile workspace navigation">{items.slice(0, 4).map(({ name, icon: Icon }) => <button key={name} aria-current={view === name ? 'page' : undefined} onClick={() => onChange(name)}><Icon size={19} /><span>{name === 'Approved sources' ? 'Sources' : name}</span></button>)}</nav>
  </>;
}

export function CommandPalette({ open, onClose, onChoose, onNewReview }) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const handle = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, onClose]);
  if (!open) return null;
  const actions = [...items.map((item) => ({ label: `Open ${item.name}`, run: () => onChoose(item.name) })), { label: 'Start a new review', run: onNewReview }].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Quick actions"><div className="command-search"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions" /><button onClick={onClose} aria-label="Close"><X size={18} /></button></div><p className="command-caption">QUICK ACTIONS</p>{actions.length ? actions.map((item) => <button className="command-option" key={item.label} onClick={item.run}>{item.label}<span>↵</span></button>) : <p className="command-none">No matching actions.</p>}<footer><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>esc</kbd> to close</span></footer></section></div>;
}
