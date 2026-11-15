import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText,
  Filter, FolderOpen, LayoutGrid, Menu, MoreHorizontal, Plus, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, X, AlertTriangle, UploadCloud,
} from 'lucide-react';
import './styles.css';
import LandingPage from './LandingPage.jsx';
import WorkspaceSettings from './WorkspaceSettings.jsx';
import { apiFetch, apiFetchRecent } from './api.js';
import { CommandPalette, Rail } from './design-system.jsx';
import './design-system.css';
import './overview.css';

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
  const [verificationState,setVerificationState]=useState('idle');
  const [aiCheckEnabled,setAiCheckEnabled]=useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const canViewAudit = ['owner', 'administrator'].includes(user.role);

  useEffect(() => { document.title = 'Cleared ? Review workspace'; }, []);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/reviews').then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch('/api/sources').then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([reviewResult, sourceResult]) => {
      setReviews(reviewResult.data || []);
      setSources(sourceResult.data || []);
    }).catch(() => {
      setReviews([]);
      setSources([]);
      notify('Workspace records could not be loaded. Check the API connection.');
    });
  }, []);

  useEffect(()=>{apiFetch('/api/workspace').then((response)=>response.ok?response.json():null).then((result)=>{if(result?.data)setAiCheckEnabled(Boolean(result.data.aiCheckEnabled));}).catch(()=>{});},[]);

  useEffect(() => {
    if (!canViewAudit) return undefined;
    let active = true;
    apiFetch('/api/workspace/audit?limit=8').then(async (response) => {
      if (!response.ok) throw new Error('Activity unavailable');
      const body = await response.json();
      if (active) setAuditEvents(body.data || []);
    }).catch(() => { if (active) setAuditEvents([]); });
    return () => { active = false; };
  }, [canViewAudit]);

  useEffect(() => {
    const handleKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen((open) => !open); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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
      const response = await apiFetch('/api/reviews', { method: 'POST', ...(payload instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }), body: payload instanceof FormData ? payload : JSON.stringify(payload) });
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
      const response = await (status === 'Approved' ? apiFetchRecent : apiFetch)(`/api/reviews/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
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
    setVerificationState('queued');
    try {
      const response = await apiFetch('/api/verification/check/' + review.id, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Claim check failed.');
      let job=result.data.job;
      if(!job?.id)throw new Error('Verification did not return a job id.');
      const started=Date.now();
      while(Date.now()-started<120000) {
        setVerificationState(job.status==='running'?'checking':'queued');
        await new Promise((resolve)=>setTimeout(resolve,700));
        const poll=await apiFetch(`/api/verification/jobs/${encodeURIComponent(job.id)}`);
        const body=await poll.json();if(!poll.ok)throw new Error(body.error||'Could not read verification status.');
        job=body.data.job;
        if(job.status==='succeeded') {
          const updated=body.data.review;
          setReviews((items)=>items.map((item)=>item.id===review.id?updated:item));setSelected(updated);
          const limited=Boolean(body.data.limited);
          setVerificationState(limited?'limited':'done');
          notify(limited?'Limited deterministic check complete. A human reviewer still decides.':'AI assisted check complete. A human reviewer still decides.');
          return;
        }
        if(job.status==='failed'||job.status==='cancelled')throw new Error(job.errorCode==='daily_character_cap'||job.errorCode==='daily_job_cap'?'Verification is temporarily unavailable. Try again later.':'Verification failed. Try again later.');
      }
      throw new Error('Verification is still running. Check the review again shortly.');
    } catch (error) { setVerificationState('failed');notify(error.message || 'Could not check this draft.'); }
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
    if (form.get('expiresAt')) payload.append('expiresAt', form.get('expiresAt'));
    payload.append('file', file);
    setBusy(true);
    try {
      const response = await apiFetch('/api/sources', { method: 'POST', body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add this source.');
      setSources((items) => [result.data, ...items]);
      setModal('');
      formElement.reset();
      notify('Approved source added.');
    } catch (error) { notify(error.message || 'Could not connect to the source service.'); }
    finally { setBusy(false); }
  }

  async function downloadFile(fileId) {
    try {
      const response = await apiFetch(`/api/files/${encodeURIComponent(fileId)}/link`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create a download link.');
      window.location.assign(result.data.url);
    } catch (error) { notify(error.message || 'Could not download this file.'); }
  }

  const changeView = (name) => { if (name === 'Reviews') { window.location.assign('/workspace'); return; } setView(name); setMobileNav(false); setSearch(''); };

  return <div className="app-shell redesign-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <Rail view={view} onChange={changeView} user={user} onSignOut={async () => { await apiFetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }} expanded={railExpanded} onToggle={() => setRailExpanded((value) => !value)} onCommand={() => setCommandOpen(true)} />
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
      <button className="profile-button" onClick={async () => { await apiFetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }} aria-label="Sign out"><span className="profile-avatar">{user.email.slice(0,2).toUpperCase()}</span><span className="profile-copy"><strong>{user.email}</strong><small>{user.role}</small></span><MoreHorizontal size={19} /></button>
      </div>
    </aside>

    <main id="main" className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>{user.email}</span><ChevronRight size={14} /><strong>{view}</strong></div><div className="top-actions"><button className="top-link" onClick={() => notify('YouÃ¢â‚¬â„¢re all caught up.')}><Bell size={17} /><span>Notifications</span><i /></button><span className="top-divider" /><button className="icon-button top-help" aria-label="Help" onClick={() => notify('Help centre is ready.')}><CircleHelp size={18} /></button><button className="mobile-menu" aria-label={mobileNav ? 'Close menu' : 'Open menu'} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X /> : <Menu />}</button></div></header>
      {view === 'Overview' ? <Overview reviews={visibleReviews} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} onOpen={setSelected} onView={changeView} onNew={() => setModal('review')} user={user} sources={sources} onSource={() => setModal('source')} onDownload={downloadFile} auditEvents={auditEvents} canViewAudit={canViewAudit} /> : view === 'Reviews' ? <ReviewsPage reviews={visibleReviews} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} onOpen={setSelected} onNew={() => setModal('review')} /> : view === 'Approved sources' ? <SourcesPage sources={sources} onAdd={() => setModal('source')} onDownload={downloadFile} /> : view === 'Insights' ? <InsightsPage reviews={reviews} /> : <WorkspaceSettings user={user} onAISettingChanged={setAiCheckEnabled} />}
    </main>

    {selected && <ReviewDrawer review={selected} onClose={() => setSelected(null)} onDecision={updateStatus} onCheck={checkReview} checking={checking} verificationState={verificationState} aiCheckEnabled={aiCheckEnabled} onDownload={downloadFile} />}
    {modal === 'review' && <Dialog title="Submit content" kicker="START A REVIEW" intro="Check a draft against your teamÃ¢â‚¬â„¢s approved sources before it goes live." onClose={() => setModal('')} onSubmit={submitReview} submitLabel="Check draft" busy={busy}><label className="form-label">Review title<input name="title" required placeholder="e.g. Spring campaign announcement" /></label><label className="form-label">Content to review<textarea name="content" placeholder="Paste the draft or the section you want checkedÃ¢â‚¬Â¦" /></label><FileDrop name="file" accept=".txt,.md,.csv" /><span className="form-hint">Text is required for Gemini claim checks.</span></Dialog>}
    {modal === 'source' && <Dialog title="Add an approved source" kicker="APPROVED KNOWLEDGE" intro="Give your team a trusted reference for fact checks and brand guidance." onClose={() => setModal('')} onSubmit={submitSource} submitLabel="Add source" busy={busy}><label className="form-label">Source name<input name="name" required placeholder="e.g. Product facts Ã¢â‚¬â€ 2026" /></label><label className="form-label">Collection<select name="category"><option>Brand guidelines</option><option>Product facts</option><option>Policies</option><option>FAQs</option></select></label><label className="form-label">Optional expiry date<input name="expiresAt" type="date" /></label><FileDrop name="file" accept=".txt,.md,.csv" required /></Dialog>}
    {toast && <div className="toast" role="status" aria-live="polite"><span className="toast-check"><Check size={14} /></span>{toast}</div>}
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onChoose={(name) => { changeView(name); setCommandOpen(false); }} onNewReview={() => { setCommandOpen(false); setModal('review'); }} />
  </div>;
}

function Overview({ reviews, search, setSearch, filter, setFilter, filterOpen, setFilterOpen, onOpen, onView, onNew, user, sources, onSource, onDownload, auditEvents, canViewAudit }) {
  const waiting = reviews.filter((item) => item.status === 'In review').length;
  const needsChanges = reviews.filter((item) => item.status === 'Needs changes').length;
  const approved = reviews.filter((item) => item.status === 'Approved').length;
  const sourceHealth = sources.reduce((count, source) => { const state = source.expired ? 'expired' : source.expiringSoon ? 'soon' : source.scanStatus === 'clean' ? 'clean' : 'quarantine'; count[state] += 1; return count; }, { expired: 0, soon: 0, clean: 0, quarantine: 0 });
  const titleName = user.displayName || user.name || (user.email || 'there').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return <div className="page-wrap overview-v2" data-enter>
    <section className="overview-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE OVERVIEW</div><h1>Good to see you, <em>{titleName}</em><span className="heading-period">.</span></h1><p className="welcome-subtitle">A clear view of drafts, decisions, and trusted sources.</p></div><button className="button button-primary" onClick={onNew}><Plus size={17} />New review</button></section>
    <section className="pipeline-band" aria-label="Review pipeline"><div className="pipeline-lead"><span className="section-kicker">LIVE QUEUE</span><strong>{String(waiting).padStart(2, '0')}</strong><span>with reviewers</span></div><div className="pipeline-step"><span className="pipeline-dot pipeline-dot-review" /><span><strong>{waiting}</strong> in review</span></div><div className="pipeline-connector" /><div className="pipeline-step"><span className="pipeline-dot pipeline-dot-change" /><span><strong>{needsChanges}</strong> need changes</span></div><div className="pipeline-connector" /><div className="pipeline-step"><span className="pipeline-dot pipeline-dot-approved" /><span><strong>{approved}</strong> approved</span></div><div className="pipeline-source"><span className="mono-label">SOURCES</span><strong>{sources.length}</strong><span>available</span></div></section>
    <section className="overview-grid"><div className="queue-section"><div className="section-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h2>Recent reviews</h2></div><button className="text-button" onClick={() => onView('Reviews')}>All reviews <ArrowRight size={15} /></button></div><PanelFooter count={reviews.length} onView={() => onView('Reviews')} /><ReviewTools search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} /><ReviewList reviews={reviews.slice(0, 5)} onOpen={onOpen} compact /><button className="queue-create" onClick={onNew}><Plus size={16} /> Submit a draft</button></div>
      <aside className="overview-aside"><ActivityCard events={auditEvents} canViewAudit={canViewAudit} /><section className="source-health"><div className="section-heading aside-heading"><div><span className="section-kicker">SOURCE HEALTH</span><h2>Trusted references</h2></div><button className="icon-button" aria-label="Open approved sources" onClick={() => onView('Approved sources')}><ArrowUpRight size={17} /></button></div><div className="source-health-counts"><div><strong>{sourceHealth.clean}</strong><span>Clean</span></div><div className={sourceHealth.soon ? 'health-warn' : ''}><strong>{sourceHealth.soon}</strong><span>Expiring soon</span></div><div className={sourceHealth.expired || sourceHealth.quarantine ? 'health-alert' : ''}><strong>{sourceHealth.expired + sourceHealth.quarantine}</strong><span>Expired or quarantined</span></div></div><div className="source-health-list">{sources.slice(0, 3).map((source) => <SourceRow key={source.id} source={source} onDownload={onDownload} />)}{sources.length === 0 && <p className="quiet-note">No sources yet. Add approved text for future claim checks.</p>}</div><button className="source-add" onClick={onSource}><Plus size={15} />Add a source</button></section></aside>
    </section>
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
function PanelFooter({ count, onView }) { return <div className="panel-footer"><span><strong>{count}</strong> {count === 1 ? 'review' : 'reviews'} in this workspace</span><button className="footer-link" onClick={onView}>Open review queue <ArrowRight size={14} /></button></div>; }
function SourceRow({ source, onDownload }) {
  const freshStatus = source.expired ? 'Expired' : source.expiringSoon ? 'Expiring soon' : source.scanStatus === 'clean' ? 'Scanned clean' : 'Quarantined';
  const uploaded = source.updated ? new Date(source.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently added';
  return <div className="source-item"><span className="source-file source-file-doc">{source.type || 'TXT'}</span><span><strong>{source.name}</strong><small>v{source.version || 1} {'\u00b7'} {uploaded} {'\u00b7'} {freshStatus}</small></span>{source.fileId && source.scanStatus === 'clean' && onDownload ? <button className="more-button" onClick={() => onDownload(source.fileId)} aria-label={'Download ' + source.name}>Download</button> : <span className="more-button" aria-label={freshStatus}>{source.scanStatus === 'clean' ? '?' : 'Quarantined'}</span>}</div>;
}
function ActivityCard({ events, canViewAudit }) {
  const describe = (event) => {
    const labels = { 'review.submitted': 'submitted a review', 'review.approved': 'approved a review', 'review.rejected': 'rejected a review', 'review.needs_changes': 'requested changes', 'review.status_changed': 'changed review status', 'auth.sign_in': 'signed in', 'auth.sign_in_failed': 'had a failed sign in', 'mfa.enabled': 'enabled MFA', 'mfa.enrollment_started': 'started MFA setup', 'source.upload': 'added a source', 'source.new_version': 'uploaded a source version', 'source.deleted': 'deleted a source', 'file.download': 'downloaded a file', 'file.scan_result': 'recorded a scan result', 'invitation.accepted': 'accepted an invitation', 'member.role_changed': 'changed a member role' };
    return labels[event.action] || event.action.replace(/[._]/g, ' ');
  };
  return <section className="activity-section"><div className="section-heading aside-heading"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>Workspace timeline</h2></div><Activity size={17} /></div>{!canViewAudit ? <p className="quiet-note">Audit activity is available to workspace owners and administrators.</p> : events.length ? <ol className="activity-timeline">{events.slice(0, 5).map((event) => <li key={event.id}><span className="timeline-marker" /><div><strong>{event.actorEmail || 'System'}</strong><span>{describe(event)}</span><small>{event.targetType === 'review' ? 'Review' : event.targetType === 'source' ? 'Source' : event.targetType}</small></div><time>{formatRelativeTime(event.occurredAt)}</time></li>)}</ol> : <p className="quiet-note">New workspace activity will appear here.</p>}</section>;
}

function formatRelativeTime(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 1) return 'Just now';
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(hours, 'hour');
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function ReviewsPage({ reviews, search, setSearch, filter, setFilter, filterOpen, setFilterOpen, onOpen, onNew }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> REVIEW WORKSPACE</div><h1>Review queue<span className="heading-period">.</span></h1><p className="welcome-subtitle">Keep every draft moving toward a confident approval.</p></div><button className="button button-primary" onClick={onNew}><Plus size={17} />New review</button></div><div className="panel full-panel"><div className="panel-heading"><div><div className="section-kicker">ALL SUBMISSIONS <span className="queue-total">{reviews.length}</span></div><h2>Content reviews</h2></div></div><ReviewTools search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} /><ReviewList reviews={reviews} onOpen={onOpen} /><PanelFooter count={reviews.length} onView={() => { setSearch(''); setFilter('All statuses'); }} /></div></div>; }

function SourcesPage({ sources, onAdd, onDownload }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> TRUSTED KNOWLEDGE</div><h1>Approved sources<span className="heading-period">.</span></h1><p className="welcome-subtitle">Upload TXT, MD, or CSV source text to use it for Gemini claim checks.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} />Add source</button></div><div className="source-collection-grid">{['Brand guidelines', 'Product facts', 'Policies', 'FAQs'].map((category, i) => { const items = sources.filter((source) => source.category === category); return <article className="collection-card panel" key={category}><div className="collection-icon"><FolderOpen size={19} /></div><div className="collection-meta"><span className="section-kicker">COLLECTION 0{i + 1}</span><h2>{category}</h2><p>{items.length} approved {items.length === 1 ? 'source' : 'sources'}</p></div><div className="collection-files">{items.length ? items.map((source) => <SourceRow key={source.id} source={source} onDownload={onDownload} />) : <div className="collection-empty">No sources in this collection yet.</div>}</div></article>; })}</div></div>; }

function InsightsPage({ reviews }) {
  const totals = ['In review', 'Needs changes', 'Approved', 'Rejected'].map((status) => [status, reviews.filter((r) => r.status === status).length]);
  const total = reviews.length;
  return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><h1>Insights<span className="heading-period">.</span></h1><p className="welcome-subtitle">A snapshot of the records in this workspace.</p></div><span className="data-honesty">Current queue: {total} records</span></div><div className="insight-layout"><section className="insight-chart panel"><div className="panel-heading"><div><h2>Reviews by status</h2><p>Current records only; date history is not available.</p></div></div><div className="status-breakdown">{totals.map(([label, value]) => <div className="breakdown-row" key={label}><span>{label}</span><div><i className={'breakdown-' + label.toLowerCase().replaceAll(' ', '-')} style={{ width: (total ? value / total * 100 : 0) + '%' }} /></div><b>{value}</b></div>)}</div></section><section className="insight-chart panel"><div className="panel-heading"><div><h2>Findings by review</h2><p>Counts recorded on current review records.</p></div></div><div className="finding-bars">{reviews.slice(0, 7).map((review) => <div className="finding-bar-row" key={review.id} title={review.title}><span>{review.title}</span><div><i style={{ height: Math.max(4, (review.findings || 0) * 24) + 'px' }} /></div><b>{review.findings || 0}</b></div>)}</div></section></div><p className="insight-limitation">Trend summaries, decision times, and claim topics are not currently shown.</p></div>;
}

function SettingsPage({ notify }) { return <div className="page-wrap page-secondary" data-enter><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Settings<span className="heading-period">.</span></h1><p className="welcome-subtitle">Manage your workspace preferences and review roles.</p></div></div><div className="settings-list panel"><div className="settings-item"><span className="settings-icon"><ShieldCheck size={19} /></span><div><strong>Review workflow</strong><small>Reviewer approval is required before content is marked ready.</small></div><span className="settings-value">Human approval</span></div><div className="settings-item"><span className="settings-icon"><BookOpen size={19} /></span><div><strong>Source freshness</strong><small>Review sources approaching their expiry date.</small></div><span className="settings-value">Not configured</span></div><div className="settings-item"><span className="settings-icon"><SlidersHorizontal size={19} /></span><div><strong>Roles &amp; access</strong><small>Creators, reviewers, brand managers, and administrators.</small></div><span className="settings-value">Read only</span></div></div></div>; }

function ReviewDrawer({ review, onClose, onDecision, onCheck, checking, verificationState, aiCheckEnabled }) { return <><button className="drawer-backdrop" aria-label="Close review details" onClick={onClose} /><aside className="review-drawer" aria-label="Review details"><div className="drawer-top"><span className="section-kicker">SUBMISSION DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close review details"><X size={19} /></button></div><div className="drawer-body"><span className="file-type drawer-file">D</span><h2>{review.title}</h2><p className="drawer-owner">Submitted by {review.owner} · {review.team}</p><Status status={review.status} /><div className="drawer-separator" /><span className="section-kicker">DRAFT CONTENT</span><blockquote>{review.content}</blockquote><ReviewHistory reviewId={review.id}/><p className="verification-note">{aiCheckEnabled?'AI checking is enabled. Draft sentences and retrieved source passages are sent to Google Gemini. Use a paid Gemini API tier with active billing for production data.':'AI checking is off. Limited deterministic checks run locally; no text is sent to Gemini.'}</p><button className="button button-secondary" disabled={checking || !review.content || review.content.startsWith('Document attached:')} onClick={() => onCheck(review)}>{checking ? 'Checking…' : 'Check claims'}</button>{verificationState!=='idle'&&<p className="verification-job-state" role="status">{({queued:'Queued',checking:'Checking',done:'Check complete',limited:'Limited check complete',failed:'Check failed'})[verificationState]||''}</p>}{review.claimResults?.length ? <section className="claim-results"><h3>Claim findings</h3>{review.claimResults.map((item,index)=><article className={'claim-result claim-result-' + item.verdict.toLowerCase().replaceAll(' ','-')} key={index}><strong>{item.verdict}</strong><p>{item.claim}</p><small>{item.explanation}</small>{item.evidence && <blockquote>{item.evidence}<br /><b>{item.sourceName} · version {item.sourceVersion}</b></blockquote>}<small className="finding-provenance">{item.mode||'unknown'} · {item.modelName||'local rules'} · {item.promptVersion||'legacy'}{item.sourceId?` · source ${item.sourceId} v${item.sourceVersion}`:''}{item.passageId?` · passage ${item.passageId}`:''}{item.jobId?` · job ${item.jobId}`:''}</small></article>)}<p className="human-decision-note">Automated findings assist review. A person must record the approval decision.</p></section> : <p className="verification-note">No claim check has been recorded for this draft. Add readable approved source text to run one.</p>}</div><div className="drawer-actions"><button className="button button-secondary" onClick={() => onDecision('Needs changes')}>Request changes</button><button className="button button-primary" disabled={Number(review.findings || 0)>0} title={Number(review.findings || 0)>0?'Resolve recorded findings first':undefined} onClick={() => onDecision('Approved')}><Check size={16} />Approve draft</button></div></aside></>; }

function ReviewHistory({reviewId}) {
  const [result,setResult]=useState(null); const [error,setError]=useState('');
  useEffect(()=>{let active=true;apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/history`).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'History could not be loaded.');if(active)setResult(body.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[reviewId]);
  const events=[...(result?.revisions||[]).map(item=>({at:item.createdAt,label:`Revision ${item.revision} edited by ${item.editor}`})),...(result?.events||[]).filter(item=>item.action.startsWith('review.')&&!['review.approved','review.rejected','review.needs_changes'].includes(item.action)).map(item=>({at:item.occurredAt,label:item.action==='review.submitted'?`Submitted by ${item.actorEmail||'workspace member'}`:`${item.actorEmail||'Workspace member'} ${item.action.slice(7).replaceAll('_',' ')}`})),...(result?.decisions||[]).map(item=>({at:item.createdAt,label:`${item.actor} ${item.decision.toLowerCase()} revision ${item.revision}`}))].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return <section className="review-history"><span className="section-kicker">HISTORY</span>{error?<p>{error}</p>:!result?<p>Loading history…</p>:<ol>{events.map((item,index)=><li key={`${item.at}-${index}`}><time>{new Date(item.at).toLocaleString()}</time><span>{item.label}</span></li>)}</ol>}</section>;
}

