-- Cleared tenant schema for Supabase Postgres.
-- Apply only to a new Supabase project after reviewing the deployment guide.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','administrator','brand_manager','reviewer','creator')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists memberships_user_id_idx on public.memberships(user_id);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('administrator','brand_manager','reviewer','creator')),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  decision_actor_id uuid references auth.users(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_workspace_created_idx on public.reviews(workspace_id, created_at desc);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection text not null,
  name text not null,
  owner_id uuid not null references auth.users(id),
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text not null,
  version integer not null check (version > 0),
  status text not null default 'quarantined' check (status in ('quarantined','available','rejected','expired')),
  extracted_text text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, collection, name, version)
);
create index if not exists sources_workspace_collection_idx on public.sources(workspace_id, collection);

create table if not exists public.collection_grants (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection text not null,
  role text check (role in ('owner','administrator','brand_manager','reviewer','creator')),
  user_id uuid references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((role is null) <> (user_id is null))
);
create unique index if not exists collection_grants_role_unique
  on public.collection_grants(workspace_id, collection, role) where role is not null;
create unique index if not exists collection_grants_user_unique
  on public.collection_grants(workspace_id, collection, user_id) where user_id is not null;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_workspace_created_idx on public.audit_log(workspace_id, created_at desc);

create or replace function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = _workspace_id and m.user_id = (select auth.uid())
      and (m.role = 'creator' or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2')
  );
$$;

