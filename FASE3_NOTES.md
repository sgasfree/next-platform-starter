# 📋 SGAS — Note Fase 3

> Ultimo aggiornamento: 15/06/2026

## ✅ Completato

### Sicurezza
- `syncToSupabase()` non scrive più segreti nel blob (token Telegram, password/email admin, credenziali Supabase).
- `loadFromSupabase()` preserva i segreti da localStorage.
- RLS `config` ristretta: l'anon key legge **solo** la riga `sgas_app_state`.
- Password admin cambiata (`sgas2024` dismessa).
- Eliminate righe seed con segreti dalla tabella `config` (admin_password, emailjs_*, telegram_token).
- Eliminate tabelle inglesi duplicate: `members`, `orders`, `order_items`, `products`.
- Eliminata `categoria` (singolare, vuota, nome sbagliato). La tabella ufficiale è `categorie`.

### Migrazione soci (Fase 3 — Step 0)
- `migrateSociToSupabase()` mappa camelCase del blob → snake_case del DB.
- Abbina i soci esistenti per **tessera normalizzata** (`normTessera()`) → nessun duplicato.
- ✅ 4 soci presenti nella tabella `soci`.
- Admin registrati nella tabella `admins`.

### Fase 3 — Step 1: Migrazione one-shot

| Dato | Funzione | Stato |
|------|----------|-------|
| Soci | `migrateSociToSupabase()` | ✅ 4 soci migrati |
| Ordini | `migrateOrdiniToSupabase()` | ✅ funzionante |
| Messaggi | `migrateMessaggiToSupabase()` | ✅ funzionante (usa `_buildSocioIdMap`) |

- `_buildSocioIdMap(sb)` risolve blobId → dbId via tessera normalizzata (evita FK violation su messaggi).
- Colonne aggiunte al volo su DB vecchio: `ordini.created_at`, `ordini.stato`, `ordini.nota`, `messaggi.created_at`, `messaggi.letto`.

### Fase 3 — Step 2: Doppio write (non-blocking)

| Evento | Funzione sync | Stato |
|--------|--------------|-------|
| Nuovo ordine | `_syncOrderToSupabase(ord)` | ✅ |
| Messaggio socio→admin | `_syncMessaggioToSupabase(msg)` | ✅ |
| Messaggio admin→socio | `_syncMessaggioToSupabase(msg)` | ✅ |

- Chiamate con `.catch(console.warn)` — non bloccano mai l'utente.
- Il blob rimane sorgente di verità; Supabase riceve la copia in background.

### Fase 3 — Step 3: Lettura da Supabase (multi-device)

| Vista | Funzione load | Refactor render |
|-------|--------------|----------------|
| Ordini (admin) | `loadOrdiniFromSupabase()` | `renderOrdini()` → shell + `_renderOrdiniTable()` |
| Messaggi (admin) | `loadMessaggiFromSupabase()` | `renderAdminMsgList()` → shell + `_renderAdminMsgListInner()` |
| Messaggi (socio) | `loadMessaggiFromSupabase()` | `renderMessaggiSocio()` → mostra blob subito, aggiorna da DB |

- Tutte e tre le viste testate ✅ su **desktop** e ✅ su **mobile** (multi-device verificato).
- `loadOrdiniFromSupabase()` popola `S.ordini` → tutto il codice esistente continua a funzionare senza modifiche.

### Logo Telegram
- Foto profilo 512×512 (`/tmp/logo_sgas2.svg`) + welcome banner 640×360 (`/tmp/welcome_sgas.svg`) generati e consegnati.

---

### Fase 3 — Rimozione anagrafica soci dal blob pubblico (16/06/2026)

- `syncToSupabase()` non include più `S.soci` nel payload scritto su `config` (`sgas_app_state`).
- `loadFromSupabase()` ripristina `S.soci` da localStorage (il remoto non lo contiene più).
- `esportaAppNetlify()` (vecchio export manuale per Netlify) non incorpora più `S.soci` nel file HTML scaricato.
- **Flusso "Recupera credenziali"** (`recVerifyStep1/2/3`) non fa più matching client-side su `S.soci`: usa la nuova Netlify Function `auth-recover-tessera.js` (service-role key, nessun elenco soci esposto al client).
- **Login OTP socio** (`socioVerifyCode`): dopo `verifyOtp`, carica la propria riga da Supabase (`_fetchOwnSocioFromSupabase`, RLS self-select) invece che dal blob; fallback al locale se non disponibile.
- **Admin "Gestione Soci"**: `renderSoci()` ricarica l'elenco completo da Supabase (`loadSociFromSupabase()`, RLS admin-all) prima di renderizzare la tabella.
- **Doppio write soci**: `saveSocio()` / `deleteSocio()` propagano su Supabase (`_syncSocioToSupabase`, `_deleteSocioFromSupabase`) — i nuovi soci creati da admin sono salvati con lo stesso id sia in locale che su Supabase.
- `loadOrdiniFromSupabase()` / `loadMessaggiFromSupabase()` richiamano `loadSociFromSupabase()` prima di costruire i campi denormalizzati (nomi soci in ordini/messaggi), così restano corretti senza il blob.
- ⚠️ Non testato in produzione: verificare login OTP, "Gestione Soci" (crea/modifica/elimina) e "Recupera credenziali" da browser reale dopo il merge.

