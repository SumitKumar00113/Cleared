import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText,
  Filter, FolderOpen, LayoutGrid, Menu, MoreHorizontal, Plus, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, X, AlertTriangle, UploadCloud,
} from 'lucide-react';
import './styles.css';
import WorkspaceSettings from './WorkspaceSettings.jsx';

const ReviewDesk = React.lazy(() => import('./ReviewDesk.jsx'));

const navigation = [
  { name: 'Overview', icon: LayoutGrid },
  { name: 'Reviews', icon: FileText },
  { name: 'Approved sources', icon: FolderOpen },
  { name: 'Insights', icon: Activity },
];

function WorkspaceApp({ user }) {
  const [reviews, setReviews] = useState([]);
  const [sources, setSources] = useState([]);
  const [view, setView] = useState('Overview');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(() => new URLSearchParams(window.location.search).get('new') === 'review' ? 'review' : '');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => { document.title = 'Cleared Ã¢â‚¬â€ Review workspace'; }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/reviews').then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/sources').then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([reviewResult, sourceResult]) => {
      setReviews(reviewResult.data || []);
      setSources(sourceResult.data || []);
    }).catch(() => {
      setReviews([]);
      setSources([]);
      notify('Workspace records could not be loaded. Check the API connection.');
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function notify(message) { setToast(message); }

  const visibleReviews = useMemo(() => reviews.filter((review) => {
    const matchesText = `${review.title} ${review.owner} ${review.team}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (filter === 'All statuses' || review.status === filter);
  }), [reviews, search, filter]);

  async function submitReview(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const content = String(form.get('content') || '').trim();
    const file = form.get('file');
    const payload = file?.size ? new FormData() : { title: form.get('title'), content };
    if (file?.size) {
      payload.append('title', form.get('title'));
      payload.append('content', content);
      payload.append('file', file);
    }
    setBusy(true);
    try {
      const response = await fetch('/api/reviews', { method: 'POST', ...(payload instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }), body: payload instanceof FormData ? payload : JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit the review.');
      setReviews((items) => [result.data, ...items]);
      setModal('');
      formElement.reset();
      notify('Draft submitted for review.');
      setView('Reviews');
    } catch (error) { notify(error.message || 'Could not connect to the review service.'); }
    finally { setBusy(false); }
  }

  async function updateStatus(status) {
    if (!selected) return;
    try {
      const response = await fetch(`/api/reviews/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update the review.');
      setReviews((items) => items.map((item) => item.id === selected.id ? result.data : item));
      setSelected(result.data);
      notify(`Review ${status.toLowerCase()}.`);
      setSelected(null);
    } catch (error) { notify(error.message || 'Could not connect to the review service.'); }
  }

  async function checkReview(review) {
    setChecking(true);
    try {
      const response = await fetch('/api/verification/check/' + review.id, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Claim check failed.');
      setReviews((items) => items.map((item) => item.id === review.id ? result.data.review : item));
      setSelected(result.data.review);
      notify('Checked with ' + result.data.provider + ' (' + result.data.model + '). A human reviewer still decides.');
    } catch (error) { notify(error.message || 'Could not check this draft.'); }
    finally { setChecking(false); }
  }

  async function submitSource(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    const payload = new FormData();
    payload.append('name', form.get('name'));
    payload.append('category', form.get('category'));
    payload.append('file', file);
    setBusy(true);
    try {
      const response = await fetch('/api/sources', { method: 'POST', body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add this source.');
      setSources((items) => [result.data, ...items]);
      setModal('');
      formElement.reset();
      notify('Approved source added.');
    } catch (error) { notify(error.message || 'Could not connect to the source service.'); }
    finally { setBusy(false); }
  }

  const changeView = (name) => { if (name === 'Reviews') { window.location.assign('/workspace'); return; } setView(name); setMobileNav(false); setSearch(''); };

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} aria-label="Main navigation">
      <a className="brand" href="/"><span className="brand-mark"><Check size={19} strokeWidth={2.8} /></span><span>cleared<span className="brand-period">.</span></span></a>
      <div className="workspace-switcher"><span className="workspace-avatar">{user.email.slice(0,1).toUpperCase()}</span><span className="workspace-copy"><strong>{user.email}</strong><small>{user.role}</small></span><ChevronDown size={15} /></div>
      <nav className="primary-nav" aria-label="Workspace">
        <p className="nav-label">WORKSPACE</p>
        {navigation.map(({ name, icon: Icon, count }) => <button key={name} className={`nav-item ${view === name ? 'active' : ''}`} onClick={() => changeView(name)}><Icon size={18} strokeWidth={1.8} /><span>{name}</span>{name === 'Reviews' && reviews.filter((item) => item.status === 'In review').length > 0 && <span className="nav-count">{reviews.filter((item) => item.status === 'In review').length}</span>}</button>)}
        <p className="nav-label nav-label-spaced">MANAGE</p>
        <button className={`nav-item ${view === 'Settings' ? 'active' : ''}`} onClick={() => changeView('Settings')}><Settings2 size={18} strokeWidth={1.8} /><span>Settings</span></button>
      </nav>
      <div className="sidebar-bottom">
        <button className="help-card" onClick={() => notify('Help centre is ready for your team.')}><span className="help-icon"><CircleHelp size={17} /></span><span><strong>Need a hand?</strong><small>Visit the help centre</small></span><ArrowUpRight size={15} /></button>
      <button className="profile-button" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }} aria-label="Sign out"><span className="profile-avatar">{user.email.slice(0,2).toUpperCase()}</span><span className="profile-copy"><strong>{user.email}</strong><small>{user.role}</small></span><MoreHorizontal size={19} /></button>
      </div>
    </aside>

    <main id="main" className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>{user.email}</span><ChevronRight size={14} /><strong>{view}</strong></div><div className="top-actions"><button className="top-link" onClick={() => notify('YouÃ¢â‚¬â„¢re all caught up.')}><Bell size={17} /><span>Notifications</span><i /></button><span className="top-divider" /><button className="icon-button top-help" aria-label="Help" onClick={() => notify('Help centre is ready.')}><CircleHelp size={18} /></button><button className="mobile-menu" aria-label={mobileNav ? 'Close menu' : 'Open menu'} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X /> : <Menu />}</button></div></header>
      {view === 'Overview' ? <Overview reviews={visibleReviews} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} onOpen={setSelected} onView={changeView} onNew={() => setModal('review')} user={user} sources={sources} onSource={() => setModal('source')} /> : view === 'Reviews' ? <ReviewsPage reviews={visibleReviews} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} onOpen={setSelected} onNew={() => setModal('review')} /> : view === 'Approved sources' ? <SourcesPage sources={sources} onAdd={() => setModal('source')} /> : view === 'Insights' ? <InsightsPage reviews={reviews} /> : <WorkspaceSettings user={user} />}
    </main>

    {selected && <ReviewDrawer review={selected} onClose={() => setSelected(null)} onDecision={updateStatus} onCheck={checkReview} checking={checking} />}
    {modal === 'review' && <Dialog title="Submit content" kicker="START A REVIEW" intro="Check a draft against your teamÃ¢â‚¬â„¢s approved sources before it goes live." onClose={() => setModal('')} onSubmit={submitReview} submitLabel="Check draft" busy={busy}><label className="form-label">Review title<input name="title" required placeholder="e.g. Spring campaign announcement" /></label><label className="form-label">Content to review<textarea name="content" placeholder="Paste the draft or the section you want checkedÃ¢â‚¬Â¦" /></label><FileDrop name="file" accept=".pdf,.doc,.docx,.txt,.md,.csv" /><span className="form-hint">Text is required for Gemini claim checks.</span></Dialog>}
    {modal === 'source' && <Dialog title="Add an approved source" kicker="APPROVED KNOWLEDGE" intro="Give your team a trusted reference for fact checks and brand guidance." onClose={() => setModal('')} onSubmit={submitSource} submitLabel="Add source" busy={busy}><label className="form-label">Source name<input name="name" required placeholder="e.g. Product facts Ã¢â‚¬â€ 2026" /></label><label className="form-label">Collection<select name="category"><option>Brand guidelines</option><option>Product facts</option><option>Policies</option><option>FAQs</option></select></label><FileDrop name="file" accept=".txt,.md,.csv" required /></Dialog>}
    {toast && <div className="toast" role="status" aria-live="polite"><span className="toast-check"><Check size={14} /></span>{toast}</div>}
  </div>;
}

