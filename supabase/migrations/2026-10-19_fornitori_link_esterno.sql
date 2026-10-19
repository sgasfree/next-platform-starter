-- Link esterno del fornitore (gruppo Telegram dedicato, sito, modulo...).
--
-- Mostrato sempre sulla scheda fornitore, indipendentemente dal "contatto
-- diretto" (quello è per i servizi senza carrello). Due colonne: l'etichetta
-- che vede il tesserato ("Gruppo Telegram Why!Farm", "Sito web"...) e l'URL.
-- Entrambe facoltative: senza URL il link semplicemente non compare.
--
-- Additiva e ripetibile: non tocca nessun dato esistente.
alter table public.fornitori add column if not exists link_esterno_label text;
alter table public.fornitori add column if not exists link_esterno_url text;
