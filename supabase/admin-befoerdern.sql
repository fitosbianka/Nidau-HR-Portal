-- Nach dem Anlegen des ersten Benutzers (Supabase: Authentication → Users →
-- Add user): E-Mail unten eintragen und im SQL Editor ausführen.
-- Macht die Person zum Admin und trägt sie in die Admin Liste für die
-- Row Level Security ein. Bei jedem weiteren Admin erneut ausführen.

update public.profiles
set role = 'admin', full_name = 'Bianka Fitos', is_active = true
where email = 'DEINE-EMAIL@BEISPIEL.CH';

truncate public.admin_users;
insert into public.admin_users
  select id from public.profiles where role = 'admin';