function Overview({ reviews, search, setSearch, filter, setFilter, filterOpen, setFilterOpen, onOpen, onView, onNew, user, sources, onSource }) {
  const waiting = reviews.filter((item) => item.status === 'In review').length;
  const needsChanges = reviews.filter((item) => item.status === 'Needs changes').length;
  const approved = reviews.filter((item) => item.status === 'Approved').length;
  return <div className="page-wrap" data-enter>
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE</div><h1>Welcome, {user.email}<span className="heading-period">.</span></h1><p className="welcome-subtitle">{waiting} reviews are with reviewers and {needsChanges} need changes. Open a review to see its draft and findings.</p></div><button className="button button-primary" onClick={onNew}><Plus size={17} />New review</button></section>
    <section className="stats-grid" aria-label="Current workspace records"><Stat title="With reviewers" number={String(waiting).padStart(2, '0')} foot="Current queue" icon={<Clock3 />} tone="sand" /><Stat title="Approved" number={String(approved).padStart(2, '0')} foot="Current queue" icon={<CheckCheck />} tone="green" /><Stat title="Needs changes" number={String(needsChanges).padStart(2, '0')} foot="Current queue" icon={<AlertTriangle />} tone="rose" /><Stat title="Approved sources" number={String(sources.length).padStart(2, '0')} foot="Available records" icon={<BookOpen />} tone="dark" /></section>
    <section className="content-grid"><div className="reviews-panel panel"><div className="panel-heading"><div><div className="section-kicker">YOUR QUEUE <span className="queue-total">{reviews.length}</span></div><h2>Recent reviews</h2></div><button className="text-button" onClick={() => onView('Reviews')}>View all <ArrowRight size={15} /></button></div><ReviewTools search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} /><ReviewList reviews={reviews.slice(0, 5)} onOpen={onOpen} compact /><PanelFooter count={reviews.length} onView={() => onView('Reviews')} /></div>
      <aside className="right-column"><section className="guidance-card panel"><div className="guidance-head"><div><span className="section-kicker">QUICK ACCESS</span><h2>Brand guidance</h2></div><span className="book-icon"><BookOpen size={21} /></span></div><p>Keep the team aligned with the latest approved facts and language.</p><button className="guidance-link" onClick={() => onView('Approved sources')}>Browse approved sources <ArrowRight size={15} /></button><div className="guidance-rule" /><div className="source-list">{sources.slice(0, 3).map((source) => <SourceRow key={source.id} source={source} />)}</div><button className="upload-source" onClick={onSource}><Plus size={16} /> Add approved source</button></section><ActivityCard /></aside>
    </section><PageFooter />
  </div>;
}

