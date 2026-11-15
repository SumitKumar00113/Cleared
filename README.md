# Cleared

Cleared is a brand governance and pre-publication review platform. It helps teams check draft content against approved sources, brand language, policies, and factual references before anything is published.

The current codebase is an MVP-style implementation that includes:
- a React frontend for workspace operations
- an Express API with role-based access control
- SQLite-backed persistence for workspaces, users, invitations, reviews, and approved sources
- private file storage, scan-gated TXT/MD/CSV uploads, and versioned sources
- append-only workspace audit history, revision-bound review decisions, and per-review history
- an optional AI verification step using the Gemini API

## Product overview

Cleared is designed for a workflow like this:

1. A brand manager or workspace owner adds approved sources.
2. A creator submits a draft or document for review.
3. The system checks the draft against approved sources.
4. Claims are classified as Supported, Contradicted, or Not enough evidence.
5. Reviewers decide whether to approve, reject, or request changes.
6. The workspace keeps the decision trail scoped to that organization.

This is especially useful for marketing, internal communications, compliance, product messaging, and release content where factual and brand accuracy matter.

## Current project status

This repository is a working MVP, not a fully production-hardened platform. The implementation already includes:
- workspace creation and invitation flow
- role-based workspace permissions
- email verification, database-backed sessions, password-reset/unlock flows, MFA enrollment, TOTP challenges, and recovery codes
- asynchronous scrypt password hashing and request/account lockout controls
- approved source management
- review submission and status updates
- private random-ID file storage, upload validation, quarantine, ClamAV scanner integration, and signed downloads
- append-only audit events, revision history, revision-bound decisions, and workspace audit export
- verification checks against trusted source text
- SQLite database persistence with workspace scoping

The project also contains a Supabase migration scaffold for future PostgreSQL/RLS planning, but the live runtime in this repo still uses the existing Express + SQLite implementation. Keep the scaffold as an inactive design reference; it needs schema parity review before any future use. No second runtime is active.

## Core features

### Workspace and access control
- Create a company workspace and become the owner
- Create user accounts and invite employees by email
- Support roles such as owner, administrator, brand_manager, reviewer, and creator
- Enforce workspace-scoped access to reviews and source records
- Prevent users from seeing or editing data outside their workspace

### Approved sources
- Upload approved source documents as TXT, MD, or CSV
- Validate UTF-8 text content and reject binary input; PDF and DOCX are not enabled
- Store files under random opaque IDs in private local storage during development or an S3-compatible private bucket in production
- Keep source versions, uploader/owner, checksum, upload time, scan status, and optional expiry
- Use only clean, unexpired source versions for Gemini fact-checking
- Keep sources organized by collection/category
- Require short-lived user/workspace-bound download links; direct static upload serving is disabled

### File storage configuration

Development defaults to `FILE_STORAGE=local` and an in-memory development scanner bypass that logs a prominent warning. Configure `FILE_SCANNER=clamav`, `CLAMAV_HOST`, and optionally `CLAMAV_PORT` to scan locally. Production defaults to S3-compatible private storage and requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; set `FILE_STORAGE=s3` explicitly in deployment. Configure ClamAV with `FILE_SCANNER=clamav` and `CLAMAV_HOST` before production uploads can be marked clean or downloaded. Without a production scanner, uploaded files remain quarantined. See `.env.example` for variable names.

Downloads are issued by the API at `/api/files/:fileId/link` and expire after two minutes. The signed token is bound to the user, workspace, and file; the API rechecks active membership and resource access when the link is used. File actions and review, auth, MFA, membership, invitation, verification, and decision events are stored in append-only `audit_events`. Owners and administrators can list and export only their own workspace's events at `/api/workspace/audit` and `/api/workspace/audit/export`. Each review history panel reads revisions and decisions alongside these audit events.

Before deploying an existing SQLite database, run `npm run db:up --workspace @cleared/api`. The migration creates a timestamped SQLite backup before conversion. Roll back with `npm run db:down --workspace @cleared/api`; this restores the Phase 2 API schema from the retained migration snapshot and archives Phase 3 tables with a `phase3_archive_` prefix. Stop the API before either command. Keep the backup outside the host where practical.

Legacy metadata-only source versions start quarantined. Revalidate and scan them with `npm run sources:rescan-legacy --workspace @cleared/api`; to limit the run to one workspace, append `-- <workspace-id>`. In development, the explicit scanner-not-configured mode logs a warning; production requires an available ClamAV service. Clean legacy text passages can then be used for verification, but they do not have downloadable file objects.

