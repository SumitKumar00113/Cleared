# API route security test matrix

Cross-workspace tests use two separately created workspaces and exercise foreign workspace, member, review, source, and session identifiers. Public authentication routes have no workspace object lookup unless a valid single-use invitation establishes the destination workspace.

| API route | Cross-workspace / security test coverage |
| --- | --- |
| `GET /api/health` | `cookie writes require CSRF and responses include security headers` (public health response) |
| `GET /api/auth/csrf` | `cookie writes require CSRF`; `CSRF tokens are session-bound` |
| `GET /api/auth/session` | `database sessions persist...`; `every workspace API family keeps cross-workspace identifiers isolated` |
| `POST /api/auth/workspaces` | `workspace bootstrap issues its own authenticated session`; `cookie writes require CSRF` |
| `POST /api/auth/login` | `login failures use generic errors and progressive lockout`; `workspace bootstrap...` (MFA challenge creation) |
| `POST /api/auth/invitations/accept` | `invitation acceptance failures are generic and progressively locked`; `every workspace API family...` |
| `POST /api/auth/email/resend` | `workspace bootstrap issues its own authenticated session` (resend + generic response) |
| `POST /api/auth/email/verify` | `workspace bootstrap...` (valid, expired, and reused link) |
| `POST /api/auth/password/forgot` | `password reset is generic, hashed, expiring, single-use...` (known and unknown email) |
| `POST /api/auth/password/reset` | `password reset is generic, hashed, expiring, single-use...` (tampered, wrong-account, expired, reused, session revocation) |
| `POST /api/auth/account/unlock` | `password reset is generic, hashed, expiring, single-use...` (generic known/unknown response, hashed single-use unlock link, pair-counter clearing) |
| `POST /api/auth/email/change` | `email change requires the current password...` |
| `POST /api/auth/mfa/challenge` | `MFA rejects replay of an accepted TOTP step`; `MFA recovery codes are one-time` |
| `POST /api/auth/mfa/enroll/start` | `workspace bootstrap...` (required setup and encrypted secret storage) |
| `POST /api/auth/mfa/enroll/confirm` | `workspace bootstrap...` (valid-code completion, recovery-code hashes) |
| `POST /api/auth/reauth` | `CSRF tokens are session-bound`; `membership role changes and removals revoke...` (recent-auth gate) |
| `GET /api/auth/sessions` | `database sessions persist...`; `every workspace API family...` |
| `DELETE /api/auth/sessions/:sessionId` | `database sessions persist...`; `every workspace API family...` (foreign session id is 404) |
| `POST /api/auth/logout` | `sign out everywhere...`; `MFA challenges reject...` |
| `POST /api/auth/logout-everywhere` | `sign out everywhere revokes every session for the account` |
| `GET /api/workspace` | `every workspace API family keeps cross-workspace identifiers isolated` |
| `PATCH /api/workspace/ai` | Workspace AI consent is workspace scoped; non-owner/administrator roles are denied; recent authentication and CSRF are required. |
| `GET /api/workspace/members` | `every workspace API family keeps cross-workspace identifiers isolated` (foreign member is absent) |
| `POST /api/workspace/invitations` | `every workspace API family keeps cross-workspace identifiers isolated`; `workspace invites create members...` (invitation is created only in caller workspace) |
| `PATCH /api/workspace/members/:userId` | `every workspace API family...`; `membership role changes and removals revoke...` |
| `DELETE /api/workspace/members/:userId` | `every workspace API family...`; `membership role changes and removals revoke...` |
| `GET /api/reviews` | `every workspace API family keeps cross-workspace identifiers isolated` (A's review is absent from B list) |
| `POST /api/reviews` | `every workspace API family keeps cross-workspace identifiers isolated` (create is scoped to caller workspace) |
| `PATCH /api/reviews/:id` | `every workspace API family keeps cross-workspace identifiers isolated` (foreign review is 404); `review revisions are attributed...` (revision and decision binding) |
| `GET /api/reviews/:id/history` | `review history and audit list/export remain isolated across workspaces` (foreign review is 404) |
| `GET /api/sources` | `every workspace API family keeps cross-workspace identifiers isolated` (A source is absent from B list) |
| `POST /api/sources` | `every workspace API family keeps cross-workspace identifiers isolated` (create is scoped to caller workspace) |
| `GET /api/sources/:id/versions` | `source versions are retained...`; `review history and audit list/export remain isolated across workspaces` (foreign source is 404) |
| `POST /api/sources/:id/versions` | `source versions are retained...`; `review history and audit list/export remain isolated across workspaces` (foreign source is 404) |
| `GET /api/sources/collections/:category/access` | `collection access policies deny unlisted members...`; `review history and audit list/export remain isolated across workspaces` (A policy is absent in B) |
| `PUT /api/sources/collections/:category/access` | `collection access policies deny unlisted members...`; `review history and audit list/export remain isolated across workspaces` (foreign user ID rejected) |
| `DELETE /api/sources/:id` | `every workspace API family keeps cross-workspace identifiers isolated` (foreign source is 404) |
| `POST /api/verification/check/:reviewId` | `every workspace API family keeps cross-workspace identifiers isolated` (foreign review is 404) |
| `GET /api/verification/jobs/:jobId` | Verification job lookup is workspace scoped; foreign job IDs return 404. |
| `POST /api/files/:fileId/link` | `private source downloads are workspace and user bound...`; `review history and audit list/export remain isolated...` (foreign file is 404); `bad text...` (quarantine denies links) |
| `GET /api/files/:fileId/download` | `private source downloads are workspace and user bound...`; `review history and audit list/export remain isolated...` (cross-workspace signed link, tampered/expired token, nosniff, quarantine recheck) |
| `POST /api/files/:fileId/scan` | `review history and audit list/export remain isolated...` (foreign file is 404); `bad text...` exercises scanner refusal; route also requires manager role and recent auth |
| `GET /api/workspace/audit` | `review history and audit list/export remain isolated across workspaces` (workspace B cannot list A events) |
| `GET /api/workspace/audit/export` | `review history and audit list/export remain isolated across workspaces` (workspace B export contains no A identifiers) |
| `GET /api/workspace/audit/integrity` | Owner/administrator-only integrity report uses the authenticated workspace ID; chain tampering and interior deletion are tested by `per-workspace audit hash chain detects edited events and removed interior events`. |
| `GET /api/notifications` | `notifications are isolated by workspace and recipient for listing and marking read` (workspace B cannot see A notifications; workspace A owner cannot see member A's notifications) |
| `PATCH /api/notifications/:id/read` | `notifications are isolated by workspace and recipient for listing and marking read` (owner cannot mark same-workspace member notification; foreign-workspace notification returns 404; recipient can mark own notification) |

Routes that create records (`POST /api/reviews`, `POST /api/sources`, invitation creation) have no foreign object identifier to probe; tests verify records are created in the authenticated workspace. Account-only authentication routes also do not accept a foreign workspace object except login/invitation/session identifiers, which are covered by the named tests above. Notification list/read endpoints have dedicated cross-workspace and cross-user negative tests in `notifications are isolated by workspace and recipient for listing and marking read`. The AI setting and job lookup are workspace scoped and include authorization checks; their role, revision idempotency, and foreign-ID tests are recorded with the feature tests. All state-changing routes are non-GET methods and are covered by the global CSRF middleware test. The upload suite covers malformed UTF-8, binary/NUL bytes, oversize and multiple files, traversal-style names, quarantine, source expiry, retained versions, and collection allowlist behavior. This matrix is test coverage documentation, not exhaustive fuzzing or a penetration test.
