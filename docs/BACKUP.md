# Backup automatico del database

Il piano gratuito di Supabase non offre backup ripristinabili. Per questo
l'app si salva da sola una copia dei dati, ogni notte, **fuori da Supabase**.

## Dove sta la copia

In **Netlify Blobs**, nello store `sgas-backup` del sito
`sgas-freeconomy.netlify.app`. È uno spazio privato dello stesso account
Netlify che ospita l'app:

- non è raggiungibile da internet: lo leggono solo le funzioni del sito;
- è separato dal database: se Supabase venisse svuotato o perso, le copie
  restano;
- non coinvolge nessun servizio nuovo: Netlify gestisce già tutti i dati
  dell'app tramite le sue funzioni.

Chi entra nell'account Netlify può vedere i backup: la verifica in due
passaggi su quell'account protegge anche loro.

## Quando e cosa

| | |
|---|---|
| Quando | Ogni notte alle 2:23 UTC (3:23 o 4:23 in Italia) |
| Chi lo fa | `netlify/functions/backup-db.mjs` (funzione pianificata, orario in `netlify.toml`) |
| Cosa contiene | Tesserati, ordini, messaggi, raccolte, prenotazioni e relativi ordini, fornitori, prodotti, categorie, configurazione dell'app |
| Cosa NON contiene | Password degli admin, codici di accesso e di recupero, account di accesso (si ricreano al primo accesso col codice Telegram) |
| Formato | Un file JSON compresso per notte: `backup-AAAA-MM-GGTHH-MM-SS-mmmZ.json.gz` |
| Quanto si conserva | Gli ultimi 30 backup, più il primo di ogni mese per 12 mesi |

Prima di salvare, la funzione riapre il file compresso e controlla che
contenga tutte le righe lette. Se una tabella importante non si legge, non
salva una copia a metà.

## Avvisi

Gli admin ricevono un messaggio Telegram (agli stessi Chat ID delle notifiche
ordini) in due casi:

- il backup della notte **non è riuscito**;
- rispetto alla notte prima **tesserati, fornitori o prodotti sono più che
  dimezzati**. In quel caso il backup viene salvato lo stesso ma non viene
  cancellata nessuna copia vecchia.

In più, in **Impostazioni → Backup automatico del database** compare un avviso
rosso se l'ultima copia ha più di 36 ore.

## Dal pannello admin

**Impostazioni → 🛟 Backup automatico del database**:

- stato dell'ultima copia (data, quante righe);
- **Scarica l'ultimo**: salva un file `sgas-backup-database-AAAA-MM-GG.json`;
- **Crea backup adesso**: utile prima di un'operazione delicata;
- **Tutte le copie conservate**: elenco con il pulsante Scarica per ognuna.

Il file scaricato contiene dati personali (nomi, numeri di telefono): va
tenuto in un posto sicuro e non va inoltrato.

Queste operazioni passano da `netlify/functions/backup-admin.mjs`, che accetta
solo il permesso da admin.

## Ripristino

Non c'è un pulsante: un ripristino sbagliato fa più danni del guasto.
Il file è un JSON con una voce per tabella:

```json
{ "formato": "sgas-backup", "creato": "2026-11-17T02:23:05.123Z",
  "conteggi": { "soci": 68, "ordini": 5 },
  "tabelle": { "soci": [ { "id": "s0001", "tessera": "SGAS-00001" } ] } }
```

- **Recuperare alcune righe** (un tesserato cancellato per sbaglio, una
  raccolta): si copiano le righe dal file e si reinseriscono nella tabella
  dall'editor di Supabase.
- **Ripristino completo su un progetto nuovo**: si ricreano le tabelle e le
  regole di accesso con `supabase/schema.sql` (istruzioni in
  `supabase/SETUP.md`; le aggiunte successive sono in `supabase/migrations/`),
  poi si inseriscono le tabelle in quest'ordine: `fornitori`, `prodotti`, `categorie`, `raccolte`, `soci`,
  `prenotazioni`, `ordini`, `ordini_prenotazione`, `messaggi`, `config`.
  Nella tabella `soci` il campo `user_id` va lasciato vuoto (gli account di
  accesso non esistono più: si ricollegano al primo accesso). La tabella
  `admins` non va reinserita: si ripopola da sola dalle tessere in
  `ADMIN_TESSERE`. Le password degli admin con email vanno reimpostate.

## Provare in locale

Le funzioni si possono provare senza Netlify con il server di prova di
`@netlify/blobs` (`BlobsServer`), impostando `NETLIFY_BLOBS_CONTEXT`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `STATE_TOKEN_SECRET`.
