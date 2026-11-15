import { Router } from 'express';
import { createInvitation, getWorkspace, listMembers, changeMemberRole, removeMember, getWorkspaceMemberByEmail, revokeInvitation, listAuditEvents, recordAuditEvent, verifyAuditChain, getWorkspaceAIEnabled, setWorkspaceAIEnabled } from './store.js';
import { authRateLimit, requireRecentAuth, requireRole } from './auth.js';
import { sendMail } from './mailer.js';

export const workspaceRouter = Router();
const roleSet = new Set(['creator', 'reviewer', 'brand_manager', 'administrator']);

workspaceRouter.get('/', (request, response) => {
  const workspace = getWorkspace(request.user.workspaceId);
  if (!workspace) return response.status(404).json({ error: 'Workspace not found.' });
  return response.json({ data: { ...workspace, role: request.user.role, aiCheckEnabled: getWorkspaceAIEnabled(request.user.workspaceId) } });
});

workspaceRouter.patch('/ai', requireRole(['owner','administrator']), requireRecentAuth, (request,response)=>{
  if(typeof request.body?.enabled!=='boolean')return response.status(400).json({error:'AI checking must be enabled or disabled.'});
  return response.json({data:setWorkspaceAIEnabled(request.user.workspaceId,request.body.enabled,request.user.userId)});
});

workspaceRouter.get('/audit', requireRole(['owner','administrator']), (request,response)=>{
  const data=listAuditEvents(request.user.workspaceId,{limit:request.query.limit,before:request.query.before||null});
  return response.json({data});
});
workspaceRouter.get('/audit/export', requireRole(['owner','administrator']), (request,response)=>{
  const rows=listAuditEvents(request.user.workspaceId,{limit:1000,before:request.query.before||null});
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'audit.exported',targetType:'workspace',targetId:request.user.workspaceId,requestOrigin:request.get('origin')||request.get('referer')||null,details:{rowCount:rows.length}});
  const quote=(value)=>{
    let text=String(value??'');
    if (/^[=+\-@\t\r]/.test(text)) text=`'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  const csv=['id,workspaceId,actorId,actorEmail,action,targetType,targetId,occurredAt,requestOrigin,details',...rows.map((row)=>[row.id,row.workspaceId,row.actorId,row.actorEmail,row.action,row.targetType,row.targetId,row.occurredAt,row.requestOrigin,JSON.stringify(row.details)].map(quote).join(','))].join('\r\n');
  response.setHeader('Content-Type','text/csv; charset=utf-8'); response.setHeader('Content-Disposition','attachment; filename="workspace-audit.csv"'); response.setHeader('Cache-Control','private, no-store');
  return response.send(csv);
});
workspaceRouter.get('/audit/integrity', requireRole(['owner','administrator']), (request,response)=>response.json({data:verifyAuditChain(request.user.workspaceId)}));

workspaceRouter.get('/members', requireRole(['owner', 'administrator']), (request, response) => response.json({ data: listMembers(request.user.workspaceId) }));

workspaceRouter.post('/invitations', authRateLimit, requireRole(['owner', 'administrator']), async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const role = String(request.body?.role || 'creator');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Enter a valid employee email address.' });
  if (!roleSet.has(role)) return response.status(400).json({ error: 'Choose a supported workspace role.' });
  if (getWorkspaceMemberByEmail(request.user.workspaceId, email)) return response.status(409).json({ error: 'Could not create this invitation.' });
  const invitation = createInvitation({ workspaceId: request.user.workspaceId, email, role, createdBy: request.user.userId });
  const base = String(process.env.APP_BASE_URL || request.get('origin') || `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
  const inviteUrl = `${base}/join?token=${encodeURIComponent(invitation.token)}&email=${encodeURIComponent(invitation.email)}`;
  try { await sendMail({ to: invitation.email, subject: 'You are invited to Cleared', text: `You have been invited to join ${request.user.workspaceName} as ${invitation.role}. Accept the invitation within seven days: ${inviteUrl}` }); }
  catch (error) { revokeInvitation(invitation.id); console.error('Email delivery failed:', error?.name || 'Error'); return response.status(503).json({ error: 'The invitation could not be emailed. Please try again.' }); }
  recordAuditEvent({workspaceId:request.user.workspaceId,actorId:request.user.userId,action:'invitation.sent',targetType:'invitation',targetId:invitation.id,requestOrigin:request.get('origin')||request.get('referer')||null,details:{role:invitation.role}});
  return response.status(201).json({ data: { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, emailSent: true } });
});

workspaceRouter.patch('/members/:userId', requireRole(['owner', 'administrator']), requireRecentAuth, (request, response) => {
  const role = String(request.body?.role || '');
  if (!roleSet.has(role)) return response.status(400).json({ error: 'Choose a supported workspace role.' });
  const member = changeMemberRole(request.user.workspaceId, request.params.userId, role);
  return member ? response.json({ data: member }) : response.status(404).json({ error: 'Member not found or their owner role cannot be changed.' });
});

workspaceRouter.delete('/members/:userId', requireRole(['owner', 'administrator']), requireRecentAuth, (request, response) => {
  const removed = removeMember(request.user.workspaceId, request.params.userId);
  return removed ? response.json({ removed: true }) : response.status(404).json({ error: 'Member not found or a workspace owner cannot be removed.' });
});
