-- 充電易 Supabase 初始化脚本
-- 在 Supabase Dashboard > SQL Editor 中运行一次。

create table if not exists public.charging_records (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record jsonb,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists charging_records_user_updated_idx
  on public.charging_records (user_id, updated_at);

alter table public.charging_records enable row level security;

drop policy if exists "Users can view their charging records" on public.charging_records;
create policy "Users can view their charging records"
  on public.charging_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their charging records" on public.charging_records;
create policy "Users can insert their charging records"
  on public.charging_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their charging records" on public.charging_records;
create policy "Users can update their charging records"
  on public.charging_records for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their charging records" on public.charging_records;
create policy "Users can delete their charging records"
  on public.charging_records for delete
  to authenticated
  using ((select auth.uid()) = user_id);
