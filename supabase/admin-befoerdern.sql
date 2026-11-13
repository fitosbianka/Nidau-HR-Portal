-- Nach dem Anlegen des ersten Benutzers (Supabase: Authentication → Users →
-- Add user, fitosbianka@gmail.com): im SQL Editor ausführen.
-- Macht die Person zum Admin mit der Funktion Admin und trägt sie in die
-- Admin Liste für die Row Level Security ein. Für einen weiteren Admin
-- die E-Mail und den Namen anpassen und erneut ausführen.

update public.profiles
set role = 'admin', job_title = 'Admin', full_name = 'Bianka Fitos', is_active = true
where email = 'fitosbianka@gmail.com';

insert into public.admin_users (user_id)
  select id from public.profiles where role = 'admin'
on conflict (user_id) do nothing;
