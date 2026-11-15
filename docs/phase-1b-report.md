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
    | Sources and private files | Tenant isolation for source listing, creation, deletion, versions, collection access, and signed downloads |
    | Review history and audit | Workspace-scoped review history and audit list/export |

    The route matrix documents negative tenant-boundary checks and route-family coverage; it does not claim exhaustive fuzzing or penetration testing.

    ## Frontend screens completed

    The current frontend includes a public landing page, sign-in and workspace creation, invitation acceptance, email verification, password reset and account unlock, MFA challenge and enrollment/recovery-code display, workspace overview and review queue, review desk with revision history, approved sources, insights, workspace settings, and account security/session management. Claim verification is available when a Gemini API key is configured; without one, the provider is unavailable.

    ## MFA tests

    MFA assertions are separated into dedicated tests: `MFA rejects replay of an accepted TOTP step` and `MFA recovery codes are one-time`. The earlier workspace bootstrap test continues to cover MFA enrollment and recovery-code hash persistence.

    ## Review history status

    The planned review **History** panel is implemented in the review detail drawer. Its timeline combines revision history, decisions, and relevant audit events, scoped to the accessible review. The API exposes it at `GET /api/reviews/:id/history`.

    Each submission or text edit creates a revision with editor, timestamp, and content hash. Decisions link to the exact revision they considered. The review history and audit list/export routes have cross-workspace isolation coverage in `security-route-test-matrix.md`.

    This file records the earlier Phase 1b implementation report. The current implementation has since added revision-bound decisions, review history, file security, and in-app notifications; refer to the root README and route matrix for current behavior.
