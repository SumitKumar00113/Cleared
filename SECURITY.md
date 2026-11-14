# Security policy

## Reporting a vulnerability

Please report suspected security issues privately to the project maintainers. Include the affected route or feature, a brief impact description, and steps to reproduce. Do not include real customer documents, passwords, access tokens, or other personal data. The repository does not currently publish a dedicated security contact; add a monitored security email or GitHub private vulnerability reporting destination before public launch.

Please allow maintainers time to investigate and prepare a fix before public disclosure. This project has not undergone a penetration test or independent security assessment and does not claim a compliance certification.

## Security status

Cleared uses the existing Express + SQLite runtime. Implemented identity controls include hashed database-backed sessions, async scrypt, account-and-IP throttling, CSRF protection, verified-email and reset links, TOTP MFA and recovery codes, and a configurable SMTP mailer. Phase 2 adds private file storage, text validation, quarantine, scan gating, source versions/expiry, and short-lived authorized downloads. Phase 3 adds append-only workspace audit events, normalized review/source tables, content-hashed review revisions, revision-bound decisions, and a review history panel. Independent security review, backup/restore validation, and deployment hardening remain outstanding. This project makes no SOC 2, ISO 27001, GDPR, or other compliance certification claim.

The Supabase migration under `supabase/migrations` remains an inactive PostgreSQL/RLS planning scaffold. It is not used by the API runtime. Recommendation: retain it as a reference, but require schema parity review before using it; Express + SQLite remains the only runtime.

## Current operational requirements and limits

- Use Node 24.19.x, as declared by the root and API package `engines` fields.
- Set `SESSION_SECRET` to a cryptographically random value of at least 32 characters. Production startup also requires HTTPS `APP_BASE_URL`, exact HTTPS `CORS_ORIGINS`, SMTP credentials, `MAIL_FROM`, and a 32-byte `MFA_ENCRYPTION_KEY`.
- Production file storage requires `FILE_STORAGE=s3`, an HTTPS S3-compatible endpoint, bucket, and server-side access credentials. Keep the bucket private and restrict its IAM policy to the API service. Production scanner configuration uses `FILE_SCANNER=clamav` and `CLAMAV_HOST` (optional `CLAMAV_PORT`); without a scanner, uploads remain quarantined and cannot be downloaded or used for verification.
- Sessions are database-backed, but the current SQLite database remains a single-instance local database. Backups, restore drills, and multi-instance deployment are not configured.
- Session records retain a SHA-256 hash of the random cookie ID, user/workspace, expiry, user agent, creation and last-use timestamps, MFA verification and recent-authentication timestamps, and revocation time. Login rotates the cookie ID. The cookie remains `HttpOnly; SameSite=Lax`; production uses `__Host-cleared_session; Secure; Path=/` with no Domain attribute. Revoked/expired sessions are purged at startup and hourly.
- Passwords use asynchronous scrypt with N=131072, r=8, p=1 and 64-byte output. Existing rows are read with the legacy N=16384 parameters and rehashed after successful login. The current common-password denylist is small and does not replace breached-password screening.
- CSRF uses a readable, SameSite=Strict double-submit cookie and `X-CSRF-Token` on unsafe requests. This protects against cross-site request forgery; it does not protect against same-origin script injection.
- Login, invitation acceptance, MFA and password reset use persistent SQLite counters with account+IP progressive failure lockouts and IP request limits; account lockouts do not aggregate failures across IPs. Restart does not reset counters. Successful reset clears account lockouts.
- Reset links are random, SHA-256 hashed at rest, single-use, and expire after 30 minutes. Reset revokes all account sessions. Email changes require the current password, verify the new address, and notify the old address. Invitation acceptance marks the invited address verified.
- TOTP secrets are AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY`; recovery codes are hashed and consumed once; repeated TOTP steps are rejected. Elevated workspace roles require verified email and MFA. Existing elevated accounts can authenticate into a restricted MFA setup state to enroll. Sensitive membership, source deletion, and approval actions require recent authentication.
- Mail content and action links are printed only in development. Production uses SMTP configured by environment and logs only delivery failure type. Invitation links are not returned to the browser.
- CSRF uses a session-bound HMAC token in a SameSite=Strict readable cookie and `X-CSRF-Token`; unauthenticated flows use a separate signed pre-auth token. Safe GET routes do not update persistent session activity. The CSP does not allow `unsafe-inline` scripts; inline styles remain for the existing design. HSTS is emitted only in production.
- See [the API route security test matrix](docs/security-route-test-matrix.md) for the route-to-test mapping. These tests are not a penetration test and do not exhaustively prove every request combination.
- Uploads accept UTF-8 TXT, MD, and CSV only, up to 20 MiB and one file per request. Binary bytes, invalid UTF-8, NUL, and control bytes are rejected. PDF/DOCX signature validation is scaffolded as a future extension point but those formats are not accepted.
- Files are written to private local disk in non-production environments or a configured S3-compatible private bucket in production. No upload directory is mounted for static/public serving. Download links last 120 seconds and are bound to the authenticated user, workspace, and file; each request rechecks current membership and review/source access. Responses use attachment disposition and `nosniff`.
- Every uploaded file starts quarantined. Configured ClamAV scans can mark it clean or rejected. With no scanner in development, the explicit bypass emits a warning and marks it clean for local use; production cannot mark an upload clean without a configured scanner. Scanner outages leave files quarantined.
- Sources retain immutable version rows with owner, uploader, checksum, upload time, and optional expiry. Gemini verification reads only the latest clean, unexpired source version and records the source ID and version with each finding. Brand managers can see expired and expiring-soon state in the source screen.
- `audit_events` is append-only: database triggers reject update and delete attempts, and the application only inserts events. It records sign-in activity, MFA, membership and invitations, source/file actions, verification, revision changes, and decisions. Owner/administrator list and CSV export endpoints always filter by the authenticated workspace. Audit request origins are recorded as supplied Origin/Referer metadata; clients can omit them.
- Each review revision records editor, timestamp, content hash and draft text. Decisions reference the exact revision, and approval/rejection is blocked for the submitting user even if that user is an owner or administrator. Editing after a final decision creates a new revision and returns the review to `In review`; the prior decision remains tied to the old revision.
- Owners and brand managers can set collection allowlists by workspace role or member ID through the `/api/sources/collections/:category/access` API; once restricted, access is denied to everyone outside the allowlist. The web UI does not yet include collection-policy management controls.
- Existing source metadata is retained as quarantined version rows. `npm run sources:rescan-legacy --workspace @cleared/api` revalidates stored legacy passages and sends them through the configured scanner; clean passages may then be used for evidence. The MinIO/ClamAV Compose integration setup is local test infrastructure and has not been run against live services in this environment.

## Deployment safeguards

- Keep every Supabase secret key and mail provider credential on the server; never add them to frontend build variables.
- Use HTTPS in every deployed environment and configure trusted origins explicitly.
- Keep the `cleared-private` bucket private. Give signed download links a short expiry and authorize each request before issuing one.
- Keep uploaded objects quarantined until a malware scanner has accepted them. Scanner outage must not make an upload available.
- Before using a managed PostgreSQL runtime, translate workspace predicates into row-level policies for every tenant-owned parent and child table, set tenant identity only from verified membership context, and test pooled-connection context reset. The Supabase scaffold is not active and has not been shown to provide parity with the live schema.
- Back up database and object storage, and test the retention and deletion procedures before accepting customer data.
- Review the threat model and run the database isolation suite before launch.
