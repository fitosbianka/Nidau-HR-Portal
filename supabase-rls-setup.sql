-- ============================================================
-- HR-Portal Dentalpraxis Kehrsatz — Row Level Security
-- APPLIED on 2026-08-10 via Supabase Dashboard SQL Editor.
-- Kept here as documentation / disaster recovery.
--
-- Effect: employees read only their OWN profile, documents and
-- attendance; everything else (salaries, comments, plan tables)
-- is admin-only at the database level. The app's server actions
-- use the service role (bypasses RLS); the employee Arbeitsplan
-- reads plan data server-side after a session check.
--
-- is_admin() reads a tiny no-client-access lookup table
-- (public.admin_users) instead of profiles, to avoid RLS
-- recursion. If an admin is ever added/removed, refresh it:
--   truncate public.admin_users;
--   insert into public.admin_users
--     select id from public.profiles where role = 'admin';
-- ============================================================

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create table if not exists public.admin_users (user_id uuid primary key);
alter table public.admin_users enable row level security;   -- no policies = deny for clients
truncate public.admin_users;
insert into public.admin_users select id from public.profiles where role = 'admin';
revoke all on public.admin_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;

alter table public.profiles              enable row level security;
alter table public.documents             enable row level security;
alter table public.attendance_events     enable row level security;
alter table public.work_schedule         enable row level security;
alter table public.salary_history        enable row level security;
alter table public.zeiterfassung_comments enable row level security;
alter table public.schedule_publications enable row level security;
alter table public.schedule_review_days  enable row level security;

create policy "profiles_select_own"   on public.profiles  for select using (id = auth.uid());
create policy "profiles_select_admin" on public.profiles  for select using (public.is_admin());
create policy "profiles_update_own"   on public.profiles  for update using (id = auth.uid());

create policy "documents_select_own"   on public.documents for select using (employee_id = auth.uid());
create policy "documents_select_admin" on public.documents for select using (public.is_admin());

create policy "attendance_select_own"   on public.attendance_events for select using (employee_id = auth.uid());
create policy "attendance_select_admin" on public.attendance_events for select using (public.is_admin());

create policy "salary_select_admin"       on public.salary_history         for select using (public.is_admin());
create policy "comments_select_admin"     on public.zeiterfassung_comments for select using (public.is_admin());
create policy "schedule_select_admin"     on public.work_schedule          for select using (public.is_admin());
create policy "publications_select_admin" on public.schedule_publications  for select using (public.is_admin());
create policy "review_select_admin"       on public.schedule_review_days   for select using (public.is_admin());