function Stat({ title, number, foot, icon, tone }) { return <article className={`stat-card stat-${tone}`}><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><div className="stat-number">{number}</div><div className="stat-foot">{foot}</div></article>; }

function ReviewTools({ search, setSearch, filter, setFilter, filterOpen, setFilterOpen }) {
  return <div className="table-tools"><label className="search-field"><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reviews" aria-label="Search reviews" /></label><div className="filter-wrap"><button className={`filter-button ${filter !== 'All statuses' ? 'filter-active' : ''}`} onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen}><SlidersHorizontal size={16} /><span>{filter === 'All statuses' ? 'Filter' : filter}</span>{filter !== 'All statuses' && <span className="filter-indicator" />}</button>{filterOpen && <div className="filter-menu">{['All statuses', 'In review', 'Needs changes', 'Approved', 'Rejected'].map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => { setFilter(status); setFilterOpen(false); }}>{status}{filter === status && <Check size={14} />}</button>)}</div>}</div></div>;
}

function ReviewList({ reviews, onOpen, compact = false }) {
  return <div className="review-list">{reviews.length ? reviews.map((review, index) => <button className="review-row" key={review.id} onClick={() => onOpen(review)}><span className={`file-type file-${index % 3}`}>{review.title.toLowerCase().includes('newsletter') ? 'M' : review.title.toLowerCase().includes('product') ? 'S' : 'D'}</span><span className="review-main"><strong>{review.title}</strong><small>{review.owner} <b>Ã‚Â·</b> {review.team}</small></span><Status status={review.status} /><span className="row-date">{review.date}</span><ChevronRight className="row-arrow" size={16} /></button>) : <div className="empty-state"><Search size={21} /><strong>No reviews found</strong><span>Try a different search or filter.</span></div>}</div>;
}

