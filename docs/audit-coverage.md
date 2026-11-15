# Audit event coverage

Audit event names below are the values written to `audit_events.action`. Workspace-scoped events are hash chained. Unattributable authentication failures may be stored without a workspace ID and therefore are not included in a workspace chain.

| Action | Recorded | Event name | Code location |
| --- | --- | --- | --- |
| Sign-in | Yes | `auth.sign_in` | `apps/api/src/services/auth.js` — login and MFA challenge success |
| Failed sign-in | Yes, when a workspace can be identified | `auth.sign_in_failed` | `apps/api/src/services/auth.js` — `/login` |
| Lockout | Yes, when an authenticated or workspace-addressable account is known | `auth.lockout` | `apps/api/src/services/auth.js` — rate-limit middleware |
| Sign-out | Yes | `auth.sign_out` | `apps/api/src/services/auth.js` — `/logout` |
| Sign-out everywhere | Yes | `auth.sign_out_everywhere` | `apps/api/src/services/auth.js` — `/logout-everywhere` |
| Session revoked | Yes | `auth.session_revoked` | `apps/api/src/services/auth.js` — `DELETE /sessions/:sessionId` |
| MFA enrolled | Yes | `mfa.enabled` | `apps/api/src/services/auth.js` — `/mfa/enroll/confirm` |
| MFA challenge success | Yes | `mfa.challenge_succeeded` | `apps/api/src/services/auth.js` — `/mfa/challenge` |
| MFA challenge failure | Yes, when a live challenge identifies the account | `mfa.challenge_failed` | `apps/api/src/services/auth.js` — `/mfa/challenge` |
| Recovery code used | Yes | `mfa.recovery_code_used` | `apps/api/src/services/auth.js` — successful `/mfa/challenge` |
| Password reset | Yes | `auth.password_reset` | `apps/api/src/services/auth.js` — `/password/reset` |
| Email change | Yes | `auth.email_change_requested`, `auth.email_changed` | `apps/api/src/services/auth.js` — `/email/change` and `/email/verify` |
| Invitation sent | Yes | `invitation.sent` | `apps/api/src/services/workspace.js` — `POST /invitations` |
| Invitation accepted | Yes | `invitation.accepted` | `apps/api/src/services/auth.js` — `/invitations/accept` |
| Role change | Yes | `member.role_changed` | `apps/api/src/server.js` — completed `PATCH /workspace/members/:userId` |
| Member removed | Yes | `member.removed` | `apps/api/src/server.js` — completed `DELETE /workspace/members/:userId` |
| Source created | Yes | `source.upload` | `apps/api/src/services/store.js` — `saveSourceVersion` for version 1 |
| Source new version | Yes | `source.new_version` | `apps/api/src/services/store.js` — `saveSourceVersion` for later versions |
| Source deleted | Yes | `source.deleted` | `apps/api/src/services/store.js` — `deleteSource` |
| Collection access changed | Yes | `collection.access_changed` | `apps/api/src/services/sources.js` — `PUT /collections/:category/access` |
| File scan result | Yes | `file.scan_result` | `apps/api/src/services/store.js` — `updateStoredFileScan` |
| File link issued | Yes | `file.link_issued` | `apps/api/src/services/files.js` — `POST /:fileId/link` |
| File downloaded | Yes | `file.download` | `apps/api/src/services/files.js` — `GET /:fileId/download` |
| Review created | Yes | `review.submitted` | `apps/api/src/services/store.js` — first `saveReview` revision |
| Review revision created | Yes | `review.revised` | `apps/api/src/services/store.js` — subsequent `saveReview` revisions |
| Verification started | Yes | `verification.started` | `apps/api/src/services/verification.js` — worker start |
| Verification completed | Yes | `verification.completed` | `apps/api/src/services/verification.js` — successful worker completion |
| Verification failed | Yes | `verification.failed` | `apps/api/src/services/verification.js` — terminal worker failure |
| Verification cap hit | Yes | `verification.cap_hit` | `apps/api/src/services/verification.js` — workspace rate or daily cap |
| Approved | Yes | `review.approved` | `apps/api/src/services/store.js` — decision persistence |
| Rejected | Yes | `review.rejected` | `apps/api/src/services/store.js` — decision persistence |
| Changes requested | Yes | `review.needs_changes` | `apps/api/src/services/store.js` — decision persistence |
| Audit export | Yes | `audit.exported` | `apps/api/src/services/workspace.js` — `GET /audit/export` |
| AI setting changed | Yes | `workspace.ai_setting_changed` | `apps/api/src/services/store.js` — `setWorkspaceAIEnabled` |

The default table triggers reject audit row updates and deletes. Each event also stores its prior hash and a SHA-256 hash over canonical event content. `GET /api/workspace/audit/integrity` and `npm run audit:verify --workspace @cleared/api -- <workspace-id>` check workspace chains. The chain detects content edits and removal of an event that has a later event chained to it. It cannot independently prove that the newest event was not removed or that a host administrator did not replace the whole database and recompute the chain; ship logs to a separate store for stronger operational assurance.

This table documents event emission points, not a claim that every event is tamper-proof or that every route combination has been tested. Route-level negative coverage is listed in [security-route-test-matrix.md](security-route-test-matrix.md).