function Dialog({ title, kicker, intro, onClose, onSubmit, submitLabel, busy, children }) { return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="app-dialog" onSubmit={onSubmit}><div className="dialog-head"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div><p className="dialog-intro">{intro}</p>{children}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'SavingÃ¢â‚¬Â¦' : submitLabel}<ArrowRight size={15} /></button></div></form></div>; }

function FileDrop({ name, accept, required = false }) { const [filename, setFilename] = useState(''); return <label className="file-drop"><UploadCloud size={19} /><span><strong>{filename || 'Attach a document'}</strong><small>Supported formats · up to 20 MB</small></span><input name={name} type="file" accept={accept} required={required} onChange={(event) => setFilename(event.target.files?.[0]?.name || '')} /></label>; }
function PageFooter() { return <footer className="page-footer"><span>Workspace records are currently held in server memory.</span></footer>; }

function App() { return <AuthGate />; }

function AuthGate() {
  const [state, setState] = useState('loading'); const [user, setUser] = useState(null); const [configError, setConfigError] = useState('');
  useEffect(() => { apiFetch('/api/auth/session').then(async (response) => { const data = await response.json(); if (response.status === 503) throw new Error(data.error); if (!response.ok) throw new Error('Authentication service unavailable.'); return data; }).then((data) => { setUser(data.user); setState(data.authenticated ? 'signed-in' : 'signed-out'); }).catch((error) => { setConfigError(error.message); setState('setup'); }); }, []);
  const onLogin = (nextUser) => { window.history.replaceState(null, '', '/'); setUser(nextUser); setState('signed-in'); };
  if (state === 'loading') return <div className="auth-screen"><p>Checking sign-in…</p></div>;
  if (window.location.pathname === '/join') return <JoinPage onLogin={onLogin} />;
  if (window.location.pathname === '/verify-email') return <AccountActionPage kind="verify" />;
  if (window.location.pathname === '/forgot-password') return <AccountActionPage kind="forgot" />;
  if (window.location.pathname === '/reset-password') return <AccountActionPage kind="reset" />;
  if (window.location.pathname === '/unlock-account') return <AccountActionPage kind="unlock" />;
  if (window.location.pathname === '/resend-verification') return <AccountActionPage kind="resend" />;
  if (state === 'setup') return <LoginPage configError={configError} />;
  if (state !== 'signed-in') return window.location.pathname === '/login' ? <LoginPage onLogin={onLogin} /> : <LandingPage />;
  if (user && !user.emailVerified) return <VerificationPendingPage user={user} onVerified={(next)=>setUser(next)} />;
  if (user?.mfaSetupRequired) return <MfaEnrollmentPage onComplete={setUser} />;
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  if (route === '/app') return <div className="auth-screen"><section className="auth-card"><h1>Claim verification is not connected</h1><p>There is no verification provider configured yet. Add approved source material and connect a provider before checking claims.</p><a className="button button-primary" href="/dashboard">Open workspace</a></section></div>;
  if (route === '/workspace') return <React.Suspense fallback={<div className="route-loading">Opening review desk…</div>}><ReviewDesk /></React.Suspense>;
  return <WorkspaceApp user={user} />;
}

