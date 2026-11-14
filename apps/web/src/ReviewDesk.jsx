import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { apiFetchRecent } from './api.js';
import { ArrowRight, Check, Clock3, FileText, FolderOpen, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import './review-desk.css';

const columns = [
  { key: 'changes', status: 'Needs changes', icon: '!', color: '#c7245c', tone: 'changes' },
  { key: 'review', status: 'In review', icon: '◷', color: '#bf8612', tone: 'review' },
  { key: 'approved', status: 'Approved', icon: '✓', color: '#1f7a56', tone: 'approved' },
  { key: 'rejected', status: 'Rejected', icon: '×', color: '#6b6264', tone: 'rejected' },
];
const statusKey = { 'Needs changes': 'changes', 'In review': 'review', Approved: 'approved', Rejected: 'rejected' };
const sourceColors = ['#1d5b54', '#347464', '#5a8b78', '#7aa18d'];
const stamp = (value) => String(value || '—');

export default function ReviewDesk() {
  const pageRef = useRef(null);
  const [reviews, setReviews] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [activeSource, setActiveSource] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [account, setAccount] = useState(null);

  useEffect(() => {
    document.title = 'Cleared: Review desk';
    let active = true;
    Promise.all([
      fetch('/api/reviews').then((response) => { if (!response.ok) throw new Error('Could not load reviews.'); return response.json(); }),
      fetch('/api/sources').then((response) => { if (!response.ok) throw new Error('Could not load sources.'); return response.json(); }),
      fetch('/api/auth/session').then((response) => response.json()),
    ]).then(([reviewResult, sourceResult, sessionResult]) => {
      if (!active) return;
      setReviews(reviewResult.data || []);
      setSources(sourceResult.data || []);
      setAccount(sessionResult.user);
    }).catch(() => { if (active) setError('The workspace could not reach the API. Start the Node service and refresh.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || !pageRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('.hello > *', { y: 14, opacity: 0, duration: 0.48, stagger: 0.08, ease: 'power2.out' });
      gsap.from('.tray', { y: 16, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.12, ease: 'power2.out' });
    }, pageRef);
    return () => ctx.revert();
  }, [loading]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totals = useMemo(() => Object.fromEntries(columns.map(({ status, key }) => [key, reviews.filter((review) => review.status === status).length])), [reviews]);
  const teamRows = useMemo(() => {
    const teams = [...new Set(reviews.map((review) => review.team || 'Unassigned'))];
    return teams.map((team) => ({ team, rows: reviews.filter((review) => (review.team || 'Unassigned') === team) }));
  }, [reviews]);
  const visible = reviews.filter((review) => (!filter || review.status === filter) && `${review.title} ${review.owner} ${review.team}`.toLowerCase().includes(query.toLowerCase()));
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  async function updateStatus(review, status) {
    if (!review || saving || review.status === status) return;
    setSaving(true);
    try {
      const response = await apiFetchRecent(`/api/reviews/${review.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update this review.');
      setReviews((items) => items.map((item) => item.id === review.id ? result.data : item));
      setSelected(null);
      setToast(`“${review.title}” moved to ${status.toLowerCase()}.`);
    } catch (cause) { setToast(cause.message || 'Could not save that decision.'); }
    finally { setSaving(false); setDragged(null); }
  }

  return <main className="review-desk" ref={pageRef}>
    <header className="desk-bar"><div className="desk-brand"><a className="desk-logo" href="/"><span><Check size={17}/></span>cleared</a><span className="workspace-switch"><b>{account?.email?.slice(0,1).toUpperCase() || "U"}</b>{account?.workspace?.name || "Workspace"}</span></div><nav className="desk-nav" aria-label="Workspace navigation"><a href="/dashboard">Overview</a><a className="selected" href="/workspace">Reviews</a><a href="/workspace#sources">Approved sources</a><a href="/app">Claim checking status</a></nav><div className="desk-tools"><span className="desk-demo">{account?.email || "Workspace"}</span><a className="desk-help" href="/workspace" aria-label="Open review workspace"><FileText size={17}/></a></div></header>
    <div className="governance-wrap" id="top">
      <section className="hello"><div><div className="desk-date"><i/>{dateLabel}<span>·</span>Review workspace</div><h1>Your content, <em>cleared.</em></h1><p className="desk-summary">{reviews.length ? <>{totals.review} {totals.review === 1 ? 'review is' : 'reviews are'} with reviewers, {totals.changes} need a second look, and {totals.approved} {totals.approved === 1 ? 'is' : 'are'} approved.{totals.rejected > 0 && <> {totals.rejected} {totals.rejected === 1 ? 'was' : 'were'} rejected.</>}</> : 'A shared desk for every draft, source, and human decision.'}</p></div><a className="new-review" href="/dashboard?new=review"><span>+</span>New review<ArrowRight size={17}/></a></section>
      {error && <div className="desk-error" role="alert">{error}</div>}
      {loading ? <div className="desk-loading" role="status">Getting the desk ready…</div> : <>
        <section className="review-board" aria-labelledby="board-title">
          <div className="board-tools"><label className="desk-search"><Search size={18}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reviews, people or teams" aria-label="Search reviews, people or teams"/></label><span className="drag-hint"><Sparkles size={15}/>Pick a card. Move it when it’s ready.</span></div>
          <div className="status-trays" aria-label="Filter or drop reviews by status">{columns.filter((column) => column.key !== 'rejected' || totals.rejected > 0).map((column) => {
            const items = reviews.filter((review) => review.status === column.status);
            return <button type="button" key={column.key} className={`tray tray-${column.tone} ${filter === column.status ? 'tray-active' : ''} ${dragged ? 'tray-drop-ready' : ''}`} style={{ '--tray-color': column.color }} onClick={() => setFilter(filter === column.status ? '' : column.status)} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('tray-over'); }} onDragLeave={(event) => event.currentTarget.classList.remove('tray-over')} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('tray-over'); updateStatus(dragged, column.status); }} aria-pressed={filter === column.status}>
              <span className="tray-top"><span className="tray-icon">{column.icon}</span><span>{column.status}</span><span className="tray-total">{items.length}</span></span>
              <span className="tray-fan" aria-hidden="true">{items.slice(0, 3).map((item, index) => <i key={item.id} style={{ '--fan-index': index }}>{item.title}</i>)}{items.length === 0 && <i className="tray-empty-note">Ready for a draft</i>}</span>
              <span className="tray-hint">{dragged ? 'Drop to update status' : filter === column.status ? 'Showing this status · click to clear' : 'Click to filter · drag here to update'}</span>
            </button>;
          })}</div>
          <div className="desk-head"><div><h2 id="board-title">{filter ? `${filter} desk` : 'Your review desk'}</h2><p>{filter ? 'Showing one status. Select its tray again to see all reviews.' : 'A little paper shuffling goes a long way.'}</p></div><div className="desk-progress"><span><b>{totals.approved}</b> of {reviews.length} approved</span><div className="progress-track"><i style={{ width: `${reviews.length ? totals.approved / reviews.length * 100 : 0}%` }}/></div><button type="button" onClick={() => setFilter('')} hidden={!filter}>Show all</button></div></div>
          <div className="review-cards">{visible.length ? visible.map((review, index) => <article key={review.id} className={`review-paper paper-${statusKey[review.status] || 'review'} ${dragged?.id === review.id ? 'paper-dragging' : ''}`} style={{ '--paper-tilt': `${[-1.2, .8, -.5, 1.1, -.8][index % 5]}deg`, '--paper-index': index }} draggable onDragStart={(event) => { setDragged(review); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', review.id); }} onDragEnd={() => setDragged(null)} onClick={() => setSelected(review)} onKeyDown={(event) => event.key === 'Enter' && setSelected(review)} tabIndex={0} role="button" aria-label={`${review.title}, ${review.status}. Open details or drag to another status.`}>
              <i className="paper-hole"/><span className={`paper-status status-${statusKey[review.status] || 'review'}`}><i/>{review.status}</span><h3>{review.title}</h3><p>{review.owner} <b>·</b> {review.team}</p><p className="paper-date"><Clock3 size={13}/>{stamp(review.date)}</p>{review.findings > 0 && <span className="paper-attention">{review.findings} {review.findings === 1 ? 'finding' : 'findings'}</span>}<span className="paper-id">{review.id}</span>
            </article>) : <div className="desk-empty"><FolderOpen size={23}/><strong>No cards on this part of the desk.</strong><span>Clear the filter or send in a new review.</span><a href="/workspace">Start a review<ArrowRight size={15}/></a></div>}</div>
        </section>
        <section className="bottom-panels">
          <div className="source-panel" id="sources"><div className="section-heading"><div><span className="panel-eyebrow">REFERENCE SHELF</span><h2>Brand guidance</h2><p>Approved sources the team can reach for.</p></div><a href="/workspace" className="panel-link">Manage sources<ArrowRight size={15}/></a></div>
            {sources.length ? <div className="source-shelf">{sources.map((source, index) => <button type="button" className={`source-book ${activeSource?.id === source.id ? 'book-selected' : ''}`} key={source.id} style={{ '--book-color': sourceColors[index % sourceColors.length], '--book-height': `${146 + (index % 3) * 15}px` }} onClick={() => setActiveSource(source)} title={`${source.name} · ${source.category}`}><span>{source.type || 'DOC'}</span><b>{source.name}</b><i>{source.category}</i></button>)}</div> : <p className="source-empty">No approved sources yet. Add one from the review workspace.</p>}
            <div className="source-detail" aria-live="polite">{activeSource ? <><strong>{activeSource.name}</strong><span>{activeSource.category} · {activeSource.updated}</span></> : <><strong>{sources.length} approved {sources.length === 1 ? 'source' : 'sources'}</strong><span>Select a volume to see its collection and update date.</span></>}</div>
          </div>
          <div className="pulse-panel"><div className="section-heading"><div><span className="panel-eyebrow">CURRENT QUEUE</span><h2>Team review mix</h2><p>Current reviews by team and decision.</p></div><span className="pulse-mark"><i/>NOW</span></div><div className="pulse-legend">{columns.map((column) => <span key={column.key}><i style={{ '--legend-color': column.color }}/>{column.status}</span>)}</div><div className="team-pulse">{teamRows.length ? teamRows.map(({ team, rows }) => <div className="team-pulse-row" key={team}><div><span>{team}</span><b>{rows.length}</b></div><div className="team-pulse-track" aria-label={`${team}: ${rows.map((row) => row.status).join(', ')}`}>{columns.map((column) => { const value = rows.filter((row) => row.status === column.status).length; return value ? <i key={column.key} style={{ width: `${value / rows.length * 100}%`, '--segment-color': column.color }} title={`${value} ${column.status}`}/> : null; })}</div></div>) : <p className="source-empty">Team activity will show when reviews arrive.</p>}</div><p className="pulse-foot"><ShieldCheck size={15}/>Every decision stays with a person.</p></div>
        </section>
      </>}
      <footer className="desk-footer"><span><ShieldCheck size={15}/>Evidence helps. People decide.</span><span>Workspace data comes from the Cleared API.</span></footer>
    </div>
    {selected && <ReviewDetails review={selected} busy={saving} onClose={() => setSelected(null)} onDecision={(status) => updateStatus(selected, status)}/>}
    {toast && <div className="governance-toast" role="status">{toast}</div>}
  </main>;
}

function ReviewDetails({ review, busy, onClose, onDecision }) {
  const choices = ['In review', 'Needs changes', 'Approved', 'Rejected'];
  const [history,setHistory]=useState(null); const [historyError,setHistoryError]=useState('');
  useEffect(()=>{let active=true;setHistory(null);setHistoryError('');apiFetchRecent(`/api/reviews/${encodeURIComponent(review.id)}/history`).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'History could not be loaded.');if(active)setHistory(result.data);}).catch(error=>{if(active)setHistoryError(error.message);});return()=>{active=false;};},[review.id]);
  const timeline=[...(history?.revisions||[]).map(item=>({kind:'revision',at:item.createdAt,label:`Revision ${item.revision} · edited by ${item.editor}`})),...(history?.events||[]).filter(item=>item.action.startsWith('review.')&&!['review.approved','review.rejected','review.needs_changes'].includes(item.action)).map(item=>({kind:'event',at:item.occurredAt,label:historyEventLabel(item)})),...(history?.decisions||[]).map(item=>({kind:'decision',at:item.createdAt,label:`${item.actor} ${item.decision.toLowerCase()} revision ${item.revision}`}))].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return <><button className="overview-backdrop" onClick={onClose} aria-label="Close submission details"/><aside className="overview-drawer" aria-label="Submission details"><header><span className="drawer-kicker">REVIEW CARD · {review.id}</span><button onClick={onClose} aria-label="Close details"><X size={19}/></button></header><span className="drawer-date">{review.team} · Submitted by {review.owner} · {review.date}</span><h2>{review.title}</h2><span className={`paper-status status-${statusKey[review.status] || 'review'}`}><i/>{review.status}</span><div className="drawer-stats"><div><small>Findings</small><b>{review.findings || 0}</b></div><div><small>Current status</small><b>{review.status}</b></div></div>{review.content && <section className="drawer-content"><span className="drawer-kicker">SUBMITTED DRAFT</span><p>{review.content}</p></section>}<section className="review-history"><span className="drawer-kicker">HISTORY</span>{historyError?<p>{historyError}</p>:!history?<p>Loading history…</p>:timeline.length?<ol>{timeline.map((item,index)=><li key={`${item.kind}-${item.at}-${index}`}><time>{new Date(item.at).toLocaleString()}</time><span>{item.label}</span></li>)}</ol>:<p>No history recorded.</p>}</section><div className="drawer-note"><ShieldCheck size={17}/><p>Automated findings assist the review. Approval remains a human decision.</p></div><div className="drawer-actions"><span className="drawer-kicker">MOVE THIS CARD TO</span>{choices.filter((status) => status !== review.status).map((status) => <button key={status} disabled={busy} onClick={() => onDecision(status)} className={`drawer-decision decision-${statusKey[status] || 'rejected'}`}>{status === 'Approved' ? <Check size={15}/> : null}{busy ? 'Saving…' : status}</button>)}</div></aside></>;
}

function historyEventLabel(event) {
  const actor=event.actorEmail||'A workspace member';
  if(event.action==='review.submitted')return `Submitted by ${actor}`;
  if(event.action==='review.revised')return `Draft edited by ${actor}`;
  if(event.action==='review.status_changed')return `Status changed by ${actor}`;
  if(event.action.startsWith('review.'))return `${actor} ${event.action.slice(7).replaceAll('_',' ')}`;
  return event.action;
}

