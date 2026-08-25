-- ============================================================================
-- MIGRAZIONE: fornitori e prodotti passano dal blob alle loro tabelle
-- Data: 2026-08-25
-- ============================================================================
--
-- CONTESTO
-- Come le raccolte, anche il catalogo viveva dentro il blob condiviso `config`,
-- riscritto per intero a ogni salvataggio. Un dispositivo con una copia vecchia
-- cancellava le modifiche fatte nel frattempo da altri — è così che sono andate
-- perse le modifiche di Admin 2 al fornitore Az. Agricola Petruzza. Il problema
-- pesa soprattutto sui prodotti freschi, i cui prezzi e la cui disponibilità
-- cambiano spesso e da più persone.
--
-- Le tabelle `public.fornitori` e `public.prodotti` ESISTONO GIÀ da schema.sql,
-- con RLS attiva e le policy `_read` (lettura pubblica) e `_admin`. Non erano
-- però usate dall'app. Questa migrazione aggiunge solo le colonne mancanti.
--
-- IMMAGINI
-- Logo, banner e foto prodotto arrivano qui. Prima venivano tolti dal blob per
-- non farlo crescere e restavano solo nel browser di chi li aveva caricati:
-- gli altri dispositivi non li vedevano. Ora che ogni record ha la sua riga il
-- problema di dimensione non si pone.
--
-- È idempotente: si può rieseguire senza rischi.
-- ============================================================================

-- ── Fornitori: immagini e data di modifica ──────────────────────────────────
alter table public.fornitori add column if not exists logo       text;
alter table public.fornitori add column if not exists banner     text;
alter table public.fornitori add column if not exists updated_at timestamptz not null default now();

-- ── Prodotti: foto e data di modifica ───────────────────────────────────────
alter table public.prodotti  add column if not exists foto       text;
alter table public.prodotti  add column if not exists updated_at timestamptz not null default now();

-- L'indice per fornitore esiste già come prodotti_forn_idx su fornitore_id
-- (schema.sql). Nessun indice nuovo da creare.

-- ============================================================================
-- VERIFICA
-- ============================================================================
-- select column_name from information_schema.columns
--  where table_name = 'fornitori' and column_name in ('logo','banner','updated_at');
-- select column_name from information_schema.columns
--  where table_name = 'prodotti'  and column_name in ('foto','updated_at');
--
-- Attese: tre righe per fornitori, due per prodotti.
--
-- Dopo il deploy, apri l'app come admin DAL DISPOSITIVO CHE HA I LOGHI: la
-- copia automatica del catalogo porta con sé le immagini presenti lì.
-- ============================================================================