create or replace function private.has_workspace_role(_workspace_id uuid, _roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = _workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any(_roles)
      and (m.role = 'creator' or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2')
  );
$$;

create or replace function private.can_access_collection(_workspace_id uuid, _collection text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_workspace_member(_workspace_id) and (
    not exists (
      select 1 from public.collection_grants g
      where g.workspace_id = _workspace_id and g.collection = _collection
    )
    or exists (
      select 1 from public.collection_grants g
      join public.memberships m on m.workspace_id = g.workspace_id
        and m.user_id = (select auth.uid())
      where g.workspace_id = _workspace_id and g.collection = _collection
        and (g.user_id = (select auth.uid()) or g.role = m.role)
    )
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;
grant execute on function private.can_access_collection(uuid, text) to authenticated;

create or replace function public.create_workspace(_name text)
returns public.workspaces
language plpgsql security definer
set search_path = ''
as $$
declare created public.workspaces;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if length(trim(_name)) < 2 or length(trim(_name)) > 120 then raise exception 'invalid workspace name'; end if;
  insert into public.workspaces(name) values (trim(_name)) returning * into created;
  insert into public.memberships(workspace_id, user_id, role) values (created.id, auth.uid(), 'owner');
  insert into public.audit_log(workspace_id, actor_id, action, target_type, target_id)
    values (created.id, auth.uid(), 'workspace.created', 'workspace', created.id::text);
  return created;
end;
$$;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

create or replace function public.accept_workspace_invitation(_token_hash text)
returns public.memberships
language plpgsql security definer
set search_path = ''
as $$
declare invite public.invitations; joined public.memberships; current_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select lower(email) into current_email from auth.users where id = auth.uid();
  select * into invite from public.invitations
    where token_hash = _token_hash and accepted_at is null and revoked_at is null and expires_at > now()
      and lower(email) = current_email
    for update;
  if not found then raise exception 'invitation invalid, expired, or issued to another account'; end if;
  insert into public.memberships(workspace_id, user_id, role)
    values (invite.workspace_id, auth.uid(), invite.role)
    on conflict (workspace_id, user_id) do nothing
    returning * into joined;
  if joined.user_id is null then raise exception 'already a workspace member'; end if;
  update public.invitations set accepted_at = now() where id = invite.id;
  insert into public.audit_log(workspace_id, actor_id, action, target_type, target_id)
    values (invite.workspace_id, auth.uid(), 'invitation.accepted', 'invitation', invite.id::text);
  return joined;
end;
$$;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.reviews enable row level security;
alter table public.sources enable row level security;
alter table public.collection_grants enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.workspaces, public.memberships, public.invitations,
  public.reviews, public.sources, public.collection_grants, public.audit_log
  from anon;
grant select on public.workspaces to authenticated;
grant select, insert, update, delete on public.memberships, public.invitations,
  public.reviews, public.sources, public.collection_grants to authenticated;
grant select on public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;
grant usage, select on sequence public.collection_grants_id_seq to authenticated;

create policy workspace_member_read on public.workspaces
  for select to authenticated using (private.is_workspace_member(id));

create policy members_read on public.memberships
  for select to authenticated using (
    user_id = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner','administrator'])
  );
create policy members_manage on public.memberships
  for all to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator']))
  with check (private.has_workspace_role(workspace_id, array['owner','administrator']));

create policy invitations_manage on public.invitations
  for all to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator']))
  with check (private.has_workspace_role(workspace_id, array['owner','administrator']));

create policy reviews_read on public.reviews
  for select to authenticated using (
    private.is_workspace_member(workspace_id)
    and (private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager','reviewer']) or owner_id = (select auth.uid()))
  );
create policy reviews_insert on public.reviews
  for insert to authenticated with check (private.is_workspace_member(workspace_id) and owner_id = (select auth.uid()));
create policy reviews_update on public.reviews
  for update to authenticated using (
    private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager','reviewer'])
    or (owner_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
  ) with check (private.is_workspace_member(workspace_id));
create policy reviews_delete on public.reviews
  for delete to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator']));

create policy sources_read on public.sources
  for select to authenticated using (
    status = 'available' and (expires_at is null or expires_at > now())
    and private.can_access_collection(workspace_id, collection)
  );
create policy sources_insert on public.sources
  for insert to authenticated with check (
    private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager'])
    and owner_id = (select auth.uid()) and status = 'quarantined'
  );
create policy sources_update on public.sources
  for update to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager']))
  with check (private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager']));
create policy sources_delete on public.sources
  for delete to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator','brand_manager']));

create policy collection_grants_read on public.collection_grants
  for select to authenticated using (private.can_access_collection(workspace_id, collection));
create policy collection_grants_manage on public.collection_grants
  for all to authenticated using (private.has_workspace_role(workspace_id, array['owner','brand_manager']))
  with check (private.has_workspace_role(workspace_id, array['owner','brand_manager']));

create policy audit_read on public.audit_log
  for select to authenticated using (private.has_workspace_role(workspace_id, array['owner','administrator']));
-- Audit records are append-only for application identities.
create or replace function private.reject_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.reject_audit_mutation();

create or replace function private.guard_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' then
    if tg_op = 'DELETE' or new.role <> 'owner' then
      if (select count(*) from public.memberships m where m.workspace_id = old.workspace_id and m.role = 'owner') <= 1 then
        raise exception 'a workspace must retain at least one owner';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger memberships_keep_owner before update or delete on public.memberships
  for each row execute function private.guard_last_owner();

create or replace function private.guard_source_scan_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'only the trusted scanner may change source scan status';
  end if;
  return new;
end;
$$;
create trigger sources_scan_transition before update on public.sources
  for each row execute function private.guard_source_scan_transition();

create or replace function private.prevent_tenant_move()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'records cannot be moved between workspaces';
  end if;
  return new;
end;
$$;
create trigger reviews_tenant_immutable before update on public.reviews
  for each row execute function private.prevent_tenant_move();
create trigger sources_tenant_immutable before update on public.sources
  for each row execute function private.prevent_tenant_move();
create trigger invitations_tenant_immutable before update on public.invitations
  for each row execute function private.prevent_tenant_move();
create trigger collection_grants_tenant_immutable before update on public.collection_grants
  for each row execute function private.prevent_tenant_move();

create or replace function private.guard_human_review_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.data->>'status' is distinct from old.data->>'status'
     and new.data->>'status' in ('Approved','Rejected','Needs changes') then
    if not private.has_workspace_role(old.workspace_id, array['owner','administrator','brand_manager','reviewer'])
       or new.decision_actor_id is distinct from (select auth.uid()) then
      raise exception 'a recent MFA-authenticated reviewer must record this decision';
    end if;
  end if;
  return new;
end;
$$;
create trigger reviews_human_decision before update on public.reviews
  for each row execute function private.guard_human_review_decision();

-- Private object storage. Object names are {workspace_uuid}/{source_uuid}/{opaque_filename}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cleared-private', 'cleared-private', false, 20971520,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown','text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy cleared_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'cleared-private'
    and exists (
      select 1 from public.sources s
      where s.object_path = name and s.status = 'available'
        and (s.expires_at is null or s.expires_at > now())
        and private.can_access_collection(s.workspace_id, s.collection)
    )
  );
create policy cleared_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'cleared-private'
    and private.has_workspace_role(split_part(name, '/', 1)::uuid, array['owner','administrator','brand_manager'])
  );
create policy cleared_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'cleared-private'
    and private.has_workspace_role(split_part(name, '/', 1)::uuid, array['owner','administrator','brand_manager'])
  );
