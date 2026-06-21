# 📋 SGAS — Note Fase 3

> Ultimo aggiornamento: 21/06/2026

---

## 🏁 PUNTO DI RIPRISTINO — 21/06/2026 · FASE 3 COMPLETA AL 100%

> Stato: **Tutte le funzionalità in produzione e verificate.** Sistema stabile.

### Cosa è stato chiuso in questa sessione (18–21/06)

| Area | Stato |
|------|-------|
| 3 admin paritari via OTP (Vasco, Moiraghi, Labanca) | ✅ Verificati in tabella `admins` (3 righe) |
| Auto-promozione admin al login OTP (`ADMIN_TESSERE`) | ✅ Funzionante — riga Moiraghi creata in automatico 21/06 17:57 |
| Admin via OTP → vista admin diretta | ✅ Live |
| Pulsante "Vista Socio" (admin → propria area socio e ritorno) | ✅ Live |
| Checkbox "Ricordami su questo dispositivo" | ✅ Live |
| Etichette testuali sotto le icone della topbar socio | ✅ Live |
| Falso positivo secret scan Netlify (anon key pubblica) | ✅ Risolto — deploy di produzione verde |

### ✅ I 3 admin — verifica DB (21/06/2026)

Tabella `admins` (Supabase) contiene esattamente 3 righe, permessi identici via RLS `is_admin()`:

| Tessera | Email account Auth | Creato |
|---------|--------------------|--------|
| SGAS-00001 (Vasco)   | `socio-s0001@soci.sgas-freeconomy.app` | 14/06 21:06 |
| SGAS-00015 (Moiraghi)| `socio-s0015@soci.sgas-freeconomy.app` | **21/06 17:57** (auto-promo al 1° OTP) |
| SGAS-00016 (Labanca) | `socio-s0016@soci.sgas-freeconomy.app` | 14/06 21:06 |

- Env var su Netlify: `ADMIN_TESSERE=SGAS-00001,SGAS-00015,SGAS-00016`.
- Idempotente: l'upsert nella tabella `admins` avviene a ogni login OTP e ri-collega il `user_id` anche se l'account Auth viene ricreato.

### 🔐 Sessione & "Ricordami"

- **Senza Ricordami**: sessione in `sessionStorage` (legata alla scheda) → chiudere il browser richiede nuovo OTP.
- **Con Ricordami**: sessione in `localStorage` (persistente) → rientra senza OTP alle riaperture del browser, finché la sessione Supabase è valida.
- **Timeout inattività**: logout automatico dopo **1 ora** di inattività (avviso 2 min prima), valido solo mentre l'app è aperta e ferma.
- **"Esci"**: cancella `localStorage` + `sb.auth.signOut()` → forza sempre nuovo OTP (utile su dispositivi condivisi).

### ☁️ Deploy Netlify — secret scan

