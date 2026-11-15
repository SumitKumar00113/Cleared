import React, { useEffect, useState } from 'react';
import { apiFetch, apiFetchRecent } from './api.js';
import { Check, Copy, Mail, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Badge as DSBadge, Button as DSButton, Panel as DSPanel } from './design-system.jsx';

const roles = ['creator', 'reviewer', 'brand_manager', 'administrator'];
const roleLabels = { creator: 'Creator', reviewer: 'Reviewer', brand_manager: 'Brand manager', administrator: 'Administrator', owner: 'Owner' };

export default function WorkspaceSettings({ user, onAISettingChanged = () => {} }) {
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = ['owner', 'administrator'].includes(user.role);

  async function load() {
    const response = await fetch('/api/workspace'); const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load workspace.');
    setWorkspace(result.data);
    if (canManage) {
      const membersResponse = await fetch('/api/workspace/members'); const membersResult = await membersResponse.json();
      if (!membersResponse.ok) throw new Error(membersResult.error || 'Could not load members.');
      setMembers(membersResult.data || []);
    }
  }
  useEffect(() => { load().catch((cause) => setError(cause.message)); }, []);

  async function inviteMember(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setInvite(null);
    const formElement=event.currentTarget; const form = new FormData(formElement);
    try {
      const response = await apiFetch('/api/workspace/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not create invitation.');
      setInvite(result.data); formElement.reset(); setNotice('Invitation email sent. The link is not displayed here.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function copy(text, success) { try { await navigator.clipboard.writeText(text); setNotice(success); } catch { setError('Clipboard access was denied. Select and copy the text manually.'); } }
  async function updateRole(member, role) {
    const response = await apiFetchRecent(`/api/workspace/members/${member.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not update role.');
    setMembers((items) => items.map((item) => item.userId === member.userId ? { ...item, role } : item)); setNotice('Member role updated.');
  }
  async function remove(member) {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    const response = await apiFetchRecent(`/api/workspace/members/${member.userId}`, { method: 'DELETE' }); const result = await response.json();
    if (!response.ok) return setError(result.error || 'Could not remove member.');
    setMembers((items) => items.filter((item) => item.userId !== member.userId)); setNotice('Member removed from this workspace.');
  }
  async function toggleAI() {
    if(!workspace)return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await apiFetchRecent('/api/workspace/ai',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!workspace.aiCheckEnabled})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not update AI checking.');
      const updated={...workspace,aiCheckEnabled:result.data.enabled};setWorkspace(updated);onAISettingChanged(result.data.enabled);setNotice(result.data.enabled?'AI checking enabled. Review the disclosure before checking production content.':'AI checking disabled. Verification uses local deterministic checks only.');
    } catch(cause) { setError(cause.message); } finally { setBusy(false); }
  }

  return <div className="page-wrap page-secondary workspace-settings" data-enter>
    <div className="page-heading"><div><h1>Workspace</h1><p className="welcome-subtitle">Company identity and access for this team.</p></div></div>
    {error && <p className="workspace-alert" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}
    <section className="panel workspace-identity"><div className="workspace-section-heading"><span className="workspace-section-icon"><ShieldCheck size={19}/></span><div><h2>{workspace?.name || 'Loading workspace…'}</h2><p>Company workspace ID. Share it only when a teammate needs to select this workspace at sign-in.</p></div></div><div className="workspace-id-row"><code>{workspace?.id || '—'}</code><button className="button button-secondary" disabled={!workspace} onClick={() => copy(workspace.id, 'Workspace ID copied.')}><Copy size={15}/>Copy ID</button></div><p className="workspace-role">Your role: <strong>{roleLabels[user.role] || user.role}</strong></p></section>
    <DSPanel className="ai-workspace-setting"><div><span className="section-kicker">VERIFICATION</span><h2>AI claim checking <DSBadge tone={workspace?.aiCheckEnabled?'positive':'neutral'}>{workspace?.aiCheckEnabled?'Enabled':'Off'}</DSBadge></h2><p>{workspace?.aiCheckEnabled?'When enabled, draft sentences and retrieved approved-source passages are sent to Google through the Gemini API. Use a paid API tier with active billing for production data.':'When off, checks run locally with deterministic rules. No draft or source text is sent to Gemini.'}</p>{canManage&&<p>Google may process submitted content under its API terms. Verify paid-tier billing before enabling this for production data.</p>}</div>{canManage?<DSButton variant="secondary" disabled={!workspace||busy} aria-pressed={Boolean(workspace?.aiCheckEnabled)} onClick={toggleAI}>{workspace?.aiCheckEnabled?'Turn off AI checking':'Turn on AI checking'}</DSButton>:<p className="member-readonly">Only a workspace owner or administrator can change this setting.</p>}</DSPanel>
    <AccountSecurityPanel user={user} setError={setError} setNotice={setNotice}/>
    <section className="panel member-management"><div className="workspace-section-heading"><span className="workspace-section-icon"><Users size={19}/></span><div><h2>Company members</h2><p>Employees use their own email and password; their activity is attributed to their account.</p></div></div>
      {canManage ? <><form className="invite-form" onSubmit={inviteMember}><label>Employee email<input name="email" type="email" required placeholder="name@company.com"/></label><label>Workspace role<select name="role" defaultValue="creator">{roles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label><button className="button button-primary" disabled={busy}><Mail size={15}/>{busy ? 'Sending…' : 'Email invitation'}</button></form>
        {invite && <div className="invite-result"><div><strong>Invitation sent to {invite.email}</strong><span>Role: {roleLabels[invite.role]} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div></div>}
        <div className="member-table"><div className="member-table-head"><span>Employee</span><span>Role</span><span>Workspace access</span></div>{members.map((member) => <div className="member-row" key={member.userId}><strong>{member.email}{member.userId === user.id && <small> You</small>}</strong>{member.role === 'owner' ? <span className="role-owner">Owner</span> : <select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => updateRole(member, event.target.value)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>}<span className="member-access">{member.role === 'owner' ? 'Workspace owner' : 'Company member'}</span>{member.role !== 'owner' && <button className="remove-member" aria-label={`Remove ${member.email}`} onClick={() => remove(member)}><Trash2 size={16}/></button>}</div>)}</div>
      </> : <p className="member-readonly">Only a workspace owner or administrator can invite or manage members.</p>}
    </section>
  </div>;
}

function AccountSecurityPanel({user,setError,setNotice}) {
  const [sessions,setSessions]=useState([]); const [busy,setBusy]=useState(false); const [mfaSetup,setMfaSetup]=useState(null); const [recovery,setRecovery]=useState(null); const [mfaEnabled,setMfaEnabled]=useState(user.mfaEnabled);
  async function load(){const r=await fetch('/api/auth/sessions');const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load sessions.');setSessions(d.data||[]);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function verifyEmail(){const r=await apiFetch('/api/auth/email/resend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email})});setNotice(r.ok?'If your address needs verification, a message has been sent.':'Could not send a verification message.');}
  async function changeEmail(event){event.preventDefault();setBusy(true);const formElement=event.currentTarget;const f=new FormData(formElement);const r=await apiFetch('/api/auth/email/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:f.get('password'),newEmail:f.get('email')})});const d=await r.json();setBusy(false);if(!r.ok){setError(d.error||'Could not request email change.');return;}formElement.reset();setNotice(d.message);}
  async function revoke(id){const r=await apiFetch(`/api/auth/sessions/${id}`,{method:'DELETE'});if(!r.ok){setError('Could not revoke this session.');return;}await load();setNotice('Session revoked.');}
  async function all(){const r=await apiFetch('/api/auth/logout-everywhere',{method:'POST'});if(r.ok)window.location.assign('/');}
  async function beginMfa(){const r=await apiFetch('/api/auth/mfa/enroll/start',{method:'POST'});const d=await r.json();if(!r.ok){setError(d.error);return;}setMfaSetup(d.data);}
  async function confirmMfa(event){event.preventDefault();const code=new FormData(event.currentTarget).get('code');const r=await apiFetch('/api/auth/mfa/enroll/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const d=await r.json();if(!r.ok){setError(d.error);return;}setMfaEnabled(true);setRecovery(d.recoveryCodes);setNotice('Multi-factor authentication enabled. Save the recovery codes shown below.');}
  return <section className="panel member-management"><div className="workspace-section-heading"><span className="workspace-section-icon"><ShieldCheck size={19}/></span><div><h2>Account security</h2><p>Manage verification, your sign-in email, and active sessions.</p></div></div><div className="password-reset-row"><div><strong>Password</strong><p>If you forgot it or need to set one, send password-reset instructions to your email.</p></div><a className="button button-secondary" href="/forgot-password">Update password</a></div>{!user.emailVerified&&<div><p>Your email is not verified yet.</p><button className="button button-secondary" onClick={verifyEmail}>Send verification email</button></div>}<form className="invite-form" onSubmit={changeEmail}><label>New email address<input name="email" type="email" required/></label><label>Current password<input name="password" type="password" autoComplete="current-password" required/></label><button className="button button-secondary" disabled={busy}>Change email</button></form><h3>Multi-factor authentication</h3>{mfaEnabled?<p>Authenticator MFA is enabled for this account.</p>:!mfaSetup?<button className="button button-secondary" onClick={()=>beginMfa().catch(e=>setError(e.message))}>Set up authenticator</button>:<><p>Add this secret to an authenticator app: <code>{mfaSetup.secret}</code></p><form className="invite-form" onSubmit={confirmMfa}><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" required/></label><button className="button button-secondary">Confirm MFA setup</button></form></>}{recovery&&<div><h4>Save your one-time recovery codes</h4><ul>{recovery.map(code=><li key={code}><code>{code}</code></li>)}</ul></div>}<h3>Active sessions</h3>{sessions.map(s=><div className="member-row" key={s.id}><strong>{s.userAgent||'Unknown device'}<small> Last used {new Date(s.lastUsedAt).toLocaleString()}</small></strong><span>{s.workspaceId===user.workspace?.id?'This workspace':'Other workspace'}</span><button className="button button-secondary" onClick={()=>revoke(s.id)}>Revoke</button></div>)}<button className="button button-secondary" onClick={all}>Sign out everywhere</button></section>;
}
