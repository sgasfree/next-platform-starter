-- ============================================================================
-- MIGRAZIONE: le raccolte ordini diventano una tabella dedicata
-- Data: 2026-08-25
-- ============================================================================
--
-- CONTESTO
-- Le raccolte vivevano dentro il blob condiviso `config` (chiave
-- 'sgas_app_state'): un unico documento JSON riscritto per intero a ogni
-- salvataggio. Un dispositivo con una copia vecchia poteva quindi riscrivere
-- l'intero documento e far sparire per tutti le raccolte create nel frattempo
-- da altri — cosa realmente accaduta il 25/08/2026 con due raccolte di agosto.
--
-- Con una tabella dedicata ogni raccolta è una riga a sé: creare, modificare o
-- chiudere una raccolta tocca solo quella riga, e nessuna copia vecchia dello
-- stato può cancellarne altre.
--
-- SCRITTURE
-- Nessuna policy di scrittura, come per `otp_codes`: si scrive esclusivamente
-- dalla Netlify Function `state-save` con la SERVICE_ROLE key, che bypassa la
-- RLS. Così anche l'admin che entra con email+password (che non ha una
-- sessione Supabase) può gestire le raccolte, esattamente come prima.
--
-- LETTURE
-- Pubbliche: le raccolte non contengono dati personali, e la vetrina le
-- consulta senza essere autenticata. Era già così, visto che stavano nel blob
-- `config` a lettura pubblica.
-- ============================================================================

create table if not exists public.raccolte (
  id             text primary key,
  nome           text not null,
  aperta         boolean not null default true,
  data_creazione date,
  data_chiusura  date,
  ora_chiusura   text,
  ritiro_data    date,
  ritiro_ora     text,
  ritiro_luogo   text,
  fornitori      jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

alter table public.raccolte enable row level security;

-- Lettura pubblica (vetrina e tesserati).
drop policy if exists raccolte_read on public.raccolte;
create policy raccolte_read on public.raccolte
  for select using ( true );

-- Nessuna policy di INSERT/UPDATE/DELETE: le scritture passano solo dal proxy.

create index if not exists raccolte_aperta_idx on public.raccolte (aperta);

-- ============================================================================
-- ROLLOUT
-- ============================================================================
-- 1) Esegui questa migrazione.
-- 2) Deploy dell'app. Al primo accesso di un admin, le raccolte ancora presenti
--    nel blob vengono copiate automaticamente nella tabella (una sola volta):
--    non serve alcun intervento manuale.
-- 3) Verifica in Admin → Raccolte che l'elenco sia quello atteso.
-- ============================================================================
