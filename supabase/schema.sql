-- Hyte initial setup. Run in the Supabase SQL editor on a NEW project.
-- This is a reviewed setup script, not an executed migration.
-- Add the owner's auth.users UUID to hyte_owners AFTER creating/inviting the account.
begin;

create table if not exists public.hyte_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.hyte_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.hyte_push_subscriptions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists hyte_push_owner_idx on public.hyte_push_subscriptions(user_id);

create table if not exists public.hyte_notification_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  due_at timestamptz not null,
  payload jsonb not null,
  source_revision integer not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','expired','superseded')),
  attempts integer not null default 0,
  delivered_to text[] not null default '{}',
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hyte_jobs_owner_idx on public.hyte_notification_jobs(user_id);
create index if not exists hyte_jobs_due_idx on public.hyte_notification_jobs(due_at) where status in ('pending','sending');

create table if not exists public.hyte_extraction_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  requests integer not null default 0,
  primary key(user_id, usage_date)
);

alter table public.hyte_owners enable row level security;
alter table public.hyte_state enable row level security;
alter table public.hyte_push_subscriptions enable row level security;
alter table public.hyte_notification_jobs enable row level security;
alter table public.hyte_extraction_usage enable row level security;

revoke all on public.hyte_owners, public.hyte_state, public.hyte_push_subscriptions,
  public.hyte_notification_jobs, public.hyte_extraction_usage from anon, authenticated;
grant select on public.hyte_owners to authenticated;
grant select, insert, update, delete on public.hyte_state to authenticated;
grant select on public.hyte_push_subscriptions, public.hyte_notification_jobs to authenticated;
grant all on public.hyte_owners, public.hyte_state, public.hyte_push_subscriptions,
  public.hyte_notification_jobs, public.hyte_extraction_usage to service_role;

drop policy if exists hyte_owner_self on public.hyte_owners;
create policy hyte_owner_self on public.hyte_owners for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists hyte_state_read on public.hyte_state;
create policy hyte_state_read on public.hyte_state for select to authenticated
  using ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_state_insert on public.hyte_state;
create policy hyte_state_insert on public.hyte_state for insert to authenticated
  with check ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_state_update on public.hyte_state;
create policy hyte_state_update on public.hyte_state for update to authenticated
  using ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())))
  with check ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_state_delete on public.hyte_state;
create policy hyte_state_delete on public.hyte_state for delete to authenticated
  using ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_push_read on public.hyte_push_subscriptions;
create policy hyte_push_read on public.hyte_push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_jobs_read on public.hyte_notification_jobs;
create policy hyte_jobs_read on public.hyte_notification_jobs for select to authenticated
  using ((select auth.uid()) = user_id and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));

-- Only the server's service_role can run these transactional scheduling functions.
-- SECURITY INVOKER preserves the calling role; no public privileged function.
create or replace function public.hyte_replace_notification_jobs(target_user uuid, expected_revision integer, desired_jobs jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare current_revision integer; result_count integer;
begin
  select revision into current_revision from public.hyte_state where user_id = target_user for update;
  if current_revision is distinct from expected_revision then return -1; end if;
  if jsonb_typeof(desired_jobs) <> 'array' or jsonb_array_length(desired_jobs) > 2500 then raise exception 'Invalid job list'; end if;
  delete from public.hyte_notification_jobs j
    where j.user_id = target_user and j.status in ('pending','sending','superseded','failed','expired')
    and not exists(select 1 from jsonb_array_elements(desired_jobs) x where x->>'id' = j.id);
  insert into public.hyte_notification_jobs(id,user_id,item_key,due_at,payload,source_revision)
    select x->>'id', target_user, x->>'item_key', (x->>'due_at')::timestamptz, x->'payload', expected_revision
    from jsonb_array_elements(desired_jobs) x
    where (x->>'due_at')::timestamptz > now()
  on conflict (id) do update set
    source_revision = excluded.source_revision,
    status = case when public.hyte_notification_jobs.status = 'superseded' then 'pending' else public.hyte_notification_jobs.status end;
  get diagnostics result_count = row_count;
  return result_count;
end;
$$;

create or replace function public.hyte_claim_notification_jobs(worker_id uuid, batch_size integer default 8)
returns setof public.hyte_notification_jobs language plpgsql security invoker set search_path = '' as $$
begin
  update public.hyte_notification_jobs set status = 'expired', lease_until = null, lease_token = null
    where status in ('pending','sending') and due_at < now() - interval '30 minutes';
  return query
  with candidates as (
    select id from public.hyte_notification_jobs
    where due_at <= now() and attempts < 4
      and (status = 'pending' or (status = 'sending' and lease_until < now()))
    order by due_at for update skip locked limit greatest(1, least(batch_size, 8))
  )
  update public.hyte_notification_jobs j set
    status = 'sending', lease_token = worker_id, lease_until = now() + interval '2 minutes', attempts = attempts + 1
    from candidates c where j.id = c.id returning j.*;
end;
$$;

create or replace function public.hyte_allow_extraction(target_user uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.hyte_extraction_usage(user_id,usage_date,requests) values(target_user,current_date,1)
    on conflict (user_id,usage_date) do update set requests = public.hyte_extraction_usage.requests + 1
      where public.hyte_extraction_usage.requests < 20
    returning requests into n;
  return n is not null;
end;
$$;

revoke execute on function public.hyte_replace_notification_jobs(uuid,integer,jsonb),
  public.hyte_claim_notification_jobs(uuid,integer), public.hyte_allow_extraction(uuid) from public, anon, authenticated;
grant execute on function public.hyte_replace_notification_jobs(uuid,integer,jsonb),
  public.hyte_claim_notification_jobs(uuid,integer), public.hyte_allow_extraction(uuid) to service_role;

-- Optional private source-image storage. The client must upload to <user UUID>/<filename>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hyte-media','hyte-media',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists hyte_media_read on storage.objects;
create policy hyte_media_read on storage.objects for select to authenticated
using(bucket_id = 'hyte-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_media_insert on storage.objects;
create policy hyte_media_insert on storage.objects for insert to authenticated
with check(bucket_id = 'hyte-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_media_update on storage.objects;
create policy hyte_media_update on storage.objects for update to authenticated
using(bucket_id = 'hyte-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())))
with check(bucket_id = 'hyte-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));
drop policy if exists hyte_media_delete on storage.objects;
create policy hyte_media_delete on storage.objects for delete to authenticated
using(bucket_id = 'hyte-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.hyte_owners o where o.user_id = (select auth.uid())));

commit;

-- REQUIRED, after inviting/creating your account, replace the example UUID:
-- insert into public.hyte_owners(user_id) values ('YOUR_AUTH_USER_UUID');
