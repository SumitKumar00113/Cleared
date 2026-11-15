import React, { useEffect, useState } from 'react';
import './LandingPage.css';

const findings = [
  { verdict: 'supported', claim: 'no annual fee', source: 'Aurora fact sheet v4, p.2', note: 'Matches the approved fee table.' },
  { verdict: 'contradicted', claim: '5% cashback on travel', source: 'Aurora fact sheet v4, p.3', note: 'The approved rate is 3% on travel.', fix: '3% cashback on travel' },
  { verdict: 'unclear', claim: 'rates fixed for life', source: 'No matching passage', note: 'No approved source mentions fixed rates.', fix: 'rates that stay clear and published' },
];
const labels = { supported: 'Supported', contradicted: 'Contradicted', unclear: 'Not enough evidence' };
const steps = [
  ['Add approved sources', 'Upload guidelines, fact sheets and policies. Keep each version with its owner and expiry date.'],
  ['Submit a draft', 'Paste text or upload a document. Cleared identifies the factual claims.'],
  ['Review the findings', 'See the evidence behind each verdict and decide how to handle suggested corrections.'],
  ['Make the decision', 'A reviewer approves, rejects or requests changes. Actions appear in the audit trail.'],
];
const draftParts = [
  ['The Aurora card has ', null], ['no annual fee', 0], [', pays ', null], ['5% cashback on travel', 1],
  [' and keeps ', null], ['rates fixed for life', 2], ['. Apply in two minutes.', null],
];

export default function LandingPage() {
  const [demoStep, setDemoStep] = useState(0);
  const [resolutions, setResolutions] = useState({});
  const [activity, setActivity] = useState([]);
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    if (demoStep > findings.length) return undefined;
    const timeout = window.setTimeout(() => setDemoStep((step) => step + 1), demoStep === 0 ? 900 : 1250);
    return () => window.clearTimeout(timeout);
  }, [demoStep]);
  const replay = () => { setDemoStep(0); setApproved(false); setResolutions({}); setActivity([]); };
  const resolve = (index, action) => {
    setResolutions((current) => ({ ...current, [index]: action }));
    setActivity((current) => [`${action === 'accepted' ? 'Accepted' : 'Rejected'} correction for “${findings[index].claim}”`, ...current]);
  };
  const openCount = findings.filter((finding, index) => index > 0 && !resolutions[index]).length;

  return <div className="landing-page" id="top">
    <nav className="landing-nav" aria-label="Main navigation">
      <a className="landing-logo" href="/" aria-label="Cleared home"><span className="landing-logo-mark" />Cleared</a>
      <div className="landing-nav-links"><a href="#how">How it works</a><a href="/login">Workspace</a><a className="landing-button landing-button-solid landing-button-small" href="/login">Sign in</a></div>
    </nav>
    <main>
      <header className="landing-hero">
        <div className="landing-hero-copy" data-enter>
          <p className="landing-eyebrow">REVIEW BEFORE IT GOES LIVE</p>
          <h1>Check every claim before it goes live.</h1>
          <p className="landing-lede">Cleared reads each draft against the facts, terms and policies your organisation has approved. A reviewer makes the final call.</p>
          <div className="landing-cta-row"><a className="landing-button landing-button-solid" href="/login">Review a draft</a><a className="landing-button landing-button-ghost" href="#how">See how it works</a></div>
        </div>
        <section className="landing-sheet" aria-label="Animated sample of a draft being checked">
          <div className="landing-sheet-bar"><span>Draft: Aurora card announcement</span><button className="landing-text-button" type="button" onClick={replay}>Replay</button></div>
          <p className="landing-draft">{draftParts.map(([text, index], part) => index === null ? <span key={part}>{text}</span> : <span key={part} className={`landing-mark ${demoStep > index ? findings[index].verdict : demoStep === index ? 'scanning' : ''}`}>{text}</span>)}</p>
          <ul className="landing-notes">{findings.slice(0, Math.min(demoStep, findings.length)).map((finding) => <li className={`landing-note ${finding.verdict}`} key={finding.claim}><b>{labels[finding.verdict]}</b><span>{finding.note}</span></li>)}</ul>
          {demoStep > findings.length && <div className="landing-stamp" role="status">Held for review</div>}
        </section>
      </header>
      <section className="landing-band" id="how"><div className="landing-wrap"><p className="landing-eyebrow">A CLEAR REVIEW PROCESS</p><h2>From draft to decision in four steps</h2><ol className="landing-steps">{steps.map(([title, description], index) => <li key={title}><span className="landing-step-number">{index + 1}</span><h3>{title}</h3><p>{description}</p></li>)}</ol></div></section>
      <section className="landing-workspace" id="preview"><div className="landing-wrap"><p className="landing-eyebrow">A LOOK INSIDE CLEARED</p><h2>Review findings with the evidence in view</h2><p className="landing-lede">This interactive sample shows how a reviewer can resolve findings and record a decision.</p>
        <div className="landing-demo-grid"><div className="landing-findings">{findings.map((finding, index) => {
          const resolution = resolutions[index];
          return <article className={`landing-finding ${finding.verdict} ${resolution || ''}`} key={finding.claim}><header><span className="landing-dot" /><b>{labels[finding.verdict]}</b><em>{finding.source}</em></header><p className="landing-claim">“{finding.claim}”</p><p className="landing-why">{finding.note}</p>{finding.fix && !resolution && <div className="landing-fix"><span>Suggested: <q>{finding.fix}</q></span><div><button className="landing-button landing-button-solid landing-button-small" type="button" onClick={() => resolve(index, 'accepted')}>Accept correction</button><button className="landing-button landing-button-ghost landing-button-small" type="button" onClick={() => resolve(index, 'rejected')}>Reject</button></div></div>}{resolution && <p className="landing-done">Correction {resolution}</p>}</article>;
        })}</div>
          <aside className="landing-reviewer"><p className="landing-eyebrow">REVIEWER</p><h3>{approved ? 'Approved for publication.' : openCount ? `${openCount} flagged claims still open.` : 'All findings resolved.'}</h3><button className="landing-button landing-button-solid" type="button" disabled={openCount > 0 || approved} onClick={() => { setApproved(true); setActivity((current) => ['Reviewer approved the sample revision', ...current]); }}>Approve sample revision</button><h3>Activity</h3><ul className="landing-activity">{activity.length ? activity.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li className="landing-activity-muted">Actions in this sample will appear here.</li>}</ul><a className="landing-signin-link" href="/login">Sign in to your workspace →</a></aside>
        </div>
      </div></section>
    </main>
    <footer className="landing-footer"><strong>Cleared</strong><span>An AI verdict is never an approval. A person always decides.</span><a href="/login?mode=create">Create a workspace</a></footer>
  </div>;
}
