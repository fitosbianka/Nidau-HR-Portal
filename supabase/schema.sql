-- ============================================================
-- Dentalpraxis Kehrsatz — HR Portal Database Schema
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