For local MinIO and ClamAV service integration, start the services with `docker compose -f docker-compose.phase2-integration.yml up -d --wait`, run `npm run test:integration --workspace @cleared/api`, and stop them with `docker compose -f docker-compose.phase2-integration.yml down`. The integration tests exercise the S3-compatible adapter, clean and EICAR scans, unreachable-scanner quarantine behavior, and ClamAV size limits. The compose setup uses local-only test credentials and a persistent MinIO/ClamAV data volume; do not reuse those credentials in a deployment.

### Review workflow
- Submit a review title plus draft text or file upload
- Track review status: In review, Needs changes, Approved, Rejected
- Restrict approvals and changes to the right roles
- Keep review records tied to the creator and workspace

### AI verification
- Default AI checking is off per workspace; owners and administrators can enable it after recent authentication
- Retrieve a small set of relevant, clean, unexpired source passages for each draft sentence
- Run deterministic evidence and fact checks even when AI is off
- Use strict structured output and server-verified source quotes when Gemini is enabled
- Require a human review decision even when automated checks find issues

## Architecture

The application is intentionally split into a frontend app and a backend API so the workspace, source data, and verification logic remain separate from the UI.

### High-level component map

| Component | Responsibility | Notes |
| --- | --- | --- |
| Frontend app | User experience and workspace UI | React + Webpack single-page app |
| API server | Request handling and auth middleware | Express app mounted at `/api` |
| Auth service | Session creation and validation | Uses database-backed, hashed session IDs and workspace membership checks |
| Store layer | SQLite persistence | Normalized workspace-scoped tables, revisions, decisions, files, and audit events |
| Review service | Draft submission and review lifecycle | Keeps revision text, hashes, editor attribution, decisions, and review history |
| Source service | Approved source uploads | Reads content for later verification |
| Verification service | Passage retrieval and claim checking | Runs deterministic checks locally and calls Gemini only when the workspace setting is enabled |
| Supabase scaffold | Future PostgreSQL/RLS planning | Inactive; not an authentication or runtime dependency |

## Repository structure

```text
cleared/
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── SECURITY.md
├── THREAT_MODEL.md
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── scripts/                 # Phase 3 migration and legacy source rescan
│   │   ├── src/
│   │   │   ├── server.js
│   │   │   └── services/            # auth, MFA, normalized store, reviews, sources, files, scanner/storage, verification, workspace
│   │   └── test/
│   │       ├── integration/         # MinIO + ClamAV integration tests
│   │       ├── security-phase-1a.test.js
│   │       └── workspace-access.test.js
│   └── web/
│       ├── package.json
│       ├── index.html
│       ├── webpack.config.cjs
│       └── src/
│           ├── main.jsx             # Public landing page, auth gate, and workspace app
│           ├── LandingPage.jsx      # Public homepage and interactive sample
│           ├── LandingPage.css
│           ├── design-system.jsx    # Shared UI primitives
│           ├── design-system.css
│           ├── ReviewDesk.jsx
│           ├── WorkspaceSettings.jsx
│           ├── api.js
│           ├── styles.css
│           ├── overview.css
│           └── review-desk.css
├── docs/
│   ├── design-system.md
│   ├── phase-1b-report.md
│   ├── postgresql-portability.md
│   └── security-route-test-matrix.md
├── infra/
│   └── clamd.integration.conf
├── docker-compose.phase2-integration.yml
├── supabase/
│   ├── README.md
│   ├── migrations/                  # Inactive PostgreSQL/RLS planning scaffold
│   └── tests/
```

Local `.env` files, SQLite databases, private storage, and uploads are runtime data and must not be committed.

## Tech stack

### Frontend
- React 18
- Webpack 5
- Custom CSS styling
- Lucide icons
- GSAP for motion effects

### Backend
- Node.js 24.19.x
- Express 4
- `node:sqlite` for SQLite persistence
- `multer` for file uploads
- Nodemailer for production SMTP delivery; development uses a logged in-memory outbox
- Private local file storage for development and S3-compatible private storage for production
- Pluggable file scanning with ClamAV; MinIO + ClamAV integration-test setup

### Verification and security
- Gemini API for factual claim evaluation
- HMAC-signed session cookies using `SESSION_SECRET`
- Asynchronous scrypt password hashing, email verification, database-backed sessions, MFA, and CSRF protection
- Private, scan-gated files; append-only audit events; revision-bound human decisions
- Workspace-scoped access checks for reviews, members, files, and sources

## Authentication and account security

