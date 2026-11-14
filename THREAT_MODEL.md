# Cleared threat model

## Assets

- Company workspaces, membership and invitation records.
- Unpublished drafts, approved source documents, extracted text, findings, and reviewer decisions.
- Authenticator factors, session credentials, API/provider secrets, and audit events.

## Actors and trust boundaries

- Employees authenticate as individual accounts and receive organisation-scoped roles. Passwords are async-scrypt derived; cookie session IDs are random, stored as SHA-256 hashes in SQLite, and checked against expiry and revocation on every authenticated request.
- Workspace owners and administrators manage access; brand managers manage approved sources; reviewers make human decisions; creators submit drafts.
- The React app and all request parameters are untrusted. The Express API and SQLite are the active identity and tenant boundary. Supabase Auth, Postgres RLS, private object storage, and malware scanning remain future/inactive boundaries.
- Gemini is an external processor of the draft/source text sent for claim checking; it is not an approval authority.

## Main entry points

- Sign-up, sign-in, invitation acceptance, password recovery, email verification, MFA, and session endpoints.
- Workspace membership and role management, review APIs, source uploads and downloads, and verification jobs.
- Supabase Auth/PostgREST/Storage policies and the malware scanner callback.

## Top risks and intended controls

| Risk | Intended controls |
| --- | --- |
| Cross-company data disclosure | Derive workspace from verified membership, deny by default, RLS on tenant tables, private object paths, two-workspace negative tests |
| Account takeover | Managed password hashing, verified email, mandatory TOTP for privileged roles, short-lived access and rotating refresh tokens, rate limits, recovery notifications |
| Malicious or sensitive upload exposure | Content-based type validation, size limits, quarantine, malware scan, opaque private object paths, authorization before short-lived signed downloads |
| Privilege escalation or false approval | Server permission matrix, owner invariant, sensitive-action re-authentication, human reviewer identity on every decision, append-only audit records |
| Leaked credentials or content in logs | Server-only secrets, generic auth errors, redacted logs, no document text or tokens in URLs or telemetry |
| Session theft or fixation | Random 256-bit cookie IDs, SHA-256 hashed IDs at rest, 12-hour expiry, logout/revoke-everywhere, `HttpOnly`, `SameSite=Lax`, production `Secure` |
| Cross-site request forgery | SameSite=Strict CSRF cookie paired with an `X-CSRF-Token` header on unsafe methods; CSP and exact CORS origin allow-list |
| Password guessing | Async scrypt (N=2^17, r=8, p=1), 12-character minimum, common-password denylist, account + account/IP progressive lockout, and IP request limits for login and invitation acceptance |
| Unsafe document content reaches extraction | Isolated worker, minimal permissions, temporary-file cleanup, retry-safe jobs, scanner gate |

## Important limits

This document describes implemented controls and remaining plans; it is not a certification or independent security assessment. The runtime remains SQLite with local uploads. Password reset, email verification, MFA, audit events, malware scanning, and signed downloads are not implemented yet. Supabase is inactive. No compliance certification or independent penetration test is claimed.
