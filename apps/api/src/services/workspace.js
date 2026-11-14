import { Router } from 'express';
import { createInvitation, getWorkspace, listMembers, changeMemberRole, removeMember, getWorkspaceMemberByEmail } from './store.js';
import { authRateLimit, requireRole } from './auth.js';

export const workspaceRouter = Router();
const roleSet = new Set(['creator', 'reviewer', 'brand_manager', 'administrator']);

workspaceRouter.get('/', (request, response) => {
  const workspace = getWorkspace(request.user.workspaceId);
  if (!workspace) return response.status(404).json({ error: 'Workspace not found.' });
  return response.json({ data: { ...workspace, role: request.user.role } });
});

workspaceRouter.get('/members', requireRole(['owner', 'administrator']), (request, response) => response.json({ data: listMembers(request.user.workspaceId) }));

workspaceRouter.post('/invitations', authRateLimit, requireRole(['owner', 'administrator']), (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const role = String(request.body?.role || 'creator');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Enter a valid employee email address.' });
  if (!roleSet.has(role)) return response.status(400).json({ error: 'Choose a supported workspace role.' });
  if (getWorkspaceMemberByEmail(request.user.workspaceId, email)) return response.status(409).json({ error: 'Could not create this invitation.' });
  const invitation = createInvitation({ workspaceId: request.user.workspaceId, email, role, createdBy: request.user.userId });
  const base = String(process.env.APP_BASE_URL || request.get('origin') || `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
  return response.status(201).json({ data: { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, inviteUrl: `${base}/join?token=${encodeURIComponent(invitation.token)}&email=${encodeURIComponent(invitation.email)}` } });
});

workspaceRouter.patch('/members/:userId', requireRole(['owner', 'administrator']), (request, response) => {
  const role = String(request.body?.role || '');
  if (!roleSet.has(role)) return response.status(400).json({ error: 'Choose a supported workspace role.' });
  const member = changeMemberRole(request.user.workspaceId, request.params.userId, role);
  return member ? response.json({ data: member }) : response.status(404).json({ error: 'Member not found or their owner role cannot be changed.' });
});

workspaceRouter.delete('/members/:userId', requireRole(['owner', 'administrator']), (request, response) => {
  const removed = removeMember(request.user.workspaceId, request.params.userId);
  return removed ? response.json({ removed: true }) : response.status(404).json({ error: 'Member not found or a workspace owner cannot be removed.' });
});