function Status({ status }) { const tone = status === 'Approved' ? 'approved' : status === 'Needs changes' ? 'changes' : status === 'Rejected' ? 'rejected' : 'review'; return <span className={`status-pill status-${tone}`}><i />{status}</span>; }
function PanelFooter({ count, onView }) { return <div className="panel-footer"><span>Showing <strong>{count}</strong> of 5 reviews</span><button className="footer-link" onClick={onView}>Open review queue <ArrowRight size={14} /></button></div>; }
function SourceRow({ source }) { return <div className="source-item"><span className={`source-file ${source.type === 'PDF' ? 'source-file-pdf' : 'source-file-doc'}`}>{source.type}</span><span><strong>{source.name}</strong><small>{source.updated}</small></span><button className="more-button" aria-label={`More options for ${source.name}`}><MoreHorizontal size={18} /></button></div>; }

function ActivityCard() { return <section className="activity-card panel"><div className="activity-header"><div><span className="section-kicker">ACTIVITY</span><h2>Activity history</h2></div></div><p className="insight-empty">Activity history will appear when audit events are connected.</p></section>; }

function ReviewsPage({ reviews, search, setSearch, filter, setFilter, filterOpen, setFilterOpen, onOpen, onNew }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> REVIEW WORKSPACE</div><h1>Review queue<span className="heading-period">.</span></h1><p className="welcome-subtitle">Keep every draft moving toward a confident approval.</p></div><button className="button button-primary" onClick={onNew}><Plus size={17} />New review</button></div><div className="panel full-panel"><div className="panel-heading"><div><div className="section-kicker">ALL SUBMISSIONS <span className="queue-total">{reviews.length}</span></div><h2>Content reviews</h2></div></div><ReviewTools search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} /><ReviewList reviews={reviews} onOpen={onOpen} /><PanelFooter count={reviews.length} onView={() => { setSearch(''); setFilter('All statuses'); }} /></div></div>; }

function SourcesPage({ sources, onAdd }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> TRUSTED KNOWLEDGE</div><h1>Approved sources<span className="heading-period">.</span></h1><p className="welcome-subtitle">Upload TXT, MD, or CSV source text to use it for Gemini claim checks.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} />Add source</button></div><div className="source-collection-grid">{['Brand guidelines', 'Product facts', 'Policies', 'FAQs'].map((category, i) => { const items = sources.filter((source) => source.category === category); return <article className="collection-card panel" key={category}><div className="collection-icon"><FolderOpen size={19} /></div><div className="collection-meta"><span className="section-kicker">COLLECTION 0{i + 1}</span><h2>{category}</h2><p>{items.length} approved {items.length === 1 ? 'source' : 'sources'}</p></div><div className="collection-files">{items.length ? items.map((source) => <SourceRow key={source.id} source={source} />) : <div className="collection-empty">No sources in this collection yet.</div>}</div></article>; })}</div></div>; }

function InsightsPage({ reviews }) {
  const totals = ['In review', 'Needs changes', 'Approved', 'Rejected'].map((status) => [status, reviews.filter((r) => r.status === status).length]);
  const total = reviews.length;
  return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><h1>Insights<span className="heading-period">.</span></h1><p className="welcome-subtitle">A snapshot of the records in this workspace.</p></div><span className="data-honesty">Current queue: {total} records</span></div><div className="insight-layout"><section className="insight-chart panel"><div className="panel-heading"><div><h2>Reviews by status</h2><p>Current records only; date history is not available.</p></div></div><div className="status-breakdown">{totals.map(([label, value]) => <div className="breakdown-row" key={label}><span>{label}</span><div><i className={'breakdown-' + label.toLowerCase().replaceAll(' ', '-')} style={{ width: (total ? value / total * 100 : 0) + '%' }} /></div><b>{value}</b></div>)}</div></section><section className="insight-chart panel"><div className="panel-heading"><div><h2>Findings by review</h2><p>Counts recorded on current review records.</p></div></div><div className="finding-bars">{reviews.slice(0, 7).map((review) => <div className="finding-bar-row" key={review.id} title={review.title}><span>{review.title}</span><div><i style={{ height: Math.max(4, (review.findings || 0) * 24) + 'px' }} /></div><b>{review.findings || 0}</b></div>)}</div></section></div><p className="insight-limitation">Trends, first-pass rates, decision times, and claim topics need event data that this workspace does not provide.</p></div>;
}

