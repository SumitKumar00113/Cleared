import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let directory;
let store;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cleared-workspace-access-'));
  process.env.CLEARED_DB_PATH = path.join(directory, 'test.sqlite');
  store = await import('../src/services/store.js');
});

after(async () => {
  store?.closeStore();
  await rm(directory, { recursive: true, force: true });
});

test('workspace invites create members, add existing accounts, and stay workspace scoped', async () => {
  const ownerA = await store.createWorkspaceAccount({ workspaceName: 'Company A', email: 'owner-a@example.test', password: 'OwnerPassword!123' });
  assert.match(ownerA.workspace.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const firstInvite = store.createInvitation({ workspaceId: ownerA.workspace.id, email: 'employee@example.test', role: 'reviewer', createdBy: ownerA.user.userId });

  const employee = await store.acceptInvitation({ token: firstInvite.token, email: firstInvite.email, password: 'EmployeePassword!123' });
  assert.equal(employee.user.role, 'reviewer');
  assert.equal(employee.user.workspaceId, ownerA.workspace.id);
  assert.equal((await store.authenticateUser('employee@example.test', 'EmployeePassword!123')).id, employee.user.userId);

  const ownerB = await store.createWorkspaceAccount({ workspaceName: 'Company B', email: 'owner-b@example.test', password: 'OwnerPassword!123' });
  const secondInvite = store.createInvitation({ workspaceId: ownerB.workspace.id, email: 'employee@example.test', role: 'creator', createdBy: ownerB.user.userId });

  const badPassword = await store.acceptInvitation({ token: secondInvite.token, email: secondInvite.email, password: 'wrong' });
  assert.ok(badPassword.error);
  assert.equal(store.getMembership(ownerB.workspace.id, employee.user.userId), null);

  const secondMembership = await store.acceptInvitation({ token: secondInvite.token, email: secondInvite.email, password: 'EmployeePassword!123' });
  assert.equal(secondMembership.user.role, 'creator');
  assert.equal(store.getMembership(ownerA.workspace.id, employee.user.userId).role, 'reviewer');
  assert.equal(store.getMembership(ownerB.workspace.id, employee.user.userId).role, 'creator');

  store.saveReview(ownerA.workspace.id, { id: 'review-a', title: 'Company A review', status: 'In review' });
  assert.equal(store.getReviews(ownerB.workspace.id).length, 0);

  const replay = await store.acceptInvitation({ token: secondInvite.token, email: secondInvite.email, password: 'EmployeePassword!123' });
  assert.ok(replay.error);
});