- Email verification is required before a signed-in user can access workspace APIs. Unverified users are directed to verify their address.
- MFA enrollment is enforced for the `owner`, `administrator`, `brand_manager`, and `reviewer` roles. The API blocks workspace access for these roles until MFA is enabled. Any user who has enabled MFA must complete a challenge before accessing workspace APIs.
- Login and invitation failures are throttled by account/IP pair. Five failed authentication attempts within a 15-minute window trigger a 15-minute lockout; separate per-route and per-IP request-rate limits also apply.
- Unsafe API requests require the CSRF token in both the `cleared_csrf` cookie and `X-CSRF-Token` header. Authenticated tokens are HMAC-bound to the session ID; unauthenticated account flows use a separate signed pre-auth token.
- Production session cookies use the `__Host-cleared_session` prefix with `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Lax`, and omit `Domain`.

## Runtime behavior

The current runtime is intentionally lightweight and suitable for local development.

### Local development URLs
- Web app: `http://localhost:5173`
- API: `http://localhost:4000`

The web app's root route (`http://localhost:5173/`) shows the public Cleared homepage to signed-out visitors and the Overview dashboard to signed-in users. Sign-in is at `http://localhost:5173/login`; workspace signup is at `http://localhost:5173/login?mode=create`. The review workspace is at `http://localhost:5173/workspace` after signing in.

### Database and storage
The API stores data in SQLite under:
- `apps/api/data/cleared.sqlite`

Development uploads default to private storage under `apps/api/private-storage/` (override with `LOCAL_STORAGE_DIR`). Production uses a private S3-compatible bucket. Uploads are not served as static files.

SQLite is the only active database runtime and is intended for this single-instance MVP. See `docs/postgresql-portability.md` for preparation notes; PostgreSQL is not active.

## Environment variables

Copy `.env.example` to `.env` and customize it for your environment.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | At least 32 characters; signs session cookies. Production startup refuses missing or weak secrets. |
| `MFA_ENCRYPTION_KEY` | For MFA | 32-byte AES key encoded as 64 hex characters or base64; encrypts TOTP secrets at rest. |
| `CORS_ORIGINS` | Production | Comma-separated exact origins allowed to call the API. |
| `PORT` | No | API port; defaults to `4000`. |
| `WEB_PORT` | No | Web development server port; defaults to `5173`. |
| `NODE_ENV` | No | Set to `production` for production security and storage requirements. |
| `APP_BASE_URL` | Production | HTTPS public URL used for invitation and account-action links. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Production | SMTP delivery for verification, password, unlock, and invitation messages. |
| `FILE_STORAGE`, `LOCAL_STORAGE_DIR` | No | Select local development or private S3-compatible storage; optional local directory override. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN` | S3 | S3-compatible storage settings. Production endpoint must use HTTPS. |
| `FILE_SCANNER`, `CLAMAV_HOST`, `CLAMAV_PORT` | Production | Configure ClamAV; production fails closed without a configured scanner. |
| `GEMINI_API_KEY` | Optional | Enables AI verification |
| `GEMINI_MODEL` | Optional | Overrides the default Gemini model |
| `GEMINI_PAID_TIER_CONFIRMED` | Optional | Set to `true` only after an operator has confirmed an active paid Gemini API tier; otherwise startup logs a warning when a key is configured. |
| `VERIFICATION_WORKER_CONCURRENCY` | Optional | In-process verification worker concurrency; defaults to `2`, maximum `4`. |
| `VERIFICATION_WORKSPACE_RATE_PER_MINUTE` | Optional | Maximum newly requested jobs per workspace per minute; defaults to `10`. |
| `VERIFICATION_DAILY_JOB_CAP` | Optional | Per-workspace daily job cap; defaults to `100`. |
| `VERIFICATION_DAILY_CHAR_CAP` | Optional | Per-workspace daily cap for characters sent to Gemini; defaults to `1,000,000`. |
| `VERIFICATION_MAX_RETRIEVED_CHARS` | Optional | Maximum combined retrieved passage text per job; defaults to `80,000`. |
| `CLEARED_DB_PATH` | Optional | Custom SQLite file path |
| `CLEARED_API_HOST` | Render frontend build | API host name used to send browser requests to the separately deployed API service. Do not include a path; the frontend uses HTTPS. |

Notes:
- Use Node `24.19.x` (also declared in `package.json` engines).
- `SESSION_SECRET` must be at least 32 characters long. Production also requires `CORS_ORIGINS`.
- Sessions are stored in SQLite as hashes of random cookie IDs, expire after 12 hours, record user agent/creation/last use, and can be listed or revoked.
- Passwords use asynchronous scrypt (N=131072, r=8, p=1), a 12-character minimum, and a common-password denylist. Legacy hashes are upgraded after successful sign-in.
- Unsafe requests require a CSRF cookie/header pair. API responses include CSP, MIME sniffing and frame protections, and Referrer-Policy; HSTS is enabled in production.
- AI checking is disabled per workspace by default. With AI off, no draft or source text is sent to Gemini.
- Gemini startup warns unless an operator sets `GEMINI_PAID_TIER_CONFIRMED=true`; this is an operator attestation, not a provider-side billing check.

## Render deployment

`render.yaml` defines a Render Node web service for `apps/api` and a Render static site for `apps/web`. Both use Node `24.19.0` and repository-root builds. The API uses `npm install` and `npm run start --workspace @cleared/api`, has a `/var/data` persistent disk, and stores SQLite at `/var/data/cleared.sqlite`. The static site builds with `npm install && npm run build` and publishes `apps/web/dist`. Its `CLEARED_API_HOST` build variable is linked to the API service's public Render hostname; browser requests use HTTPS, CORS credentials, and the configured API origin.

The API disk is single-instance storage. Keep the API at one instance and do not attach a second service to its disk. SQLite enables WAL, `synchronous=NORMAL`, foreign keys, and a 5-second busy timeout; transactions that change schema/data use SQLite transactions where implemented. WAL supports concurrent readers and serializes writes, but this setup is for a single API process and is not a multi-instance database. Render mounts persistent disks at runtime, not during build or pre-deploy commands, so do not run database migrations in the build or pre-deploy phase.

### Render service settings

The Blueprint supplies the root directory, build and start commands, `apps/web/dist` publish path, `/api/health` health check, Node version, API disk mount, frontend API-host link, SPA rewrite, and static response security headers. Create/sync the Blueprint, then set the API service's `APP_BASE_URL` to the HTTPS frontend URL and `CORS_ORIGINS` to that exact HTTPS origin (no path or trailing slash). Keep one instance for SQLite. For browser cookie compatibility, use custom frontend and API domains under the same registrable domain (for example, `app.example.com` and `api.example.com`); the app and API must both be HTTPS. The default `*.onrender.com` app and API hosts are different sites for cookie purposes, so use a custom API domain and override the static site's `CLEARED_API_HOST` with that domain before relying on sign-in. Also update the Static Site CSP `connect-src` header in Render to allow the exact API origin. The Blueprint's CSP currently allows `https://cleared-api.onrender.com`; if Render assigns a different API hostname, update that header too. The API session cookie is Secure and SameSite=Lax.

