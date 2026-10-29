create table if not exists public.admin_presence (
  id smallint primary key default 1,
  last_seen timestamptz
);

insert into public.admin_presence (id, last_seen)
values (1, null)
on conflict (id) do nothing;

alter table public.admin_presence enable row level security;

-- Lettura pubblica: serve al tesserato per sapere se un admin e' online in
-- questo momento. Nessuna policy di scrittura per anon/authenticated: l'unica
-- scrittura passa dalla Netlify Function state-save (service_role), cosi'
-- funziona sia per l'admin con email+password sia per quello con OTP.
create policy admin_presence_read on public.admin_presence
  for select
  using (true);
