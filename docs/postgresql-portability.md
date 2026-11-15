# PostgreSQL portability notes

The active runtime remains Express with SQLite. These notes prepare a future managed PostgreSQL move without adding a second runtime.

## Current tenant-owned relations

The normalized SQLite tables include `reviews`, `review_revisions`, `claims`, `findings`, `decisions`, `sources`, `source_versions`, `source_passages`, `stored_files`, `collection_access`, `audit_events`, and `notifications`. Preserve workspace scoping on every workspace-owned parent and child query. `review_revisions`, claims/findings, decisions, source passages, and notifications carry workspace IDs so authorization checks can be applied directly rather than inferred only through a parent join. Notifications are also scoped to their recipient user.

## RLS preparation

For a PostgreSQL target:

1. Keep a non-null `workspace_id` on each workspace-owned table and add composite keys/foreign keys such as `(workspace_id, review_id)` and `(workspace_id, source_id, version)` where the query model benefits from them.
2. Enable and force row-level security on each tenant-owned table. Policies should compare `workspace_id` with a tenant context set by the API only after it verifies the active membership and role.
3. Use transaction-local tenant context (`SET LOCAL` or an equivalent transaction-scoped mechanism) so pooled connections cannot retain a prior request's workspace.
4. Add separate policies for reads, writes, audit export, and file metadata. Never trust a workspace ID supplied only in request body, URL, or a client-set session variable.
5. Test every API route with two workspaces, including foreign review/source/member/file IDs, list filtering, bulk updates, exports, and connection reuse after a workspace switch.

SQLite remains the enforcement runtime today; these RLS policies are planning notes and have not been activated or verified against a PostgreSQL service.

## Supabase scaffold decision

Keep `supabase/migrations` as an inactive design reference while PostgreSQL migration is planned. It is not in schema parity with the current SQLite relations and is not an active auth, database, or storage runtime. Before using it, reconcile the schema, review migrations and RLS policies against the current model, then run the isolation suite against PostgreSQL. Do not configure it as a simultaneous second runtime.