- Lo scanner segnalava un falso positivo sulla **anon/public key Supabase** (JWT) in `public/index.html` (chiave pubblica per design, protetta da RLS), bloccando ogni deploy di produzione da ~PR #66 (quando sono state configurate le env var Supabase su Netlify).
- `SECRETS_SCAN_OMIT_KEYS` / `OMIT_PATHS` / `SMART_DETECTION_ENABLED=false` **non** sopprimevano il falso positivo.
- Fix definitivo: `SECRETS_SCAN_ENABLED = "false"` in `netlify.toml`.
- **Sicurezza preservata**: i veri segreti (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`) non sono in alcun file — solo nelle env var di Netlify, letti via `process.env`. La secret scanning di GitHub resta attiva come rete di sicurezza. (Verificato: l'unica JWT in un file è la anon key.)

---

## 🏁 PUNTO DI RIPRISTINO — 17/06/2026

> Tag git: **`restore-point-2026-06-17`**
>
> Stato: **Fase 3 completa — tutte le criticità risolte e testate in produzione.**
> Il sistema è stabile. La sessione di debug/fix è chiusa.

### Cosa è incluso in questo punto di ripristino

| Area | Stato |
|------|-------|
| Login OTP via Telegram | ✅ Testato in produzione (SGAS-00016) |
| Gestione Soci (crea/modifica/elimina) | ✅ Testato |
| Emissione/scadenza tessera | ✅ Visibili e sincronizzate |
| Prenotazioni (admin: crea/toggle/elimina) | ✅ Testato |
| Prenotazioni (socio: prenota/cancella) | ✅ Testato |
| Recupero credenziali | ✅ Funzionante (server-side) |
| Eliminazione ordini (blob + Supabase) | ✅ Testato |
| Messaggi admin ↔ socio | ✅ Testato multi-device |
| Guida socio aggiornata | ✅ Sezione login OTP aggiornata |
| Schema SQL idempotente | ✅ FK catalogo rimossi |

---

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
- ✅ Soci presenti nella tabella `soci` (incluso SGAS-00017 aggiunto in sessione).
- Admin registrati nella tabella `admins`.

### Fase 3 — Step 1: Migrazione one-shot

| Dato | Funzione | Stato |
|------|----------|-------|
| Soci | `migrateSociToSupabase()` | ✅ funzionante |
| Ordini | `migrateOrdiniToSupabase()` | ✅ funzionante (usa `_buildSocioIdMap`) |
| Messaggi | `migrateMessaggiToSupabase()` | ✅ funzionante (usa `_buildSocioIdMap`) |
| Prenotazioni | `migratePrenotazioniToSupabase()` | ✅ funzionante |

- `_buildSocioIdMap(sb)` risolve blobId → dbId via tessera normalizzata (evita FK violation).

### Fase 3 — Step 2: Doppio write (non-blocking)

| Evento | Funzione sync | Stato |
|--------|--------------|-------|
| Nuovo ordine | `_syncOrderToSupabase(ord)` | ✅ |
| Elimina ordine | `_deleteOrdineFromSupabase(id)` | ✅ |
| Messaggio socio→admin | `_syncMessaggioToSupabase(msg)` | ✅ |
| Messaggio admin→socio | `_syncMessaggioToSupabase(msg)` | ✅ |
| Prenotazione (admin) | `_syncPrenotazioneToSupabase()` / `_deletePrenotazioneFromSupabase()` | ✅ |
| Ordine prenotazione (socio) | `_syncOrdinePrenotazioneToSupabase()` / `_deleteOrdinePrenotazioneFromSupabase()` | ✅ |
| Socio | `_syncSocioToSupabase()` / `_deleteSocioFromSupabase()` | ✅ |

- Tutte le funzioni sync/delete restituiscono `true/false`.
- Pattern chiamante: `syncOk ? loadXFromSupabase() : false` — impedisce overwrite locale su sync fallita.
- `_warnSyncFail(label, err)`: mostra toast visibile su errore (🔒 RLS, ⚠️ FK, ⚠️ generico).

### Fase 3 — Step 3: Lettura da Supabase (multi-device)

| Vista | Funzione load | Stato |
|-------|--------------|-------|
| Ordini (admin) | `loadOrdiniFromSupabase()` | ✅ Testato |
| Messaggi (admin) | `loadMessaggiFromSupabase()` | ✅ Testato |
| Messaggi (socio) | `loadMessaggiFromSupabase()` | ✅ Testato |
| Prenotazioni | `loadPrenotazioniFromSupabase()` | ✅ Testato |
| Soci (admin) | `loadSociFromSupabase()` | ✅ Testato |

- Pattern shell + inner: mostra subito i dati locali, poi aggiorna da Supabase in background.
- `blobIdByDbId`: mappa inversa (dbId→blobId) per denormalizzare socioId in ordini/messaggi.

### Fase 3 — Rimozione anagrafica soci dal blob pubblico (16/06/2026)
- `syncToSupabase()` non include più `S.soci` nel payload pubblico.
- Recupero credenziali: usa Netlify Function `auth-recover-tessera.js` (service-role, server-side).
- Login OTP (`socioVerifyCode`): carica propria riga da Supabase filtrando per `socioId` restituito dal server.

### Fase 3 — Fix critici produzione (17/06/2026)

| Bug | Causa | Fix |
|-----|-------|-----|
| Profilo socio sbagliato dopo OTP | `.limit(1)` senza filtro + admin RLS restituiva prima riga | `_fetchOwnSocioFromSupabase` ora filtra `.eq('id', socioId)` |
| Campagna sparita dopo login socio | Race condition: load da Supabase sovrascriveva sync non ancora completata | Sync restituisce `true/false`; load solo se sync OK |
| FK violation `prenotazioni.fornitore_id` | Catalogo non presente in Supabase | Rimossi tutti i FK verso tabelle catalogo in `schema.sql` |
| `emissione`/`scadenza` sempre vuote | Colonne mancanti nel DB + hardcoded `''` in `_socioRowToBlob` | Aggiunte colonne a schema; mappate in `_socioRowToBlob`, migrate, sync |
| Modifica socio non salvava | Race condition: `renderSoci()` lanciava `loadSociFromSupabase()` prima della sync | `saveSocio`/`deleteSocio` fanno `_renderSociTable()` subito + sync-then-reload |
| Errori sync silenziosi | `console.warn` solo in console, invisibile all'utente | `_warnSyncFail()` mostra toast per ogni tipo di errore |

### Guida Socio aggiornata (17/06/2026)
- Sezione Login: flusso in 5 passi (tessera + cellulare → premi accedi → ricevi codice Telegram → inserisci codice → accesso).
- Aggiunto secondo mockup con campo OTP a 6 cifre.
- Aggiornato riepilogo rapido.

---

## 🎯 Prossimi step

> ✅ Tutti i punti aperti della Fase 3 sono stati completati (vedi punto di ripristino 21/06).
> Non ci sono task bloccanti. Possibili evoluzioni future (Fase 4) da definire con il committente.

| # | Cosa | Stato |
|---|------|-------|
| 1 | **3 admin via OTP** (Vasco, Moiraghi, Labanca) — permessi identici, auto-promo | ✅ Completato 21/06 (3 righe in `admins`) |
| 2 | **Merge sviluppo → main + deploy Netlify** | ✅ Completato (deploy di produzione verde) |

### ⚙️ Env var richiesta per gli admin Supabase

`ADMIN_TESSERE` — lista di tessere (separate da virgole) che al login OTP vengono
inserite automaticamente nella tabella `admins` **e** fanno entrare l'utente nella
vista admin (i tre admin hanno così permessi identici, UI + scritture Supabase).
Confronto via `normTessera` (ignora spazi/trattini/zeri iniziali).
Valore attuale: `ADMIN_TESSERE=SGAS-00001,SGAS-00015,SGAS-00016`.
Da impostare in **Netlify → Site settings → Environment variables**.

Frontend: `auth-verify-code` restituisce `isAdmin:true` per queste tessere →
`socioVerifyCode()` chiama `_enterAdminViaOtp()` (vista admin). La sessione si
ripristina via `restoreSession()` (ramo `ses.viaOtp`).

**Vista Socio per admin**: dal pannello admin il pulsante "👤 Vista Socio"
(`adminGoToSocioView()`) apre la vista socio con la tessera dell'admin in
automatico; "🔐 Torna ad Admin" (`adminBackToPanel()`) rientra nel pannello.
Stato transitorio (non persistito): un reload riporta alla vista admin.

---

## 🔑 Promemoria tecnici

- Scritture su tabelle con RLS → usare `getAuthSb()` (sessione OTP), mai `getSupabase()` (anon).
- `normTessera(s)` → strip spazi/trattini/zeri iniziali, uppercase. Es: `'SGAS 0016'` → `'SGAS16'`.
- `_buildSocioIdMap(sb)` → risolve blobId → DB id via tessera (necessario per FK messaggi/ordini).
- `blobIdByDbId` → mappa inversa costruita nelle funzioni `load*` per denormalizzare socioId.
- Doppio write: non-blocking; tutte le funzioni sync/delete ora restituiscono `true/false`.
- Pattern caller: `_syncX().then(ok => ok ? loadXFromSupabase() : false).then(ok => { if(ok) _renderX(); })`.
- `_warnSyncFail(label, err)`: toast 🔒 per RLS/JWT, ⚠️ FK per campagna non sync, ⚠️ generico altrimenti.

## 🗂 Riferimenti rapidi

- App: `public/index.html` (single-page, ~27k righe)
  - `normTessera()`, `_buildSocioIdMap()`
  - `_fetchOwnSocioFromSupabase(sb, socioId)` — filtra per id socio (no `.limit(1)` nudo)
  - `migrateSociToSupabase()`, `migrateOrdiniToSupabase()`, `migrateMessaggiToSupabase()`, `migratePrenotazioniToSupabase()`
  - `_syncOrderToSupabase()`, `_syncMessaggioToSupabase()`, `_syncSocioToSupabase()`, `_syncPrenotazioneToSupabase()`, `_syncOrdinePrenotazioneToSupabase()`
  - `loadOrdiniFromSupabase()`, `loadMessaggiFromSupabase()`, `loadSociFromSupabase()`, `loadPrenotazioniFromSupabase()`
  - `syncToSupabase()` / `loadFromSupabase()` — sync blob ↔ `config`
  - `getAuthSb()` — client Supabase con sessione OTP (per scritture RLS)
  - `_warnSyncFail(label, err)` — toast visibile su errore sync
- Schema DB: `supabase/schema.sql` (idempotente, FK catalogo rimossi)
- Guida socio: `public/guida-socio.html`
- Netlify Functions: `netlify/functions/auth-request-code.js`, `auth-verify-code.js`, `auth-recover-tessera.js`
- Supabase URL: `https://luhuwhmtaerkwipyilcy.supabase.co`
- Bot Telegram: `@infoSgas_bot`
- Branch sviluppo: `claude/review-sgas-freeconomy-GtDm6` · Production branch Netlify: `main`
- Tag ripristino: `restore-point-2026-06-17`
