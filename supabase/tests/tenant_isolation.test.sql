begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, name) values
  ('10000000-0000-4000-8000-000000000010', 'Workspace One'),
  ('20000000-0000-4000-8000-000000000020', 'Workspace Two');
insert into public.memberships (workspace_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'creator'),
  ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000002', 'creator');
insert into public.reviews (id, workspace_id, owner_id, data) values
  ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', '{"title":"one","status":"In review"}'),
  ('20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000002', '{"title":"two","status":"In review"}');
insert into public.sources (id, workspace_id, collection, name, owner_id, object_path, mime_type, size_bytes, sha256, version, status)
values
  ('20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000020', 'Policies', 'Private source', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000020/20000000-0000-4000-8000-000000000022/file.pdf', 'application/pdf', 10, repeat('a', 64), 1, 'available');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.reviews), 1, 'workspace one lists only its review');
select is((select count(*)::int from public.reviews where id = '20000000-0000-4000-8000-000000000021'), 0, 'workspace one cannot read workspace two review by ID');
select is((with changed as (update public.reviews set data = '{"title":"tampered"}' where id = '20000000-0000-4000-8000-000000000021' returning id) select count(*)::int from changed), 0, 'workspace one cannot modify workspace two review by ID');
select throws_ok($$insert into public.reviews (workspace_id, owner_id, data) values ('20000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', '{"title":"cross tenant"}')$$, '42501', null, 'workspace one cannot insert a review into workspace two');
select is((select count(*)::int from public.sources where workspace_id = '20000000-0000-4000-8000-000000000020'), 0, 'workspace one cannot list workspace two source');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.reviews), 1, 'workspace two lists only its review');
select is((select count(*)::int from public.reviews where id = '10000000-0000-4000-8000-000000000011'), 0, 'workspace two cannot read workspace one review by ID');

select * from finish();
rollback;
