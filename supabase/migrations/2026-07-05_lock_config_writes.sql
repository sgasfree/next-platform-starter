-- ============================================================================
-- MIGRAZIONE: blocco scritture dirette anonime sulla tabella `config`
-- Data: 2026-07-05
-- ============================================================================
--
-- CONTESTO
-- La tabella `config` contiene lo stato condiviso dell'app (chiave
-- 'sgas_app_state': catalogo, raccolte, ordini, impostazioni). Con la policy
-- permissiva "public_rw" chiunque, con la sola anon key (pubblica, presente nel
-- file HTML), poteva SOVRASCRIVERE l'intero stato. Questa migrazione blocca le
-- scritture dirette: da ora in poi i salvataggi passano SOLO dalla Netlify
-- Function `state-save` che verifica il chiamante e scrive con la SERVICE_ROLE
-- (che bypassa la RLS). La lettura pubblica resta attiva (serve al catalogo
-- ospite e alla sincronizzazione).
--
-- ⚠️ PREREQUISITO: eseguire questa migrazione SOLO DOPO aver deployato la
-- Function `state-save` e impostato la env var STATE_TOKEN_SECRET su Netlify,
-- e aver verificato che il salvataggio dall'app funzioni (vedi ROLLOUT sotto).
-- ============================================================================

-- 1. Rimuove la vecchia policy permissiva (scrittura anonima) se presente.
drop policy if exists "public_rw" on public.config;

-- 2. Lettura pubblica limitata alla sola chiave dello stato app.
drop policy if exists config_read on public.config;
create policy config_read on public.config
  for select using ( chiave = 'sgas_app_state' );

-- 3. Scrittura diretta consentita solo agli admin autenticati (sessione OTP).
--    Il proxy usa comunque la service_role, che bypassa la RLS: questa policy
--    è una rete di sicurezza aggiuntiva, non il percorso principale.
drop policy if exists config_admin on public.config;
create policy config_admin on public.config
  for all using (public.is_admin()) with check (public.is_admin());

-- 4. Assicura che la RLS sia attiva.
alter table public.config enable row level security;

-- ============================================================================
-- ROLLOUT CONSIGLIATO (senza downtime)
-- ============================================================================
-- 1) Deploy dell'app con la Function `state-save` (già nel codice) e imposta su
--    Netlify la env var STATE_TOKEN_SECRET (una stringa lunga e casuale).
-- 2) Con la policy ANCORA permissiva, entra come admin e salva qualcosa:
--    il client usa il proxy e, in caso di problemi, fa fallback alla scrittura
--    anonima — quindi nulla si rompe. Controlla nella tabella `config` che
--    `updated_at` si aggiorni.
-- 3) Verifica anche un ordine da tesserato (login tessera+cellulare) e che
--    l'admin lo veda: conferma che il proxy accetta anche i tesserati.
-- 4) Quando tutto funziona, ESEGUI QUESTA MIGRAZIONE. Da quel momento le
--    scritture dirette anon vengono rifiutate e resta valido solo il proxy.
-- 5) (facoltativo) Nel codice, il fallback anon di `syncToSupabase` diventa
--    inutile: dopo qualche giorno di verifica lo si può rimuovere.
-- ============================================================================