function SettingsPage({ notify }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Settings<span className="heading-period">.</span></h1><p className="welcome-subtitle">Manage your workspace preferences and review roles.</p></div></div><div className="settings-list panel"><div className="settings-item"><span className="settings-icon"><ShieldCheck size={19} /></span><div><strong>Review workflow</strong><small>Reviewer approval is required before content is marked ready.</small></div><span className="settings-value">Human approval</span></div><div className="settings-item"><span className="settings-icon"><BookOpen size={19} /></span><div><strong>Source freshness</strong><small>Review sources approaching their expiry date.</small></div><span className="settings-value">Not configured</span></div><div className="settings-item"><span className="settings-icon"><SlidersHorizontal size={19} /></span><div><strong>Roles &amp; access</strong><small>Creators, reviewers, brand managers, and administrators.</small></div><span className="settings-value">Read only</span></div></div></div>; }

function ReviewDrawer({ review, onClose, onDecision, onCheck, checking }) { return <><button className="drawer-backdrop" aria-label="Close review details" onClick={onClose} /><aside className="review-drawer" aria-label="Review details"><div className="drawer-top"><span className="section-kicker">SUBMISSION DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close review details"><X size={19} /></button></div><div className="drawer-body"><span className="file-type drawer-file">D</span><h2>{review.title}</h2><p className="drawer-owner">Submitted by {review.owner} · {review.team}</p><Status status={review.status} /><div className="drawer-separator" /><span className="section-kicker">DRAFT CONTENT</span><blockquote>{review.content}</blockquote><p className="verification-note">Checking sends this draft and approved source text to Google Gemini. Google may use free-tier inputs to improve its products.</p><button className="button button-secondary" disabled={checking || !review.content || review.content.startsWith('Document attached:')} onClick={() => onCheck(review)}>{checking ? 'Checking with Gemini…' : 'Check claims with Gemini'}</button>{review.claimResults?.length ? <section className="claim-results"><h3>Claim findings</h3>{review.claimResults.map((item,index)=><article className={'claim-result claim-result-' + item.verdict.toLowerCase().replaceAll(' ','-')} key={index}><strong>{item.verdict}</strong><p>{item.claim}</p><small>{item.explanation}</small>{item.evidence && <blockquote>{item.evidence}<br /><b>{item.sourceName} · version {item.sourceVersion}</b></blockquote>}</article>)}<p className="human-decision-note">Automated findings assist review. A person must record the approval decision.</p></section> : <p className="verification-note">No claim check has been recorded for this draft. Add readable approved source text to run one.</p>}</div><div className="drawer-actions"><button className="button button-secondary" onClick={() => onDecision('Needs changes')}>Request changes</button><button className="button button-primary" disabled={Number(review.findings || 0)>0} title={Number(review.findings || 0)>0?'Resolve recorded findings first':undefined} onClick={() => onDecision('Approved')}><Check size={16} />Approve draft</button></div></aside></>; }

function Dialog({ title, kicker, intro, onClose, onSubmit, submitLabel, busy, children }) { return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="app-dialog" onSubmit={onSubmit}><div className="dialog-head"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div><p className="dialog-intro">{intro}</p>{children}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'SavingÃ¢â‚¬Â¦' : submitLabel}<ArrowRight size={15} /></button></div></form></div>; }

