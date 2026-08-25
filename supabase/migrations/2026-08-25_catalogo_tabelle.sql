-- ============================================================================
-- MIGRAZIONE: fornitori e prodotti diventano tabelle dedicate
-- Data: 2026-08-25
-- ============================================================================
--
-- CONTESTO
-- Come le raccolte, anche fornitori e prodotti vivevano dentro il blob
-- condiviso `config`: un unico documento JSON riscritto per intero a ogni
-- salvataggio. Un dispositivo con una copia vecchia riscriveva tutto e
-- cancellava le modifiche fatte nel frattempo da altri — è così che il 25/08
-- sono andate perse le modifiche di Admin 2 al fornitore Az. Agricola Petruzza.
-- Il problema pesa soprattutto sui prodotti freschi, i cui prezzi e la cui
-- disponibilità cambiano spesso e da più persone.
--
-- Con una riga per fornitore e una per prodotto, salvare un prodotto tocca solo
-- quel prodotto: due admin possono lavorare insieme senza sovrascriversi.
--
-- IMMAGINI
-- Logo, banner e foto prodotto finiscono qui. Prima venivano tolti dal blob per
-- non farlo crescere e restavano solo nel browser di chi li aveva caricati:
-- gli altri dispositivi non li vedevano. Ora che ogni record ha la sua riga il
-- problema di dimensione non si pone, e le immagini si vedono ovunque.
--
-- SCRITTURE
-- Nessuna policy di scrittura: si scrive solo dalla Netlify Function
-- `state-save` con la SERVICE_ROLE key. Così anche l'admin che entra con
-- email+password (privo di sessione Supabase) continua a gestire il catalogo.
--
-- LETTURE
-- Pubbliche: la vetrina mostra fornitori e prodotti senza autenticazione, e
-- così era già visto che stavano nel blob `config` a lettura pubblica.
-- ============================================================================

create table if not exists public.fornitori (
  id                  text primary key,
  nome                text not null,
  categoria           text,
  emoji               text,
  zona                text,
  descrizione         text,
  vision              text,
  caratteristiche     jsonb not null default '[]'::jsonb,
  attivo              boolean not null default true,
  contattodiretto     boolean not null default false,
  nome_contatto       text,
  telefono            text,
  whatsapp            text,
  email_contatto      text,
  telegram_contatto   text,
  indirizzo_contatto  text,
  logo                text,
  banner              text,
  updated_at          timestamptz not null default now()
);

create table if not exists public.prodotti (
  id            text primary key,
  fornitor_id   text,
  nome          text not null,
  prezzo        numeric not null default 0,
  unita         text,
  codice        text,
  descrizione   text,
  disponibile   boolean not null default true,
  foto          text,
  updated_at    timestamptz not null default now()
);

alter table public.fornitori enable row level security;
alter table public.prodotti  enable row level security;

drop policy if exists fornitori_read on public.fornitori;
create policy fornitori_read on public.fornitori for select using ( true );

drop policy if exists prodotti_read on public.prodotti;
create policy prodotti_read on public.prodotti for select using ( true );

-- Nessuna policy di INSERT/UPDATE/DELETE: le scritture passano solo dal proxy.

create index if not exists prodotti_fornitor_idx on public.prodotti (fornitor_id);

-- ============================================================================
-- ROLLOUT
-- ============================================================================
-- 1) Esegui questa migrazione (dopo quella delle raccolte).
-- 2) Deploy dell'app. Al primo accesso di un admin, fornitori e prodotti ancora
--    presenti nel blob vengono copiati automaticamente nelle tabelle, una sola
--    volta. Le immagini presenti su quel dispositivo vengono caricate con loro:
--    conviene quindi fare il primo accesso dal dispositivo che ha i loghi.
-- 3) Verifica in Admin → Fornitori e Admin → Prodotti che l'elenco sia completo.
-- ============================================================================
