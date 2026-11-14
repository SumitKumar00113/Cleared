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
| `GET /api/workspace/members` | `every workspace API family...` |
| `POST /api/workspace/invitations` | `every workspace API family...`; `workspace invites create members...` |
| `PATCH /api/workspace/members/:userId` | `every workspace API family...`; `membership role changes and removals revoke...` |
| `DELETE /api/workspace/members/:userId` | `every workspace API family...`; `membership role changes and removals revoke...` |
| `GET /api/reviews` | `every workspace API family...` (foreign workspace has no rows) |
| `POST /api/reviews` | `every workspace API family...` (created in caller workspace) |
| `PATCH /api/reviews/:id` | `every workspace API family...` (foreign review is 404) |
| `GET /api/sources` | `every workspace API family...` (foreign workspace has no rows) |
| `POST /api/sources` | `every workspace API family...` (created in caller workspace) |
| `GET /api/sources/:id/versions` | `source versions are retained...` (workspace-scoped history) |
| `POST /api/sources/:id/versions` | `source versions are retained and expired latest sources are excluded from verification` |
| `GET /api/sources/collections/:category/access` | `collection access policies deny unlisted members...` |
| `PUT /api/sources/collections/:category/access` | `collection access policies deny unlisted members...` (owner-configured user allowlist) |
| `DELETE /api/sources/:id` | `every workspace API family...` (foreign source is 404) |
| `POST /api/verification/check/:reviewId` | `every workspace API family...` (foreign review is 404) |
| `POST /api/files/:fileId/link` | `private source downloads are workspace and user bound...`; `bad text...` (quarantine denies links) |
| `GET /api/files/:fileId/download` | `private source downloads are workspace and user bound...` (cross-workspace, tampered/expired token, nosniff, quarantine recheck) |
| `POST /api/files/:fileId/scan` | `bad text...` exercises scanner-not-configured refusal through scanner adapter; route also requires workspace auth, manager role, and recent auth |

All state-changing routes are non-GET methods and are covered by the global CSRF middleware test. The Phase 2 upload suite also covers malformed UTF-8, binary/NUL bytes, oversize and multiple files, traversal-style names, quarantine, source expiry, retained versions, and collection allowlist behavior. This matrix records route-family and negative tenant-boundary coverage; it is not exhaustive fuzzing or a penetration test.
