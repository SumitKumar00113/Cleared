# Production readiness audit

Audit scope: current Cleared source, tests, deployment files, and security documentation before first Render deployment. No external production services or customer data were accessed. The Render Blueprint and API URL routing changes already present in the working tree were reviewed as current implementation.

## Prioritized findings

### High

1. **Existing data is not transferred to Render automatically.** The configured disk is persistent only after attachment; the application creates a new database at `CLEARED_DB_PATH` if the file is absent. Startup preserves and migrates a database that is already there, but it cannot import the developer's ignored local SQLite file. **Verified, documented; `db:backup` and an automated WAL restore/integrity test were added. Initial transfer and a production restore drill remain operator tasks.**
2. **Separate-site Render hosts do not meet the current cookie policy.** Production auth uses a host-only `__Host-cleared_session` cookie with `Secure; SameSite=Lax` and the CSRF cookie is SameSite=Strict. The browser client sends credentials and the API allows configured credentialed origins, but `*.onrender.com` app/API hosts are different sites. Use HTTPS custom domains under the same registrable domain; a real browser-domain flow still requires manual production verification. **Verified; configuration guidance exists, live browser test requires deployment/domain.**
3. **Static-site security response headers were not configured by the Render Blueprint.** Express sets CSP and other headers on API responses; those do not set headers on HTML/JS served by the Static Site. **Verified and fixed:** Blueprint now sets CSP, HSTS, Referrer-Policy, nosniff, and frame denial. Custom API domains require updating CSP `connect-src`.

### Medium

4. **API bind address was implicit.** Startup listened on `process.env.PORT` but omitted an explicit host. **Verified and fixed:** it now binds `0.0.0.0`.
5. **Proxy trust was not configured.** Render terminates TLS and proxies requests. Authentication throttles derive keys from `request.ip`; without proxy trust this can use the proxy address for visitors. **Verified and fixed:** Express trusts one proxy hop only in production; a test asserts this setting.
6. **Startup migrations are automatic, but not every schema edit is in one transaction.** Importing `store.js` creates/updates tables, migrates Phase 3 inside `BEGIN IMMEDIATE`, then adds later columns and performs the audit-chain backfill. The Phase 3 and hash-chain paths create `VACUUM INTO` backups and are guarded/idempotent for their recorded schema state. There is no reset-on-start behavior. **Verified and documented:** keep one API instance and do not run migrations during Render build/pre-deploy.
7. **S3, SMTP, Gemini, production domains and real hosted ClamAV cannot be proven with repository tests alone.** **External-service verification remains.**
8. **The requested integration suite was attempted but blocked by Docker Desktop.** `docker compose up` and `down` could not connect to the Docker Linux engine pipe; running the tests without services produced 3 expected connection failures (MinIO/ClamAV unavailable) and 1 pass. **Requires a running Docker daemon; no code failure was established by those unavailable-service cases.**
8. **No complete browser-driven end-to-end test exists.** API tests exercise auth/MFA/CSRF/workspace isolation/review and verification paths, but registration through final approval, outbound email, uploaded file scanning, and browser cookie persistence across deployed origins are not one automated flow. **Verified gap; real hosted tests require services.**

### Low

9. **Documentation was inconsistent with the deployment work.** It described production deployment as unconfigured and had stale Supabase/worker descriptions. **Verified and updated** in README, SECURITY.md, and THREAT_MODEL.md without claiming deployment or operational validation.
10. **API URL routing was incomplete before the current working-tree changes.** Direct `fetch()` calls bypassed the shared API helper. **Verified fixed:** frontend API requests use `apiFetch`, which prefixes `CLEARED_API_HOST` and includes credentials. Webpack build and host injection were verified.
11. **The static Render host is linked automatically, but custom API domains require an override.** The Blueprint references the API's Render host for the frontend build. With the required custom-domain cookie setup, set frontend `CLEARED_API_HOST` to the custom API hostname. **Verified and documented.**

## Existing controls verified by source/tests

- Passwords use asynchronous scrypt; session IDs are random, HMAC-signed in the cookie, hashed in SQLite, rotate on sign-in, and support revocation/expiry. MFA uses AES-GCM with a 32-byte environment key; recovery codes are one-time hashes.
- Unsafe requests use CSRF validation; credentialed CORS uses configured exact origins. Production config validates HTTPS origins, secrets, SMTP, MFA key, HTTPS S3 endpoint, and scanner host/configuration.
- Uploads are UTF-8 TXT/MD/CSV only. Files are stored privately, inserted quarantined, scanned, and only marked clean after scanner success. Scanner failure leaves them quarantined. Production startup now requires ClamAV configuration.
- S3 credentials are read server-side; downloads authorize the current account/workspace/resource and use a short-lived application-signed link. The adapter does not expose public bucket URLs.
- AI checking is workspace opt-in. Retrieval excludes inaccessible, unclean, and expired sources. Model responses are schema-validated and cannot write review decisions; human decisions remain separate.
- Audit rows have append-only triggers and per-workspace hashes. The chain is not tamper-proof against a privileged host operator replacing the database; separate log export is still needed for stronger independence.
- The API has a minimally revealing `/api/health` response. HSTS is sent on production API responses; Render's static-site Blueprint also configures static response security headers.

## Test inventory and limits

The API unit/security suite completed with 41 passing tests, including SQLite PRAGMA checks, production proxy configuration, and a WAL backup restore/integrity test. The frontend production build succeeded and `apps/web/dist/index.html` exists. `npm audit` reported zero vulnerabilities. The Render YAML parsed and `git diff --check` passed. The MinIO/ClamAV integration suite was attempted but could not run its service-dependent cases because Docker Desktop was unavailable. It does not test real provider credentials, hosted cookies, browser policy, SMTP delivery or Gemini billing.

No Render deployment has been performed. No production secrets were read or included in this report.