function FileDrop({ name, accept, required = false }) { const [filename, setFilename] = useState(''); return <label className="file-drop"><UploadCloud size={19} /><span><strong>{filename || 'Attach a document'}</strong><small>Supported formats · up to 20 MB</small></span><input name={name} type="file" accept={accept} required={required} onChange={(event) => setFilename(event.target.files?.[0]?.name || '')} /></label>; }
function PageFooter() { return <footer className="page-footer"><span>Workspace records are currently held in server memory.</span></footer>; }

function App() { return <AuthGate />; }

function AuthGate() {
  const [state, setState] = useState('loading'); const [user, setUser] = useState(null); const [configError, setConfigError] = useState('');
  useEffect(() => { fetch('/api/auth/session').then(async (response) => { const data = await response.json(); if (response.status === 503) throw new Error(data.error); if (!response.ok) throw new Error('Authentication service unavailable.'); return data; }).then((data) => { setUser(data.user); setState(data.authenticated ? 'signed-in' : 'signed-out'); }).catch((error) => { setConfigError(error.message); setState('setup'); }); }, []);
  const onLogin = (nextUser) => { setUser(nextUser); setState('signed-in'); };
  if (state === 'loading') return <div className="auth-screen"><p>Checking sign-in…</p></div>;
  if (window.location.pathname === '/join') return <JoinPage onLogin={onLogin} />;
  if (state === 'setup') return <LoginPage configError={configError} />;
  if (state !== 'signed-in') return <LoginPage onLogin={onLogin} />;
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  if (route === '/app') return <div className="auth-screen"><section className="auth-card"><h1>Claim verification is not connected</h1><p>There is no verification provider configured yet. Add approved source material and connect a provider before checking claims.</p><a className="button button-primary" href="/dashboard">Open workspace</a></section></div>;
  if (route === '/workspace') return <React.Suspense fallback={<div className="route-loading">Opening review desk…</div>}><ReviewDesk /></React.Suspense>;
  return <WorkspaceApp user={user} />;
}

function LoginPage({ onLogin, configError }) {
  const [creating, setCreating] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); const endpoint = creating ? '/api/auth/workspaces' : '/api/auth/login'; const payload = creating ? { workspaceName: form.get('workspaceName'), email: form.get('email'), password: form.get('password') } : { email: form.get('email'), workspaceId: form.get('workspaceId'), password: form.get('password') }; try { const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not continue.'); onLogin(data.user); } catch (cause) { setError(cause.message || 'Could not continue.'); } finally { setBusy(false); } }
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>{creating ? 'Create a company workspace' : 'Sign in to your workspace'}</h1><p>{creating ? 'Your company gets a workspace ID. You become its first owner and can invite employees.' : 'Use your company workspace ID and your personal employee account.'}</p>{configError && <div className="auth-error" role="alert">{configError}</div>}{!configError && <form onSubmit={submit}>{creating && <label>Company or workspace name<input name="workspaceName" autoComplete="organization" required minLength="2"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required/></label>{!creating && <label>Company workspace ID<input name="workspaceId" autoComplete="off" required/></label>}<label>Password<input name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 12 : undefined}/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? 'Please wait…' : creating ? 'Create workspace' : 'Sign in'}</button></form>}{!configError && <button className="auth-switch" type="button" onClick={() => { setCreating(!creating); setError(''); }}>{creating ? 'Already have an account? Sign in' : 'Create a company workspace'}</button>}</section></main>;
}

function JoinPage({ onLogin }) {
  const params = new URLSearchParams(window.location.search); const token = params.get('token') || ''; const invitedEmail = params.get('email') || '';
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const password=new FormData(event.currentTarget).get('password'); try { const response=await fetch('/api/auth/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,email:invitedEmail,password})}); const result=await response.json(); if(!response.ok) throw new Error(result.error||'Could not accept invitation.'); onLogin(result.user); } catch(cause) { setError(cause.message); } finally { setBusy(false); } }
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Join your company workspace</h1><p>Your account will be linked to the invitation for {invitedEmail || 'your email address'}. If you already have a Cleared account, enter its current password; otherwise create a password with at least 12 characters.</p>{!token ? <p className="auth-error">This invitation link is incomplete. Ask your company administrator for a new one.</p> : <form onSubmit={submit}><label>Invited email<input value={invitedEmail} readOnly/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy?'Joining…':'Accept invitation'}</button></form>}</section></main>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

