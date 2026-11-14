import React, { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { Check, Copy, Mail, ShieldCheck, Trash2, Users } from 'lucide-react';

const roles = ['creator', 'reviewer', 'brand_manager', 'administrator'];
const roleLabels = { creator: 'Creator', reviewer: 'Reviewer', brand_manager: 'Brand manager', administrator: 'Administrator', owner: 'Owner' };

export default function WorkspaceSettings({ user }) {
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
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiFetch('/api/workspace/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not create invitation.');
      setInvite(result.data); event.currentTarget.reset(); setNotice('Invitation link created. Copy it and send it to your coworker.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function copy(text, success) { try { await navigator.clipboard.writeText(text); setNotice(success); } catch { setError('Clipboard access was denied. Select and copy the text manually.'); } }
  async function updateRole(member, role) {
    const response = await apiFetch(`/api/workspace/members/${member.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not update role.');
    setMembers((items) => items.map((item) => item.userId === member.userId ? { ...item, role } : item)); setNotice('Member role updated.');
  }
  async function remove(member) {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    const response = await apiFetch(`/api/workspace/members/${member.userId}`, { method: 'DELETE' }); const result = await response.json();
    if (!response.ok) return setError(result.error || 'Could not remove member.');
    setMembers((items) => items.filter((item) => item.userId !== member.userId)); setNotice('Member removed from this workspace.');
  }

  return <div className="page-wrap page-secondary workspace-settings" data-enter>
    <div className="page-heading"><div><h1>Workspace</h1><p className="welcome-subtitle">Company identity and access for this team.</p></div></div>
    {error && <p className="workspace-alert" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}
    <section className="panel workspace-identity"><div className="workspace-section-heading"><span className="workspace-section-icon"><ShieldCheck size={19}/></span><div><h2>{workspace?.name || 'Loading workspace…'}</h2><p>Company workspace ID. Share it only when a teammate needs to select this workspace at sign-in.</p></div></div><div className="workspace-id-row"><code>{workspace?.id || '—'}</code><button className="button button-secondary" disabled={!workspace} onClick={() => copy(workspace.id, 'Workspace ID copied.')}><Copy size={15}/>Copy ID</button></div><p className="workspace-role">Your role: <strong>{roleLabels[user.role] || user.role}</strong></p></section>
    <section className="panel member-management"><div className="workspace-section-heading"><span className="workspace-section-icon"><Users size={19}/></span><div><h2>Company members</h2><p>Employees use their own email and password; their activity is attributed to their account.</p></div></div>
      {canManage ? <><form className="invite-form" onSubmit={inviteMember}><label>Employee email<input name="email" type="email" required placeholder="name@company.com"/></label><label>Workspace role<select name="role" defaultValue="creator">{roles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label><button className="button button-primary" disabled={busy}><Mail size={15}/>{busy ? 'Creating…' : 'Create invite link'}</button></form>
        {invite && <div className="invite-result"><div><strong>Invite for {invite.email}</strong><span>Role: {roleLabels[invite.role]} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div><code>{invite.inviteUrl}</code><button className="button button-secondary" onClick={() => copy(invite.inviteUrl, 'Invite link copied.')}><Copy size={15}/>Copy link</button></div>}
        <div className="member-table"><div className="member-table-head"><span>Employee</span><span>Role</span><span>Workspace access</span></div>{members.map((member) => <div className="member-row" key={member.userId}><strong>{member.email}{member.userId === user.id && <small> You</small>}</strong>{member.role === 'owner' ? <span className="role-owner">Owner</span> : <select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => updateRole(member, event.target.value)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>}<span className="member-access">{member.role === 'owner' ? 'Workspace owner' : 'Company member'}</span>{member.role !== 'owner' && <button className="remove-member" aria-label={`Remove ${member.email}`} onClick={() => remove(member)}><Trash2 size={16}/></button>}</div>)}</div>
      </> : <p className="member-readonly">Only a workspace owner or administrator can invite or manage members.</p>}
    </section>
  </div>;
}