### Required API environment variables

The Blueprint marks secrets and deployment-specific values for entry in the Render Dashboard. Set:

- `NODE_ENV=production`, `NODE_VERSION=24.19.0`, and `CLEARED_DB_PATH=/var/data/cleared.sqlite` (provided by the Blueprint).
- `SESSION_SECRET`: generate a strong secret of at least 32 characters; the Blueprint generates one.
- `APP_BASE_URL`: exact HTTPS frontend URL, such as `https://cleared-web.onrender.com`.
- `CORS_ORIGINS`: exact frontend origin, such as `https://cleared-web.onrender.com` (no path or trailing slash).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`: verified production mail sender configuration.
- `MFA_ENCRYPTION_KEY`: a stable, randomly generated key encoding exactly 32 bytes as 64 hex characters (or base64). Keep this value backed up securely; changing it prevents decrypting existing MFA secrets.
- `FILE_STORAGE=s3`, `S3_ENDPOINT` (HTTPS), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; set `S3_REGION` and `S3_SESSION_TOKEN` when required by the S3-compatible provider. Keep the bucket private.
- `FILE_SCANNER=clamav`, `CLAMAV_HOST`, and `CLAMAV_PORT` if not using the default `3310`. The API must be able to reach the ClamAV service over the network.

`GEMINI_API_KEY` and `GEMINI_MODEL` are optional for deployments that use AI verification. AI verification remains disabled per workspace by default. If configuring the key, follow the existing `GEMINI_PAID_TIER_CONFIRMED` billing-attestation guidance above. Never copy `.env` into Render or commit its values. Render's process environment takes precedence over `.env`; the production service must set `NODE_ENV=production` itself.

### Database initialization and migrations

On the first API start, SQLite creates missing tables and applies the existing additive startup migrations. The Phase 3 conversion runs first and creates a timestamped SQLite backup before changing a legacy schema; the audit hash-chain backfill follows, also creating a backup when needed. These startup migrations preserve existing rows and are idempotent for an already-current schema. Keep the service at one instance during migration and retain the generated backups. Do not run either `down` command during deployment; Phase 3 rollback archives tables and changes the schema.

A Render disk preserves files across restarts and redeploys after it is attached, but it does not copy `apps/api/data/cleared.sqlite` from a developer computer. The API never resets the configured database on normal startup, but a missing file creates a new empty SQLite database. If production must start with an existing local database, make and verify a SQLite-consistent backup before deployment, transfer it to the attached disk using Render's SSH/SCP workflow, then point `CLEARED_DB_PATH` at that uploaded copy and restart so the startup migrations run on it. Do not copy a live `.sqlite` file by itself while writes are occurring; `db:backup` uses SQLite `VACUUM INTO`, which includes committed WAL state, then runs `integrity_check` and refuses to overwrite an existing destination. Keep an untouched offline copy until the migrated production database and its records are verified. MFA requires the same `MFA_ENCRYPTION_KEY` as the source database.

Create a protected backup outside the database file's directory (choose a timestamp that does not already exist):

```sh
npm run db:backup --workspace @cleared/api -- /var/data/backups/cleared-2026-11-15T120000.sqlite
```

The backup tool sets restrictive file permissions where supported. Copy the verified backup off the Render service/disk to an access-controlled backup location; the on-disk copy alone is not independent protection. To restore, first create and download a fresh backup of the current database, stop or isolate API traffic, transfer the chosen verified backup to a new path on `/var/data` without overwriting the current file, set `CLEARED_DB_PATH` to that new path, and restart the single API instance. Check `PRAGMA integrity_check` and `npm run audit:verify --workspace @cleared/api` after startup. If the restore is bad, switch `CLEARED_DB_PATH` back to the retained prior database and restart; do not delete either file until recovery is confirmed. The automated backup test restores a WAL-mode SQLite fixture and checks its data and integrity, but it is not a production restore drill. Render disk snapshots are useful recovery points, not a substitute for off-disk backups.

For a deliberate/manual migration on an already running API instance, use the Render service Shell (where the attached disk is available) and run these in order:

```sh
npm run db:up --workspace @cleared/api
npm run audit:chain:up --workspace @cleared/api
npm run audit:verify --workspace @cleared/api
```

`db:up` loads the current store initializer, which also runs the audit-chain migration after Phase 3; the explicit `audit:chain:up` is therefore an idempotent follow-up and creates its own backup. Avoid running migrations from a separate instance or while scaling the API beyond one process.

### Verify the deployment build

Before deploying, run `npm install`, `npm run build`, and confirm `apps/web/dist/index.html` exists. The build embeds `CLEARED_API_HOST`; Blueprint builds get that from the API service reference. For a manual Static Site setup, set `CLEARED_API_HOST` to the public API hostname without `https://` or a path. Confirm the built app sends `/api/...` requests to `https://<CLEARED_API_HOST>/api/...`, and that CORS allows the exact frontend origin.

