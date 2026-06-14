-- ============================================================================
-- SGAS Freeconomy — Schema database Supabase
-- ============================================================================
-- Esegui questo file UNA VOLTA nel pannello Supabase:
--   Dashboard → SQL Editor → New query → incolla tutto → Run
--
-- Lo schema è idempotente (puoi rieseguirlo senza rompere nulla).
-- Le regole RLS (Row Level Security) garantiscono che:
--   • Il catalogo (fornitori, prodotti, categorie, raccolte) è leggibile da tutti
--   • Ogni socio vede e modifica SOLO i propri ordini, messaggi, prenotazioni
--   • Solo gli admin possono modificare il catalogo e vedere tutti i dati
-- ============================================================================

-- ── Estensioni ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ============================================================================
-- TABELLE
-- ============================================================================

-- ── Admin: collega un utente Supabase Auth al ruolo admin ────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- ── Soci ─────────────────────────────────────────────────────────────────────
-- user_id collega il socio al suo account Supabase Auth (creato in fase di
-- migrazione). telegram_chat_id serve per inviare il codice OTP via bot.
create table if not exists public.soci (
  id               text primary key,           -- es. 's0001' (ID storico app)
  user_id          uuid unique references auth.users(id) on delete set null,
  tessera          text not null unique,
  nome             text,
  cognome          text,
  cellulare        text,
  telegram         text,
  telegram_chat_id text,
  attivo           boolean not null default true,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists soci_tessera_idx on public.soci (tessera);

-- ── Codici OTP (login via Telegram) ──────────────────────────────────────────
-- Scritti/letti SOLO dalle Netlify Functions (service_role). Nessun accesso
-- pubblico: RLS attivo senza policy = nessuno può leggerli dal client.
create table if not exists public.otp_codes (
  id         uuid primary key default gen_random_uuid(),
  tessera    text not null,
  code_hash  text not null,                     -- sha256(code + tessera)
  expires_at timestamptz not null,
  attempts   int not null default 0,
  consumed   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists otp_tessera_idx on public.otp_codes (tessera, created_at desc);

-- ── Catalogo: categorie, fornitori, prodotti, raccolte ───────────────────────
create table if not exists public.categorie (
  id    text primary key,
  ico   text,
  nome  text not null,
  ordine int default 0
);

create table if not exists public.fornitori (
  id              text primary key,
  nome            text not null,
  categoria       text references public.categorie(id) on delete set null,
  emoji           text,
  zona            text,
  descrizione     text,
  caratteristiche jsonb default '[]'::jsonb,
  vision          text,
  attivo          boolean not null default true,
  contattodiretto boolean default false,
  nome_contatto   text,
  telefono        text,
  whatsapp        text,
  email_contatto  text,
  telegram_contatto text,
  indirizzo_contatto text,
  -- le immagini (logo/banner base64) restano nel client per non gonfiare il DB
  created_at      timestamptz not null default now()
);

create table if not exists public.prodotti (
  id           text primary key,
  fornitore_id text references public.fornitori(id) on delete cascade,
  nome         text not null,
  prezzo       numeric default 0,
  unita        text,
  codice       text,
  descrizione  text,
  disponibile  boolean default true,
  created_at   timestamptz not null default now()
);
create index if not exists prodotti_forn_idx on public.prodotti (fornitore_id);

create table if not exists public.raccolte (
  id            text primary key,
  nome          text not null,
  aperta        boolean not null default false,
  data_chiusura date,
  ora_chiusura  text,
  ritiro_data   date,
  ritiro_ora    text,
  ritiro_luogo  text,
  fornitori     jsonb default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- ── Ordini (per-socio) ───────────────────────────────────────────────────────
create table if not exists public.ordini (
  id          text primary key,
  socio_id    text references public.soci(id) on delete cascade,
  raccolta_id text references public.raccolte(id) on delete set null,
  items       jsonb not null default '[]'::jsonb,
  totale      numeric default 0,
  stato       text default 'inviato',
  nota        text,
  created_at  timestamptz not null default now()
);
create index if not exists ordini_socio_idx on public.ordini (socio_id);

-- ── Messaggi (per-socio ↔ admin) ─────────────────────────────────────────────
create table if not exists public.messaggi (
  id         uuid primary key default gen_random_uuid(),
  socio_id   text references public.soci(id) on delete cascade,
  mittente   text not null,                     -- 'socio' | 'admin'
  testo      text not null,
  letto      boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists messaggi_socio_idx on public.messaggi (socio_id, created_at);

-- ── Prenotazioni (per-socio) ─────────────────────────────────────────────────
create table if not exists public.prenotazioni (
  id           text primary key,
  socio_id     text references public.soci(id) on delete cascade,
  fornitore_id text references public.fornitori(id) on delete set null,
  titolo       text,
  items        jsonb default '[]'::jsonb,
  data_consegna date,
  nota_consegna text,
  stato        text default 'richiesta',
  created_at   timestamptz not null default now()
);
create index if not exists prenotazioni_socio_idx on public.prenotazioni (socio_id);

-- ── Config / KV applicativa (impostazioni GAS, ecc.) ─────────────────────────
create table if not exists public.config (
  chiave     text primary key,
  valore     text,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- FUNZIONE HELPER: is_admin()
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.admins        enable row level security;
alter table public.soci          enable row level security;
alter table public.otp_codes     enable row level security;
alter table public.categorie     enable row level security;
alter table public.fornitori     enable row level security;
alter table public.prodotti      enable row level security;
alter table public.raccolte      enable row level security;
alter table public.ordini        enable row level security;
alter table public.messaggi      enable row level security;
alter table public.prenotazioni  enable row level security;
alter table public.config        enable row level security;

-- Nota: otp_codes NON ha policy → solo service_role (le Netlify Functions) vi
-- accede. Il client con anon key non può leggerlo né scriverlo.

-- ── Helper per (ri)creare policy in modo idempotente ─────────────────────────
-- Le DROP POLICY IF EXISTS permettono di rieseguire il file senza errori.

-- admins: ogni admin vede la propria riga
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins
  for select using (user_id = auth.uid());

-- soci: il socio vede/aggiorna la propria riga; admin tutto
drop policy if exists soci_self_select on public.soci;
create policy soci_self_select on public.soci
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists soci_self_update on public.soci;
create policy soci_self_update on public.soci
  for update using (user_id = auth.uid() or public.is_admin());
drop policy if exists soci_admin_all on public.soci;
create policy soci_admin_all on public.soci
  for all using (public.is_admin()) with check (public.is_admin());

-- Catalogo: lettura pubblica (anche ospiti non loggati), scrittura solo admin
do $$
declare t text;
begin
  foreach t in array array['categorie','fornitori','prodotti','raccolte'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (true)', t, t);
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format('create policy %I_admin on public.%I for all using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- ordini: il socio gestisce i propri; admin tutto
drop policy if exists ordini_socio on public.ordini;
create policy ordini_socio on public.ordini
  for all
  using (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  );

-- messaggi: il socio gestisce i propri; admin tutto
drop policy if exists messaggi_socio on public.messaggi;
create policy messaggi_socio on public.messaggi
  for all
  using (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  );

-- prenotazioni: il socio gestisce le proprie; admin tutto
drop policy if exists prenotazioni_socio on public.prenotazioni;
create policy prenotazioni_socio on public.prenotazioni
  for all
  using (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or socio_id in (select id from public.soci where user_id = auth.uid())
  );

-- config: lettura pubblica limitata alla sola chiave 'sgas_app_state'
-- (l'unica usata dall'app via anon key). Le altre righe restano leggibili
-- solo agli admin tramite config_admin: così eventuali segreti/seed non
-- vengono esposti con l'anon key pubblica.
drop policy if exists config_read on public.config;
create policy config_read on public.config
  for select using ( chiave = 'sgas_app_state' );
drop policy if exists config_admin on public.config;
create policy config_admin on public.config
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- REALTIME (opzionale): notifica live di nuovi ordini/messaggi
-- ============================================================================
-- Aggiunge le tabelle alla pubblicazione realtime se non già presenti.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.ordini';   exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.messaggi';  exception when others then null; end;
end $$;
