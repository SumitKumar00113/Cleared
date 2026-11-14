# Supabase setup scaffold

Cleared's selected managed stack is Supabase Auth, PostgreSQL with RLS, and private Supabase Storage. The migration is groundwork for the API migration; current API routes still use SQLite and must not be treated as protected by these policies.

## Provisioning

1. Create a non-production Supabase project for integration work in the region required for your customers and set a strong database password in the Supabase dashboard.
2. Configure Auth email confirmation, password recovery, TOTP MFA, and the application's allowed redirect URLs. Require an authenticator factor for Owner, Administrator, Brand manager, and Reviewer roles. Configure an external SMTP sender for real users; Supabase's built-in test sender is restricted.
3. Apply `migrations/202611130001_core_security.sql` to that non-production project with the Supabase CLI or SQL editor.
4. Review grants and policies, then run the tenant-isolation tests against two test workspaces before importing any existing data.
5. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from `.env.example`. Do not add `SUPABASE_SECRET_KEY` to `apps/web` or any `REACT_APP_*`, `VITE_*`, or Webpack define setting.
6. Configure the malware scanner endpoint. Until the scanner integration is operational and returns a clean verdict, keep every uploaded source quarantined.

## Environment variable names

- `SUPABASE_URL`: project API URL.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key for user-scoped requests that must obey RLS.
- `SUPABASE_SECRET_KEY`: optional server-only key for a narrowly controlled privileged operation. It bypasses RLS; do not use it for ordinary tenant queries. Prefer the authenticated user's token for tenant reads and writes.
- `APP_BASE_URL`: allow-listed application URL for Auth redirect links.
- `MALWARE_SCANNER_URL`, `MALWARE_SCANNER_TOKEN`: private scanner service endpoint and server credential.
- Existing `GEMINI_API_KEY` and `GEMINI_MODEL` remain API-server secrets for verification.

Set SMTP host, port, username, password, and sender address in Supabase Auth's SMTP settings rather than the Cleared API. Supabase's default sender is restricted and intended for development; production verification, invitation, and recovery emails need custom SMTP. Resend is a suitable SMTP option if you do not already have an email provider; verify a sender domain before launch.

Do not send secret values in chat or commit them. Configure them in the deployment platform's secret manager or local ignored `.env` file. Rotate credentials if they have ever been committed or disclosed.

## Current migration limitations

- This migration creates new tables; it does not import existing SQLite users, passwords, invitations, reviews, or sources. User passwords must be reset through the managed Auth provider rather than migrated from the legacy hash format.
- The existing API has not yet been switched to Supabase Auth, Postgres, or Storage. Do not apply the migration to a production project until the application integration is ready and reviewed.
- Malware scanning, signed download routes, session management UI, password recovery UI, MFA enrollment UI, SSO, SCIM, API keys, and data export/deletion flows still need implementation.
- Supabase database and storage encryption-at-rest are provider-managed settings and depend on the selected project plan and region. Confirm requirements in the provider dashboard and contract.
