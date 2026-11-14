# Cleared threat model (initial)

## Assets

- Company workspaces, membership and invitation records.
- Unpublished drafts, approved source documents, extracted text, findings, and reviewer decisions.
- Authenticator factors, session credentials, API/provider secrets, and audit events.

## Actors and trust boundaries

- Employees authenticate as individual accounts and receive organisation-scoped roles.
- Workspace owners and administrators manage access; brand managers manage approved sources; reviewers make human decisions; creators submit drafts.
- The React app and all request parameters are untrusted. The Express API, Supabase Auth, Postgres RLS, private Storage, and malware scanning service are separate boundaries.
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
| Unsafe document content reaches extraction | Isolated worker, minimal permissions, temporary-file cleanup, retry-safe jobs, scanner gate |

## Important limits

This is a design artifact, not evidence that the listed controls are deployed. The current runtime still uses SQLite, process-memory sessions, and local uploads. The Supabase migration has not been applied or tested against a project, and malware scanning and signed downloads are not integrated. No compliance certification or independent penetration test is claimed.
