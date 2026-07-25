-- ============================================================================
-- MIGRAZIONE: accesso "con un tap" dal messaggio Telegram
-- Data: 2026-07-25
-- ============================================================================
--
-- CONTESTO
-- Il login socio arriva con un codice a 6 cifre su Telegram: l'utente deve
-- uscire dall'app, copiare il codice e tornare indietro. Ora il messaggio
-- porta anche un bottone "✅ Sono io, entra": premendolo, il webhook del bot
-- (netlify/functions/telegram-webhook) segna l'OTP come approvato e la pagina
-- che sta aspettando (auth-poll-approval) entra da sola.
--
-- COLONNE AGGIUNTE su public.otp_codes
--  · approve_hash → sha256 del token che viaggia nel bottone Telegram
--                   (callback_data). Chi preme il bottone dimostra di avere
--                   accesso alla chat a cui è stato inviato il codice.
--  · poll_hash    → sha256 del token consegnato SOLO al browser che ha chiesto
--                   il codice: senza di esso un'altra pagina non può
--                   trasformare l'approvazione in una sessione.
--  · chat_id      → destinatario del messaggio: l'approvazione è valida solo se
--                   arriva da questa chat.
--  · approved_at  → istante dell'approvazione (null = non ancora approvato).
--
-- Nessun valore in chiaro viene salvato: come per il codice a 6 cifre, il
-- database conserva solo le impronte. La tabella resta senza policy RLS,
-- quindi è leggibile/scrivibile solo dalle Netlify Functions (service_role).
--
-- La migrazione è idempotente e retro-compatibile: le righe già esistenti
-- restano valide e continuano a funzionare con il codice digitato a mano.
-- ============================================================================

alter table public.otp_codes add column if not exists approve_hash text;
alter table public.otp_codes add column if not exists poll_hash    text;
alter table public.otp_codes add column if not exists chat_id      text;
alter table public.otp_codes add column if not exists approved_at  timestamptz;

-- Lookup del webhook (per token del bottone) e del polling (per token pagina).
create index if not exists otp_approve_hash_idx on public.otp_codes (approve_hash);
create index if not exists otp_poll_hash_idx    on public.otp_codes (poll_hash);
