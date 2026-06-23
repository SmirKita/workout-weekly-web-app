create table if not exists public.workout_sync_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, record_key)
);

alter table public.workout_sync_records enable row level security;

grant select, insert, update, delete
on public.workout_sync_records
to authenticated;

drop policy if exists "Users can read own workout records" on public.workout_sync_records;
create policy "Users can read own workout records"
on public.workout_sync_records
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own workout records" on public.workout_sync_records;
create policy "Users can insert own workout records"
on public.workout_sync_records
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own workout records" on public.workout_sync_records;
create policy "Users can update own workout records"
on public.workout_sync_records
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own workout records" on public.workout_sync_records;
create policy "Users can delete own workout records"
on public.workout_sync_records
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.upsert_workout_sync_record(
  p_record_key text,
  p_payload jsonb,
  p_client_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.workout_sync_records (
    user_id,
    record_key,
    payload,
    client_updated_at,
    updated_at
  )
  values (
    (select auth.uid()),
    p_record_key,
    p_payload,
    p_client_updated_at,
    now()
  )
  on conflict (user_id, record_key)
  do update set
    payload = excluded.payload,
    client_updated_at = excluded.client_updated_at,
    updated_at = now()
  where workout_sync_records.client_updated_at <= excluded.client_updated_at;
end;
$$;

grant execute on function public.upsert_workout_sync_record(text, jsonb, timestamptz)
to authenticated;