function LoginPage({ onLogin, configError }) {
  const [creating, setCreating] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'create'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [challenge,setChallenge]=useState(null);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); const endpoint = creating ? '/api/auth/workspaces' : '/api/auth/login'; const payload = creating ? { workspaceName: form.get('workspaceName'), email: form.get('email'), password: form.get('password') } : { email: form.get('email'), workspaceId: form.get('workspaceId'), password: form.get('password') }; try { const response = await apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not continue.'); if (data.verificationRequired) { setError('Verify your email before signing in.'); return; } if (data.mfaRequired) { setChallenge(data); return; } onLogin(data.user); } catch (cause) { setError(cause.message || 'Could not continue.'); } finally { setBusy(false); } }
  async function submitMfa(event){event.preventDefault();setBusy(true);setError('');const f=new FormData(event.currentTarget);const csrfResponse=await apiFetch('/api/auth/csrf');const csrf=await csrfResponse.json();const r=await apiFetch('/api/auth/mfa/challenge',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.token},body:JSON.stringify({email:challenge.email,challengeToken:challenge.challengeToken,code:f.get('code'),recoveryCode:f.get('recoveryCode')})});const d=await r.json();setBusy(false);if(!r.ok){setError(d.error||'Could not verify this code.');return;}onLogin(d.user);}
  if(challenge)return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Verify your identity</h1><p>Enter a current authenticator code or a one-time recovery code.</p><form onSubmit={submitMfa}><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code"/></label><label>Recovery code<input name="recoveryCode" autoComplete="off"/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>Verify and sign in</button></form><button className="auth-switch" onClick={()=>setChallenge(null)}>Back to sign in</button></section></main>;
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>{creating ? 'Create a company workspace' : 'Sign in to your workspace'}</h1><p>{creating ? 'Your company gets a workspace ID. You become its first owner and can invite employees.' : 'Use your company workspace ID and your personal employee account.'}</p>{configError && <div className="auth-error" role="alert">{configError}</div>}{!configError && <form onSubmit={submit}>{creating && <label>Company or workspace name<input name="workspaceName" autoComplete="organization" required minLength="2"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required/></label>{!creating && <label>Company workspace ID<input name="workspaceId" autoComplete="off" required/></label>}<label>Password<input name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 12 : undefined}/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? 'Please wait…' : creating ? 'Create workspace' : 'Sign in'}</button></form>}{!configError && !creating && <a className="auth-switch" href="/forgot-password">Forgot your password or need to set one?</a>}{!configError && <button className="auth-switch" type="button" onClick={() => { setCreating(!creating); setError(''); }}>{creating ? 'Already have an account? Sign in' : 'Create a company workspace'}</button>}</section></main>;
}

