# Cleared threat model

## Assets

- Company workspaces, membership and invitation records.
- Unpublished drafts, approved source documents, extracted text, findings, and reviewer decisions.
- Authenticator factors, session credentials, API/provider secrets, audit events, private files, review drafts, and source passages.

## Actors and trust boundaries

- Employees authenticate as individual accounts and receive organisation-scoped roles. Passwords are async-scrypt derived; cookie session IDs are random, stored as SHA-256 hashes in SQLite, and checked against expiry and revocation on every authenticated request.
- Workspace owners and administrators manage access; brand managers manage approved sources; reviewers make human decisions; creators submit drafts.
- The React app and all request parameters are untrusted. The Express API and SQLite are the active identity and tenant boundary. Private local storage is used outside production; production uses a configured S3-compatible object store. ClamAV is a pluggable scanner; the Supabase scaffold remains inactive.
- Gemini is an external processor of the draft/source text sent for claim checking; it is not an approval authority.

## Main entry points

- Sign-up, sign-in, invitation acceptance, password recovery, email verification, MFA, and session endpoints.
- Workspace membership and role management, review APIs and immutable revisions, source uploads and downloads, audit exports, and verification jobs.
- Supabase Auth/PostgREST/Storage policies and the malware scanner callback.

## Top risks and intended controls

| Risk | Intended controls |
| --- | --- |
| Cross-company data disclosure | Derive workspace from verified membership, deny by default, RLS on tenant tables, private object paths, two-workspace negative tests |
| Account takeover | Async per-user scrypt parameters, verified email, mandatory TOTP for privileged roles, short-lived single-use action links, hashed database sessions, account+IP throttling, recovery notifications |
| Malicious or sensitive upload exposure | Content-based type validation, size limits, quarantine, malware scan, opaque private object paths, authorization before short-lived signed downloads |
| Privilege escalation or false approval | Server permission matrix, owner invariant, sensitive-action re-authentication, separation of duties, decision-to-revision binding, append-only audit records |
| Leaked credentials or content in logs | Server-only secrets, generic auth errors, redacted logs, no document text or tokens in URLs or telemetry |
| Session theft or fixation | Random 256-bit cookie IDs rotated at login, SHA-256 hashed IDs at rest, expiry and revocation, revoke-everywhere, `HttpOnly`, `SameSite=Lax`, production `__Host-` + `Secure` |
| Cross-site request forgery | SameSite=Strict CSRF cookie paired with an `X-CSRF-Token` header on unsafe methods; CSP and exact CORS origin allow-list |
| Password guessing | Async bounded scrypt (N=2^17, r=8, p=1), 12-character minimum, common-password denylist, account+IP progressive lockout and persistent IP request limits |
| Unsafe document content reaches extraction | Isolated worker, minimal permissions, temporary-file cleanup, retry-safe jobs, scanner gate |

## Important limits

Action tokens and throttles are stored in SQLite; throttling survives process restarts. MFA secrets are encrypted at rest and recovery codes are one-time hashes. Production mail requires an external SMTP service. An email unlock link clears account lockout counters. Uploads are private, content-validated UTF-8 TXT/MD/CSV files; PDF/DOCX remain disabled. Files begin quarantined and are inaccessible to downloads and verification until scan-clean. Development with no scanner uses an explicit warning bypass; production cannot mark files clean without a configured scanner. Production storage uses configured S3-compatible object storage. Signed downloads last 120 seconds, require the authenticated user and workspace to match the token, and recheck membership/resource access. Source versions preserve upload metadata and old versions; only current clean, unexpired versions reach Gemini. Legacy metadata-only source passages require revalidation and rescanning before verification can use them. Collection allowlists can restrict access by workspace role or member ID; the app UI for managing those policies is not yet built.

`audit_events` has database triggers blocking update and delete operations. Owner/administrator listing and CSV export are restricted to the authenticated workspace. It is an application and database audit trail, not a tamper-proof external log: a host administrator can still replace the SQLite database or its backups. Review draft text is stored by revision, each with a SHA-256 content hash and editor. Decisions reference a specific revision; the submitting user cannot approve or reject that submission. A later edit creates another revision and resets a prior final status to `In review`. Source findings store the source identifier and version.

The API remains Express + SQLite. The Supabase/PostgreSQL scaffold is inactive and retained as a planning reference; it has not been kept in schema parity with this runtime. Before a managed PostgreSQL move, add row-level policies to each workspace-owned table and child table, derive tenant context from verified membership, and test context isolation with pooled connections. SQLite backups are created before the schema conversion; rollback archives the Phase 3 schema and restores the Phase 2 API tables. MinIO/ClamAV integration tests are supplied but the external services were unavailable in the development environment. Independent security review, penetration testing, and backup/restore validation remain outstanding. This document is not a certification or independent security assessment. No compliance certification is claimed.
