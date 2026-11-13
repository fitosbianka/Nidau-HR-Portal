-- ============================================================
-- HR Portal Dentalpraxis Nidau: vollständiges Datenbankschema
-- Für ein NEUES Supabase Projekt. Im SQL Editor einmal ausführen,
-- in einem Stück. Kann mehrfach ausgeführt werden (idempotent).
--
-- Teil 1: Grundtabellen profiles, documents, Storage Bucket und
--         Trigger für neue Benutzer (Originalschema)
-- Teil 2: Zusätzliche Spalten und alle übrigen Tabellen, die das
--         Portal braucht (Arbeitsplan, Zeiterfassung, Notizen,
--         Personalverlauf)
-- Teil 3: Row Level Security wie in der Produktion
-- Danach: supabase/admin-befoerdern.sql mit der eigenen E-Mail
-- ============================================================

-- ───────────────────────── Teil 1 ─────────────────────────
-- ============================================================
-- Dentalpraxis Nidau — HR Portal Database Schema
-- ============================================================
-- Run this entire file in the Supabase SQL Editor (one-time setup)
-- Project: https://supabase.com → Your Project → SQL Editor
-- ============================================================


-- ============================================================
-- 1. PROFILES TABLE
-- Stores one row per user (admin or employee)
-- Linked to auth.users via the id foreign key
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  job_title    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Admins can read all profiles
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Employees can read only their own profile
CREATE POLICY "Employees can read own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Admins can insert profiles (via service role in server action)
CREATE POLICY "Admins can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can update profiles
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Users can update their own last_login
CREATE POLICY "Users can update own last_login"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ============================================================
-- 2. DOCUMENTS TABLE
-- Stores document metadata; actual files live in Storage
-- ============================================================

CREATE TABLE IF NOT EXISTS public.documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  label        TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  file_type    TEXT NOT NULL CHECK (file_type IN ('pdf', 'excel')),
  uploaded_by  UUID NOT NULL REFERENCES public.profiles(id),
  viewed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_employee_id_idx ON public.documents(employee_id);
CREATE INDEX IF NOT EXISTS documents_created_at_idx ON public.documents(created_at DESC);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Admins can read all documents
CREATE POLICY "Admins can read all documents"
  ON public.documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Employees can read ONLY their own documents (enforced at DB level)
CREATE POLICY "Employees can read own documents"
  ON public.documents FOR SELECT
  USING (employee_id = auth.uid());

-- Admins can insert documents
CREATE POLICY "Admins can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can delete documents
CREATE POLICY "Admins can delete documents"
  ON public.documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Employees can update viewed_at on their own documents (mark as read)
CREATE POLICY "Employees can mark own documents as viewed"
  ON public.documents FOR UPDATE
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());


-- ============================================================
-- 3. STORAGE BUCKET
-- Private bucket for employee documents
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Admins can upload files
CREATE POLICY "Admins can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can delete files
CREATE POLICY "Admins can delete documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can read all files (for generating signed URLs)
CREATE POLICY "Admins can read all documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Employees can read only their own files (path starts with their user ID)
CREATE POLICY "Employees can read own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- 4. TRIGGER: Auto-create profile on user signup
-- Handles the case where an admin is created directly in Supabase
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only insert if no profile exists yet (invitation flow creates it manually)
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'employee'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 5. INITIAL ADMIN USER
-- After running this schema, create your admin user in:
--   Supabase Dashboard → Authentication → Users → "Add user"
-- Then run this UPDATE to promote them to admin:
-- ============================================================

-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE email = 'ihre-email@dentalpraxis.ch';

-- ───────────────────────── Teil 2 ─────────────────────────
create extension if not exists pgcrypto;

-- Zusätzliche Spalten in profiles (im Portal gewachsen)
alter table public.profiles
  add column if not exists birthday date,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists ahv_nummer text,
  add column if not exists children_count integer,
  add column if not exists marital_status text,
  add column if not exists pensum numeric,
  add column if not exists eintrittsdatum date,
  add column if not exists bruttolohn_100 numeric,
  add column if not exists monatslohn numeric,
  add column if not exists abbreviation text,
  add column if not exists schedule_order integer,
  add column if not exists show_in_schedule boolean not null default true,
  add column if not exists can_edit_schedule boolean not null default false;

-- Arbeitsplan: ein Eintrag pro Person und Tag
create table if not exists public.work_schedule (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  schedule_date date not null,
  entry text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, schedule_date)
);
create index if not exists work_schedule_date_idx on public.work_schedule (schedule_date);

-- Veröffentlichte Monate und Tage mit Prüfhinweis
create table if not exists public.schedule_publications (
  year integer not null,
  month integer not null,
  published_at timestamptz not null default now(),
  primary key (year, month)
);
create table if not exists public.schedule_review_days (
  schedule_date date primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- Zeiterfassung: Stempel vom Terminal (TimeMoto) oder aus dem Portal
create table if not exists public.attendance_events (
  timemoto_event_id text primary key,
  timemoto_user_id text,
  employee_id uuid references public.profiles(id) on delete set null,
  user_full_name text,
  clocking_type text,
  time_logged timestamptz,
  time_inserted timestamptz,
  clocking_pair_id text,
  department_name text,
  location_name text,
  raw_payload jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists attendance_time_idx on public.attendance_events (time_logged);
create index if not exists attendance_name_idx on public.attendance_events (user_full_name);
create index if not exists attendance_pair_idx on public.attendance_events (clocking_pair_id);

-- Notizen, Einstellungen, Ferienplanung, Bestellungen und alle übrigen
-- Portaldaten ohne eigene Tabelle (reservierte Schlüssel in user_full_name)
create table if not exists public.zeiterfassung_comments (
  id uuid primary key default gen_random_uuid(),
  user_full_name text not null,
  schedule_date date not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_full_name, schedule_date)
);
create index if not exists zeiterfassung_comments_name_idx on public.zeiterfassung_comments (user_full_name);

-- Verlauf von Pensum und Lohn (Personal Änderungen)
create table if not exists public.salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  effective_date date not null,
  pensum numeric,
  monatslohn numeric,
  bruttolohn_100 numeric,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Teil 3 ─────────────────────────
-- ============================================================
-- HR-Portal Dentalpraxis Nidau — Row Level Security
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
