-- ============================================================================
-- MIGRAZIONE: le raccolte ordini passano dal blob alla loro tabella
-- Data: 2026-08-25
-- ============================================================================
--
-- CONTESTO
-- Le raccolte vivevano dentro il blob condiviso `config` (chiave
-- 'sgas_app_state'): un unico documento JSON riscritto per intero a ogni
-- salvataggio. Un dispositivo con una copia vecchia poteva quindi riscriverlo
-- e far sparire per tutti le raccolte create nel frattempo da altri — cosa
-- realmente accaduta il 25/08/2026 con due raccolte di agosto.
--
-- La tabella `public.raccolte` ESISTE GIÀ da schema.sql, con RLS attiva e le
-- policy `raccolte_read` (lettura pubblica) e `raccolte_admin`. Non era però
-- usata: mancano due colonne che servono ora che l'app ci scrive davvero.
-- Questa migrazione si limita quindi ad aggiungerle.
--
-- È idempotente: si può rieseguire senza rischi.
-- ============================================================================

-- Data di creazione: l'app la mostra in elenco e la usa per ordinare le
-- raccolte dalla più recente.
alter table public.raccolte add column if not exists data_creazione date;

-- Momento dell'ultima modifica, per capire quando una raccolta è stata toccata.
alter table public.raccolte add column if not exists updated_at timestamptz not null default now();

-- Le raccolte già presenti non hanno una data di creazione: usa quella di
-- inserimento, così l'ordinamento in elenco resta sensato.
update public.raccolte
   set data_creazione = created_at::date
 where data_creazione is null
   and created_at is not null;

create index if not exists raccolte_aperta_idx on public.raccolte (aperta);

-- ============================================================================
-- VERIFICA
-- ============================================================================
-- select id, nome, aperta, data_creazione, data_chiusura from public.raccolte;
--
-- Dopo il deploy, al primo accesso di un admin le raccolte ancora nel blob
-- vengono copiate qui automaticamente, una sola volta.
-- ============================================================================
