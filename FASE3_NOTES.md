# 📋 SGAS — Note Fase 3 (ripartenza)

> Ultimo aggiornamento: 14/06/2026

## ✅ Completato

### Sicurezza
- `syncToSupabase()` non scrive più segreti nel blob (token Telegram, password/email admin, credenziali Supabase).
- `loadFromSupabase()` preserva i segreti da localStorage.
- RLS `config` ristretta: l'anon key legge **solo** la riga `sgas_app_state`.
- Password admin cambiata (`sgas2024` dismessa).

### Pulizia database Supabase
- Eliminate righe seed con segreti nella tabella `config`.
- Eliminate tabelle inglesi duplicate: `members`, `orders`, `order_items`, `products`.
- Eliminata `categoria` (singolare, vuota, nome sbagliato). La tabella ufficiale è `categorie` (plurale, nello schema; verrà creata applicando `schema.sql`).

### Migrazione soci (Fase 3 — primo pezzo)
- Aggiunto pulsante **👥 Migra soci su Supabase** nel pannello admin (sezione Supabase).
- `migrateSociToSupabase()` mappa i campi camelCase del blob → snake_case del DB e abbina i soci esistenti per **tessera normalizzata** (riusa l'id già presente → nessun duplicato).
- ✅ 4 soci ora presenti nella tabella `soci`; cognome Labanca corretto.
- Admin registrati nella tabella `admins`.

### Logo Telegram
- Foto profilo 512×512 + welcome banner 640×360 generati e consegnati.

## ⚠️ DA FARE SUBITO (prima di tutto)

1. **Mergiare la PR #44** (branch `claude/review-sgas-freeconomy-GtDm6`) — contiene i commit non ancora in `main`:
   - `d667640` security: restringi config_read alla sola chiave sgas_app_state
   - `67f9edb` feat(fase3): pulsante migrazione soci su Supabase
   - `d8434b0` fix(fase3): migrazione soci abbina per tessera normalizzata

   Senza il merge, il pulsante migrazione **non è in produzione**.

## 🎯 Prossimi step Fase 3 (in ordine)

| # | Cosa | Note |
|---|------|------|
| 1 | **Ordini** → tabella `public.ordini` | RLS per-socio già nello schema; serve pulsante migrazione + far leggere/scrivere l'app dalla tabella invece che dal blob |
| 2 | **Messaggi** → tabella `public.messaggi` | RLS `socio_id` del socio o admin |
| 3 | **Prenotazioni** → tabella `public.prenotazioni` | create dall'admin |
| 4 | **Anagrafica soci nel blob** | ⚠️ ancora leggibile pubblicamente in `sgas_app_state`: va rimossa dal blob una volta che l'app legge i soci dalla tabella `soci` |

## 🔑 Promemoria tecnici

- Le scritture su tabelle con RLS richiedono **sessione OTP attiva + `user_id` in `admins`** → usare il client `getAuthSb()`, non `getSupabase()`.
- Tessere in formati misti (`SGAS 0016` / `SGAS-00016`) → usare sempre `normTessera()` (esiste lato client in `public/index.html` e nelle Netlify Functions `auth-request-code.js` / `auth-verify-code.js`).
- Moiraghi (SGAS-00015) non ha ancora fatto login → `user_id` NULL, non ancora admin attivo. Farà login OTP → `user_id` si popola da solo, poi va aggiunto a `admins`.
- Gli id soci nel DB avevano casing misto (`s0001` / `S0015`); la migrazione li gestisce via tessera normalizzata.

## 🗂 Riferimenti rapidi

- App: `public/index.html` (single-page, ~27k righe)
  - `migrateSociToSupabase()` + `normTessera()` — nuove funzioni Fase 3
  - `syncToSupabase()` / `loadFromSupabase()` — sync blob ↔ `config`
  - `getAuthSb()` — client Supabase con sessione OTP (per scritture RLS)
- Schema DB: `supabase/schema.sql`
- Netlify Functions: `netlify/functions/auth-request-code.js`, `auth-verify-code.js`
- Supabase URL: `https://luhuwhmtaerkwipyilcy.supabase.co`
- Bot Telegram: `@infoSgas_bot`
- Branch sviluppo: `claude/review-sgas-freeconomy-GtDm6` · Production branch Netlify: `main`