### Fase 3 — Prenotazioni su Supabase + sync eliminazione ordini (16/06/2026)

- Schema: `public.prenotazioni` ridisegnata come tabella "campagna" (admin-managed, lettura pubblica come il catalogo: `fornitore_id, titolo, items, data_consegna, nota_consegna, aperta`). Nuova tabella `public.ordini_prenotazione` per gli ordini dei soci contro una campagna (`prenotazione_id, socio_id, items, totale`), RLS: socio vede/scrive solo i propri, admin tutto.
- `migratePrenotazioniToSupabase()`: migrazione one-shot di `S.prenotazioni` → `prenotazioni` e `S.ordiniPrenotazione` → `ordini_prenotazione` (bottone in Settings).
- Doppio write: `_syncPrenotazioneToSupabase()` / `_deletePrenotazioneFromSupabase()` (admin: salva/toggle/elimina campagna), `_syncOrdinePrenotazioneToSupabase()` / `_deleteOrdinePrenotazioneFromSupabase()` (socio: invia/cancella prenotazione).
- Lettura: `loadPrenotazioniFromSupabase()` popola `S.prenotazioni`/`S.ordiniPrenotazione`; `renderPrenotazioni()` (admin) e `renderPrenotazioniSocio()` (socio) refactorate nel pattern shell + inner (mostrano subito i dati locali, poi aggiornano da Supabase).
- `eliminaOrdine()` ora propaga anche il DELETE su Supabase (`_deleteOrdineFromSupabase()`), non solo sul blob.
- ⚠️ Lo schema SQL va ri-eseguito su Supabase (drop/recreate di `prenotazioni`, che non era ancora usata da nessuna funzione di sync — drop sicuro). Non testato in produzione: verificare migrazione, creazione campagna, prenotazione socio, e eliminazione ordine da browser reale dopo il merge.

### Fase 3 — Fix socio_id in migrazione ordini (16/06/2026)

- `migrateOrdiniToSupabase()` scriveva `socio_id` con il blobId raw (`o.socioId`), a differenza di `migrateMessaggiToSupabase()`, `migratePrenotazioniToSupabase()` e `_syncOrderToSupabase()` che già risolvono blobId→DB id tramite `_buildSocioIdMap()`. Corretto: ora usa la stessa mappa, così gli ordini migrati in blocco puntano all'id corretto in `soci` anche quando il socio esisteva già su Supabase con un id diverso dal blobId (abbinamento per tessera).

## 🎯 Prossimi step (in ordine di priorità)

| # | Cosa | Note |
|---|------|------|
| 1 | **Moiraghi (SGAS-00015)** | `user_id = NULL` — non ha ancora fatto login OTP. Quando lo farà, aggiungere a `admins` |

---

## 🔑 Promemoria tecnici

- Scritture su tabelle con RLS → usare `getAuthSb()` (sessione OTP), mai `getSupabase()` (anon).
- `normTessera(s)` → strip spazi/trattini/zeri iniziali, uppercase. Es: `'SGAS 0016'` → `'SGAS16'`. Usarla sempre per matching.
- `_buildSocioIdMap(sb)` → risolve blobId → DB uuid via tessera (necessario per FK messaggi/ordini).
- Tessere miste: `SGAS 0016` / `SGAS-00016` / `s0016` — gestite tutte da `normTessera()`.
- Doppio write: non-blocking, failure → solo `console.warn`.

## 🗂 Riferimenti rapidi

- App: `public/index.html` (single-page, ~27k righe)
  - `normTessera()`, `_buildSocioIdMap()`
  - `migrateSociToSupabase()`, `migrateOrdiniToSupabase()`, `migrateMessaggiToSupabase()`
  - `_syncOrderToSupabase()`, `_syncMessaggioToSupabase()`
  - `loadOrdiniFromSupabase()`, `loadMessaggiFromSupabase()`
  - `syncToSupabase()` / `loadFromSupabase()` — sync blob ↔ `config`
  - `getAuthSb()` — client Supabase con sessione OTP (per scritture RLS)
- Schema DB: `supabase/schema.sql`
- Netlify Functions: `netlify/functions/auth-request-code.js`, `auth-verify-code.js`
- Supabase URL: `https://luhuwhmtaerkwipyilcy.supabase.co`
- Bot Telegram: `@infoSgas_bot`
- Branch sviluppo: `claude/review-sgas-freeconomy-GtDm6` · Production branch Netlify: `main`
