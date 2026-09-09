-- Ordine dei prodotti dentro la sezione del listino.
--
-- I prodotti di un fornitore si dividono in sezioni scrivendo la sezione nel
-- nome, prima del separatore " · " ("01 KRINOSAN · Shampoo 250 ml"). Dentro
-- la sezione però l'ordine alfabetico non sempre va bene: in una linea
-- cosmetica la sequenza è informazione — detergente, tonico, crema — e
-- l'alfabeto metterebbe la crema Over 35 prima del detergente.
--
-- Questa colonna dà a ogni prodotto un posto dentro la propria sezione.
-- È facoltativa: chi non ce l'ha resta in coda, in ordine alfabetico, quindi
-- i cataloghi che non la usano non cambiano di una virgola.
--
-- Additiva e ripetibile: non tocca nessun dato esistente.
alter table public.prodotti add column if not exists ordine int;

-- Presentazione della sezione.
--
-- Alcune sezioni non sono solo un'etichetta: una linea cosmetica arriva col
-- suo testo di presentazione, che sul listino sta sotto il titolo e prima
-- degli articoli. Il testo si scrive sul PRIMO prodotto della sezione — è
-- quello che apre l'intestazione — e da lì viene mostrato una volta sola.
-- Anche questa facoltativa: le sezioni senza testo restano il titolo secco.
alter table public.prodotti add column if not exists sezione_descrizione text;

-- Nota di chiusura della sezione.
--
-- Certe sezioni si chiudono con un'avvertenza che sul listino sta DOPO
-- l'ultimo articolo, non prima del primo: "questi prodotti non sono soggetti
-- a scadenza e non temono la temperatura". Vale per tutta la sezione, quindi
-- si scrive su un prodotto qualunque di quella sezione e compare una volta
-- sola, alla fine.
alter table public.prodotti add column if not exists sezione_nota text;