function JoinPage({ onLogin }) {
  const params = new URLSearchParams(window.location.search); const token = params.get('token') || ''; const invitedEmail = params.get('email') || '';
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [challenge,setChallenge]=useState(null);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const password=new FormData(event.currentTarget).get('password'); try { const response=await apiFetch('/api/auth/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,email:invitedEmail,password})}); const result=await response.json(); if(!response.ok) throw new Error(result.error||'Could not accept invitation.'); if(result.mfaRequired){setChallenge(result);return;} onLogin(result.user); } catch(cause) { setError(cause.message); } finally { setBusy(false); } }
  async function verifyChallenge(event){event.preventDefault();setBusy(true);setError('');const f=new FormData(event.currentTarget);const response=await apiFetch('/api/auth/mfa/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:challenge.email,challengeToken:challenge.challengeToken,code:f.get('code'),recoveryCode:f.get('recoveryCode')})});const data=await response.json();setBusy(false);if(!response.ok){setError(data.error||'Could not verify this code.');return;}onLogin(data.user);}
  if(challenge)return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Verify your identity</h1><p>Enter an authenticator or recovery code to finish joining.</p><form onSubmit={verifyChallenge}><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code"/></label><label>Recovery code<input name="recoveryCode"/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>Verify and continue</button></form></section></main>;
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Join your company workspace</h1><p>Your account will be linked to the invitation for {invitedEmail || 'your email address'}. If you already have a Cleared account, enter its current password; otherwise create a password with at least 12 characters.</p>{!token ? <p className="auth-error">This invitation link is incomplete. Ask your company administrator for a new one.</p> : <form onSubmit={submit}><label>Invited email<input value={invitedEmail} readOnly/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy?'Joining…':'Accept invitation'}</button></form>}</section></main>;
}

function AccountActionPage({ kind }) {
  const [message,setMessage]=useState(''); const [error,setError]=useState(''); const token=new URLSearchParams(window.location.search).get('token')||'';
  async function submit(event){event.preventDefault();setError('');const fields=new FormData(event.currentTarget);const url=kind==='verify'?'/api/auth/email/verify':kind==='forgot'?'/api/auth/password/forgot':kind==='unlock'?'/api/auth/account/unlock':kind==='resend'?'/api/auth/email/resend':'/api/auth/password/reset';const body=kind==='verify'?{token}:kind==='forgot'||kind==='unlock'||kind==='resend'?{email:fields.get('email')}:{token,email:fields.get('email'),password:fields.get('password')};const r=await apiFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){setError(d.error||'This request could not be completed.');return;}setMessage(kind==='verify'?(d.unlocked?'Sign-in lockout cleared. You can sign in.':'Email verified. You can sign in.'):kind==='forgot'||kind==='unlock'||kind==='resend'?d.message:'Password updated. You can sign in with the new password.');}
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>{kind==='verify'?'Verify your email':kind==='forgot'?'Forgot password':kind==='unlock'?'Unlock sign-in':'Reset password'}</h1>{kind==='verify'&&!token?<p>This email link is incomplete.</p>:<form onSubmit={submit}>{kind!=='verify'&&<label>Email address<input name="email" type="email" autoComplete="email" required/></label>}{kind==='reset'&&<label>New password<input name="password" type="password" minLength="12" autoComplete="new-password" required/></label>}{error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<button className="button button-primary">{kind==='verify'?'Verify email':kind==='forgot'?'Send instructions':kind==='unlock'?'Send unlock link':'Save password'}</button></form>}{kind==='forgot'&&<p><a href="/unlock-account">Need to clear a sign-in lockout?</a></p>}{kind==='unlock'&&<p><a href="/forgot-password">Need a password reset?</a></p>}<p><a href="/">Back to sign in</a></p></section></main>;
}

function VerificationPendingPage({user,onVerified}) {
  const [message,setMessage]=useState(''); const [error,setError]=useState('');
  async function resend(){const r=await apiFetch('/api/auth/email/resend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email})});const d=await r.json();setMessage(d.message||'If verification is needed, an email has been sent.');}
  async function check(){const r=await apiFetch('/api/auth/session');const d=await r.json();if(d.authenticated&&d.user.emailVerified)onVerified(d.user);else setMessage('Your email is not verified yet. Open the link from your email and check again.');}
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Verify your email</h1><p>We sent a verification link to {user.email}. Verify the address before opening workspace data.</p>{error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<button className="button button-primary" onClick={()=>resend().catch(e=>setError(e.message))}>Resend verification email</button><button className="auth-switch" onClick={check}>I’ve verified my email</button><button className="auth-switch" onClick={()=>apiFetch('/api/auth/logout',{method:'POST'}).then(()=>window.location.assign('/'))}>Sign out</button></section></main>;
}

function MfaEnrollmentPage({ onComplete }) {
  const [setup,setSetup]=useState(null); const [codes,setCodes]=useState(null); const [error,setError]=useState(''); const [pendingUser,setPendingUser]=useState(null);
  async function begin(){const r=await apiFetch('/api/auth/mfa/enroll/start',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error);setSetup(d.data);}
  async function finish(event){event.preventDefault();const code=new FormData(event.currentTarget).get('code');const r=await apiFetch('/api/auth/mfa/enroll/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const d=await r.json();if(!r.ok){setError(d.error);return;}setCodes(d.recoveryCodes);setPendingUser(d.user);}
  return <main className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">Cleared<span>.</span></a><h1>Secure your account</h1><p>Your workspace role requires multi-factor authentication. Set up an authenticator to continue.</p>{!setup&&!codes&&<button className="button button-primary" onClick={()=>begin().catch(e=>setError(e.message))}>Set up authenticator</button>}{setup&&!codes&&<><p>Scan this URI or enter the secret in your authenticator app.</p><code>{setup.secret}</code><form onSubmit={finish}><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" required/></label><button className="button button-primary">Confirm MFA setup</button></form></>}{codes&&<><h2>Save your recovery codes</h2><p>Each code works once and is shown only now.</p><ul>{codes.map(code=><li key={code}><code>{code}</code></li>)}</ul><button className="button button-primary" onClick={()=>onComplete(pendingUser)}>Continue</button></>}{error&&<p className="auth-error" role="alert">{error}</p>}</section></main>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

