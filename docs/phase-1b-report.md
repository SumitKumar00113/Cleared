# Phase 1b report

## Security and dependency notes

- **CSRF binding:** For an authenticated session, the CSRF token is an HMAC-SHA-256 derived from that session's cookie ID (`csrf-session:${sessionId}`), then signed with the application session secret. The server checks the signed session cookie, the `cleared_csrf` cookie, and the `X-CSRF-Token` request header together. A token from a different session does not validate. Unauthenticated flows use a separately signed pre-auth token. See `apps/api/src/services/auth.js` and the session-binding test.
- **CSP:** `script-src 'self'`; scripts are not permitted to use `'unsafe-inline'`. The policy still allows `'unsafe-inline'` for styles (`style-src`), which is separate from scripts.
- **Production session cookie:** Yes. Production names it `__Host-cleared_session` and sets `Secure`, `Path=/`, `HttpOnly`, and `SameSite=Lax`, with no `Domain` attribute.
- **Mail outbox:** The in-memory development outbox is selected only when `NODE_ENV !== 'production'`. Production mail goes through the configured SMTP transport; production environment validation requires SMTP settings. There is no production flag or configuration path that enables the in-memory outbox.
- **Audit dependency:** `webpack-dev-server` was upgraded from `^5.2.0` to `^6.1.0` in `apps/web/package.json` and the lockfile. It is a web workspace `devDependency`, so it is not part of the production app runtime/bundle.

## Route coverage

The detailed route-by-route matrix is maintained in [security-route-test-matrix.md](security-route-test-matrix.md). Summary of covered route families:

| Route family | Coverage recorded |
| --- | --- |
| Health and CSRF | Security headers, CSRF enforcement, session-bound CSRF tokens |
| Authentication and account actions | Session lifecycle, login/invitation lockouts, email verification/change, reset and unlock token properties, MFA enrollment/challenge, logout and reauthentication |
| Workspace and membership | Cross-workspace isolation, invitations, role changes/removal and revocation |
| Reviews and verification | Tenant isolation for listing, creation, updates and claim checks |
| Sources | Tenant isolation for listing, creation and deletion |

The route matrix documents negative tenant-boundary checks and route-family coverage; it does not claim exhaustive fuzzing or penetration testing.

## Frontend screens completed

Implemented screens in the current Phase 1b work include sign-in and workspace creation, invitation acceptance, email verification and pending verification, forgot/reset password and account unlock, MFA challenge and enrollment/recovery-code display, workspace dashboard/review queue, review desk, approved sources, insights, workspace settings, and account security/session management. Claim verification remains an explicit not-connected state until a provider is configured.

## MFA tests

MFA assertions are separated into dedicated tests: `MFA rejects replay of an accepted TOTP step` and `MFA recovery codes are one-time`. The earlier workspace bootstrap test continues to cover MFA enrollment and recovery-code hash persistence.

## Phase 3 follow-up: review history

Add a **History** panel to each review detail page/drawer. Build its timeline from the audit log and decisions tables, ordered chronologically, and show:

- Initial submission, with submitter name and time.
- Every draft revision, with editor name and time, and enough revision identity to link decisions to the text version.
- Every reviewer action, with actor and time.
- The final decision, with decision maker and time, plus the exact revision approved (or the revision considered for a rejection).

Show the panel to every user already authorized to open that review, using the same workspace and review access checks. The backend must return only history belonging to that accessible review. Keep the audit log and decisions tables as the source of truth; if either table or the revision linkage is not present in the deployed data model, Phase 3 must add it before the panel can be complete. The current Phase 1b model does not yet record a review event history or text revisions.

## Commit

Latest committed baseline: `d8f5d2d78e4aa7fbacfc505f78f6d208687b60ca` (`Harden identity and sessions phase 1a`). Phase 1b report and implementation changes are present in the working tree and are not included in that commit.