## Installation and local startup

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

```bash
copy .env.example .env
```

Then edit `.env` and set at minimum:

```env
SESSION_SECRET=replace-with-a-random-secret-at-least-32-characters
```

Set `MFA_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hexadecimal characters (for example, generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) to test MFA locally. Keep it stable and back it up securely. In development, email is written to the API terminal/in-memory outbox rather than sent through SMTP; production requires the SMTP variables above.

Optional verification settings:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### 3) Start the app

```bash
npm run dev
```

This boots both the API and the web app together.

## API routes

All routes are mounted under `/api`. Workspace routes require an authenticated session unless noted. Mutating requests are protected by global CSRF middleware.

### Health and authentication

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | API health check. |
| `GET /api/auth/csrf` | Read or issue a CSRF token. |
| `GET /api/auth/session` | Current session and user state. |
| `POST /api/auth/workspaces` | Create a workspace and its first owner account. |
| `POST /api/auth/login` | Sign in; may initiate an MFA challenge. |
| `POST /api/auth/invitations/accept` | Accept a workspace invitation. |
| `POST /api/auth/email/resend` | Resend a verification message. |
| `POST /api/auth/email/verify` | Verify an email address or consume an unlock token. |
| `POST /api/auth/account/unlock` | Send an account-unlock message. |
| `POST /api/auth/password/forgot` | Request a password-reset message. |
| `POST /api/auth/password/reset` | Consume a reset token and set a new password. |
| `POST /api/auth/email/change` | Request an email change, verified at the new address. |
| `POST /api/auth/mfa/challenge` | Complete sign-in MFA with TOTP or a one-time recovery code. |
| `POST /api/auth/mfa/enroll/start` | Start MFA enrollment and return setup details. |
| `POST /api/auth/mfa/enroll/confirm` | Confirm MFA enrollment and issue recovery codes. |
| `POST /api/auth/reauth` | Verify the current password for recent-auth gated actions. |
| `GET /api/auth/sessions` | List the current account's active sessions. |
| `DELETE /api/auth/sessions/:sessionId` | Revoke one of the current account's sessions. |
| `POST /api/auth/logout` | Revoke the current session. |
| `POST /api/auth/logout-everywhere` | Revoke all sessions for the account. |

### Workspace and audit

| Method and route | Purpose |
| --- | --- |
| `GET /api/workspace` | Current workspace metadata and role. |
| `GET /api/workspace/members` | List members (owner/administrator). |
| `POST /api/workspace/invitations` | Invite a user (owner/administrator). |
| `PATCH /api/workspace/members/:userId` | Change a member's role (owner/administrator, recent authentication). |
| `DELETE /api/workspace/members/:userId` | Remove a member (owner/administrator, recent authentication). |
| `GET /api/workspace/audit` | List current-workspace audit events (owner/administrator). |
| `GET /api/workspace/audit/export` | Export current-workspace events as CSV (owner/administrator). |
| `GET /api/workspace/audit/integrity` | Verify the current workspace audit hash chain (owner/administrator). |
| `PATCH /api/workspace/ai` | Enable or disable AI checking for this workspace (owner/administrator, recent authentication). |

### Reviews and sources

| Method and route | Purpose |
| --- | --- |
| `GET /api/reviews` | List reviews visible to the current role. |
| `POST /api/reviews` | Submit a review from text or a TXT/MD/CSV file. |
| `PATCH /api/reviews/:id` | Edit draft text or change review status. |
| `GET /api/reviews/:id/history` | Read a review's audit timeline, revisions, and decisions. |
| `GET /api/sources` | List sources visible under collection access rules, with expiry and scan state. |
| `POST /api/sources` | Add a source and its first version. |
| `GET /api/sources/:id/versions` | List retained source versions. |
| `POST /api/sources/:id/versions` | Upload a new source version. |
| `DELETE /api/sources/:id` | Delete a source and its private file objects. |
| `GET /api/sources/collections/:category/access` | Read collection access settings (owner/brand manager). |
| `PUT /api/sources/collections/:category/access` | Set collection role/user allowlists (owner/brand manager, recent authentication). |

### Files and verification

| Method and route | Purpose |
| --- | --- |
| `POST /api/files/:fileId/link` | Create a user-, workspace-, and file-bound signed download link (about two minutes). |
| `GET /api/files/:fileId/download` | Download a clean, accessible file through a valid signed link. |
| `POST /api/files/:fileId/scan` | Scan a file (owner/administrator/brand manager, recent authentication). |
| `POST /api/verification/check/:reviewId` | Queue a revision-bound verification job; returns `202` and a job ID. Add `?wait=true` for synchronous compatibility. |
| `GET /api/verification/jobs/:jobId` | Poll a job in the authenticated workspace; foreign IDs return `404`. |
| `GET /api/notifications` | List the signed-in user's latest 50 workspace review notifications. |
| `PATCH /api/notifications/:id/read` | Mark a workspace-scoped notification as read. |

## Data model

SQLite tables are created/upgraded by `apps/api/src/services/store.js`. Workspace-owned data carries `workspace_id` and is queried within the authenticated workspace.

| Tables | Purpose |
| --- | --- |
| `workspaces`, `users`, `memberships`, `invitations` | Organizations, accounts, role membership, and invitations. User rows include email-verification and MFA state; TOTP secrets are encrypted. |
| `reviews` | Review metadata and pointer to the current revision. |
| `review_revisions` | Draft text, sequential revision number, SHA-256 content hash, editor, creation time, and lock state. |
| `claims`, `findings` | Claim verdicts/findings linked to a revision; evidence records the source ID and version. |
| `decisions` | Approval, rejection, or changes-requested action, actor, time, and exact revision ID. |
| `sources` | Source and collection metadata, owner/uploader, and deletion state. |
| `source_versions` | Versioned file reference, owner/uploader, checksum, upload/expiry times, and scan state. Older versions remain. |
| `source_passages` | Extracted passages with source version and content hash. |
| `stored_files` | Private file metadata, opaque storage key, checksum, scan state, and deletion state. |
| `collection_access` | Optional per-collection role/user allowlists. Unlisted users are denied when a policy is set. |
| `audit_events` | Append-only events with workspace, actor, action, target, time, request origin, details, and per-workspace previous/event hashes. SQLite triggers reject updates and deletes. |
| `workspace_settings` | Per-workspace AI checking switch; defaults off. |
| `verification_jobs`, `verification_usage` | Persistent job state, retry metadata, retrieved passage IDs, and daily job/character counters. |
| `sessions`, `auth_attempts`, `request_limits` | Hashed session identifiers, authentication lockout counters, and request rate limits. |
| `account_action_tokens`, `mfa_challenges`, `mfa_recovery_codes` | Hashed single-use email/password/unlock tokens, MFA challenges, and hashed one-time recovery codes. |

Legacy schema tables are retained as rollback data. For a controlled migration, stop the API and run `npm run db:up --workspace @cleared/api`. The migration creates a SQLite backup before conversion. To roll back, run `npm run db:down --workspace @cleared/api`; rollback creates another snapshot and restores the Phase 2 API schema while archiving Phase 3 tables.

## Review and decision rules

- Each submission or text edit creates a revision with editor and content hash. A decision records the exact revision it applies to; an approved revision is locked. Later edits create a new revision.
- Only owners, administrators, brand managers, and reviewers may record final review actions. Recent authentication is required for approval.
- No one, including an owner or administrator, may approve or reject their own submission.
- Approval is refused while recorded findings remain unresolved.
- `GET /api/reviews/:id/history` returns the workspace-scoped audit events, revisions, and decisions used by the review History panel.

## Verification flow

Verification is a human-in-the-loop review assistant. Each request creates or reuses a background job bound to the current workspace, review, and revision.

1. A creator submits a review draft.
2. The worker selects the latest clean, unexpired source passages that the requesting user may access. It ranks passages for each draft sentence with an in-repo BM25-style score, removes duplicates, and caps the retrieved text.
3. Deterministic checks run locally. Uncovered sentences are marked Not enough evidence without a model call. Clear numeric, percentage, currency, date, and supported named-slot conflicts are Contradicted with an exact source quote.
4. Only when the workspace AI setting is enabled and a Gemini key is configured does the worker send covered sentences and their retrieved passages to Google. Draft/source text is wrapped in random delimiters and described as untrusted data in the system instructions. The request uses structured JSON output, low temperature, no tools, and a 30-second provider timeout.
5. The server rejects unknown or malformed response fields, retries malformed output once, verifies evidence quotes against the exact retrieved passage, and chooses the stricter deterministic/model verdict. A model cannot upgrade a deterministic contradiction.
6. Jobs persist as queued, running, succeeded, failed, or cancelled; the in-process worker retries transient provider failures once, uses backoff, and requeues jobs left running after a restart. Per-workspace rate, daily job, and daily Gemini character caps apply.
7. Before saving results, the server confirms that the review still points to the same revision. Findings retain mode, model, prompt version, source version, passage, and job provenance. A human still makes the final review decision.

This means AI can suggest findings, but it never acts as the final publishing authority.

### AI verification and data privacy

AI checking defaults off for every workspace. With it off, only deterministic checks run and no content goes to Google. When an owner or administrator enables it, draft sentences and selected source passages may be sent to Google through the Gemini API. Use a paid Gemini API tier with active billing for production data; the `GEMINI_PAID_TIER_CONFIRMED=true` environment setting is an operator attestation and does not verify billing with Google. Google's unpaid-service terms allow submitted content to be used to improve products and reviewed by people. Paid-service prompts and responses are not used to improve products, though limited abuse-monitoring and legal logging may still occur. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [billing-tier documentation](https://ai.google.dev/gemini-api/docs/billing) before enabling AI for production data. The system prompt and delimiters reduce prompt-injection risk but do not provide a comprehensive defense.

## Tests and builds

Run `npm run eval --workspace @cleared/api` for the fixed invented evaluation set. It reports case counts by category and a confusion matrix. The initial held-out set under `apps/api/eval/heldout/` is separate from the build threshold; run it with `npm run eval --workspace @cleared/api -- --heldout`. Held-out mode is deterministic only and does not send text to Gemini. Keep all evaluation data invented; do not add customer text or secrets.

The API suite uses Node's built-in test runner. The default API command runs `apps/api/test/*.test.js`, covering security/auth, MFA, workspace isolation, review history, files/sources, and workspace access:

```bash
npm test --workspace @cleared/api
```

MinIO + ClamAV integration tests are separate and require Docker Compose:

```bash
docker compose -f docker-compose.phase2-integration.yml up -d --wait
npm run test:integration --workspace @cleared/api
docker compose -f docker-compose.phase2-integration.yml down
```

They cover the S3-compatible adapter, clean and EICAR scans, fail-closed quarantine on scanner errors, and scanner size limits. Build the frontend with `npm run build`. See `docs/security-route-test-matrix.md` for route-by-route coverage. MFA TOTP replay and recovery-code use are separate tests in `security-phase-1a.test.js`.

## Current limitations and known gaps

This MVP is intentionally compact, but several things are still not implemented or are only partially implemented:

- PDF/DOCX extraction is not implemented
- source uploads are limited to TXT, MD, and CSV
- production needs configured SMTP for invitation and account emails
- sessions are persisted in SQLite, so the setup is single-instance and has no managed session store
- Render deployment configuration exists, but production credentials, custom domains, service connectivity, and end-to-end deployment validation remain operator tasks
- the MinIO/ClamAV integration suite requires Docker Compose and must be run against local containers before deployment
- no managed PostgreSQL runtime is active; see [PostgreSQL portability notes](docs/postgresql-portability.md)
- no production-ready SSO is implemented
- deterministic verification uses conservative number, date, currency, percentage and named-term checks; it does not replace expert review of nuanced claims
- Gemini billing confirmation is an operator attestation and cannot verify the account's billing state; prompt delimiters and strict output checks reduce injection risk but are not a comprehensive defense
- The fixed deterministic evaluation set is small and synthetic. The separate held-out set is not a production quality guarantee and is not used to tune or gate the build.
- legacy reviews have migrated revision/submission data but do not have reconstructed historical decisions
- solo workspaces cannot approve their own submissions because separation of duties requires a different user
- suggested corrections are not persisted as correction records; editing the draft itself does create a revision
- review notifications are in-app only: reviewers/managers are notified on submission and creators on decisions; email, preferences, and push delivery are not implemented
- a SQLite-safe backup command and restore test exist, but scheduled off-disk backups, a production restore drill, monitoring, and incident recovery are not configured
- Node 24.19.x marks `node:sqlite` as Stability 1.2, Release candidate; see the [Node.js v24.19 SQLite documentation](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)
- the audit hash chain detects edits and interior row deletion, but it cannot establish trust if a host administrator replaces the entire database and recomputes the chain; send logs to a separate store for stronger assurance

## Roadmap

1. **Phase 4 — Verification hardening:** bounded passage retrieval, deterministic checks, optional AI with strict output validation, and background jobs are implemented. Delimiters and system instructions reduce prompt-injection risk but are not a comprehensive defense; see the evaluation results from `npm run eval --workspace @cleared/api`.
2. **Phase 5 — Product features:** in-app review submission and decision notifications are implemented; add delivery preferences and optional email notifications.
3. **Production deployment:** validate secrets, custom domains, SMTP, S3-compatible storage, ClamAV network access, backups/restores, monitoring, and operational recovery in the target environment.
4. **PostgreSQL:** use `docs/postgresql-portability.md` to plan a later managed PostgreSQL migration and workspace row-level security. SQLite remains the only active runtime until PostgreSQL is separately implemented and tested. The `supabase/` directory is an inactive schema/RLS planning scaffold.

## Security considerations

A few important guardrails are already in place:
- random session IDs are stored hashed in SQLite; cookies are HMAC-signed
- workspace membership is enforced before most protected routes
- owners cannot be removed from a workspace by a lower-role user
- separation of duties prevents anyone, including owners and administrators, from approving or rejecting their own submission
- AI results are treated as advisory only and do not bypass human approval

Nevertheless, the current app should still be considered a development MVP. Production rollout needs deployment review, tested backups, live-service validation, and independent security testing. No compliance or security certification is claimed.

See [SECURITY.md](SECURITY.md) for the security policy and [THREAT_MODEL.md](THREAT_MODEL.md) for the current threat model. Report suspected vulnerabilities privately to the project maintainers following `SECURITY.md`; do not include credentials or real customer data. There is currently no published monitored security email or private reporting destination, so configure one before public launch.

## License

This repository does not currently declare a project license in the root files. If you plan to distribute or commercialize the application, add an explicit license file such as MIT or Apache-2.0 before release.

## Summary

Cleared is a practical MVP for AI-assisted brand and factual governance. It already demonstrates:
- workspace-based tenant isolation
- trusted-source management
- draft review flows
- AI-powered claim checking
- human approval gating

It is a strong foundation for a more formal enterprise governance platform, but the project still needs additional polish and production hardening before it should be treated as a fully production-ready SaaS product.
