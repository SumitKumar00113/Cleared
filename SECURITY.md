# Security policy

## Reporting a vulnerability

Please report suspected security issues privately to the project maintainers. Include the affected route or feature, a brief impact description, and steps to reproduce. Do not include real customer documents, passwords, access tokens, or other personal data. The repository does not currently publish a dedicated security contact; add a monitored security email or GitHub private vulnerability reporting destination before public launch.

Please allow maintainers time to investigate and prepare a fix before public disclosure. This project has not undergone a penetration test or independent security assessment and does not claim a compliance certification.

## Security status

Cleared uses the existing Express + SQLite runtime. Phase 1a adds database-backed, revocable sessions, asynchronous scrypt password verification with per-user parameters, progressive login and invitation-acceptance lockouts, double-submit CSRF tokens, security headers, and a configured CORS allow-list. Phase 1b identity controls, audit logging, secure upload storage, independent security review, and deployment hardening remain outstanding. This project makes no SOC 2, ISO 27001, GDPR, or other compliance certification claim.

The Supabase migration under `supabase/migrations` remains an inactive architecture scaffold. It is not used by the API runtime.

## Current operational requirements and limits

- Use Node 24.19.x, as declared by the root and API package `engines` fields.
- Set `SESSION_SECRET` to a cryptographically random value of at least 32 characters. Production startup also requires `CORS_ORIGINS` with exact trusted origins.
- Sessions are database-backed, but the current SQLite database remains a single-instance local database. Backups, restore drills, and multi-instance deployment are not configured.
- Session records retain a SHA-256 hash of the random cookie ID, user/workspace, expiry, user agent, creation and last-use timestamps, and revocation time. The session cookie remains `HttpOnly; SameSite=Lax`, with `Secure` in production.
- Passwords use asynchronous scrypt with N=131072, r=8, p=1 and 64-byte output. Existing rows are read with the legacy N=16384 parameters and rehashed after successful login. The current common-password denylist is small and does not replace breached-password screening.
- CSRF uses a readable, SameSite=Strict double-submit cookie and `X-CSRF-Token` on unsafe requests. This protects against cross-site request forgery; it does not protect against same-origin script injection.
- Login and invitation acceptance use account plus account/IP progressive lockouts and IP request limits. Invitation creation has account/IP request limits. The password-reset endpoint does not exist yet; equivalent throttling must be applied when reset is introduced in Phase 1b.
- The configured CSP allows inline styles for the current frontend styling. HSTS is emitted only in production.
- Tests exercise every current workspace data route with two-workspace identifiers and negative access attempts. They are not a penetration test and do not exhaustively prove every possible request combination.

## Deployment safeguards

- Keep every Supabase secret key and mail provider credential on the server; never add them to frontend build variables.
- Use HTTPS in every deployed environment and configure trusted origins explicitly.
- Keep the `cleared-private` bucket private. Give signed download links a short expiry and authorize each request before issuing one.
- Keep uploaded objects quarantined until a malware scanner has accepted them. Scanner outage must not make an upload available.
- Back up database and object storage, and test the retention and deletion procedures before accepting customer data.
- Review the threat model and run the database isolation suite before launch.
