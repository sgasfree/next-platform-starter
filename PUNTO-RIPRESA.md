# 📍 Punto di ripresa — SGAS Freeconomy

_Ultimo aggiornamento: 4 luglio 2026 · branch `claude/review-sgas-freeconomy-GtDm6`_

---

## ⚠️ AZIONI MANUALI URGENTI (da fare TU sui pannelli, prima di aprire ai tesserati)

Questi due segreti erano **pubblici** nel file → vanno considerati compromessi anche ora
che li ho rimossi dal codice (vedi PR #88):

1. **Rigenerare il token del bot Telegram**
   - Telegram → `@BotFather` → `/revoke` → genera nuovo token
   - Metti il nuovo token nella env var `TELEGRAM_BOT_TOKEN` su **Netlify** (Site settings → Environment variables)
2. **Reimpostare la password dell'Admin 2**
   - Dall'app: Impostazioni → reimposta password (verrà salvata hashata)

---

## ✅ FATTO in questa sessione (tutto già su PR)

| PR | Cosa | Stato |
|----|------|-------|
| #82 | Export CSV: virgola decimale, colonna totale corretta, allineamento numeri | merged |
| #83 | Fix password admin 2/3 (impostazioni + recupero password) | merged |
| #84 | Ricerca interna estesa a tutti i campi + codice articolo | merged |
| #85 | Sync credenziali admin multi-dispositivo + chiusura automatica raccolte (ora italiana) | merged |
| #86 | Fix fornitori duplicati (Tombea/whyfarm) + etichetta categoria admin | merged |
| #87 | Fix canale realtime che annullava i cambi password con 3 admin | merged |
| #87 | Rimozione script morto OneSignal (alleggerisce mobile) | merged |
| #88 | **Sicurezza**: rimossi password2 in chiaro, token bot, anagrafiche soci dal file pubblico | **da mergiare** |

---

## 🔜 DA FARE nella prossima sessione

### 🔴 Sicurezza — punto 3 (il più importante rimasto)
**Restringere la policy RLS della tabella `config` su Supabase.**
Attualmente chiunque con l'anon key (pubblica) può leggere e **sovrascrivere** l'intero
stato dell'app (fornitori, prodotti, raccolte, ordini). L'anagrafica soci è già protetta,
il resto no.
- Preparare la migrazione SQL: scrittura consentita solo agli admin autenticati
  (come già fatto per `soci` con `is_admin()`), lettura pubblica se serve al catalogo ospite.
- Adattare le scritture di stato del client per usare la sessione autenticata.
- **Serve accesso al pannello Supabase (SQL Editor).**

### 🟠 Sicurezza — punti minori
- **EmailJS**: attivare restrizione per dominio nel pannello EmailJS (invii solo dal
  dominio Netlify ufficiale). Opzionale: spostare invio email lato server.
- **Scrittura concorrente admin** (last-write-wins): valutare avviso quando due admin
  editano la stessa sezione, o salvataggio per-entità invece del blob intero.
  Priorità in base a quanti admin lavorano davvero in contemporanea.

### 📱 Miglioramenti mobile (già discussi, non ancora fatti)
Ordine consigliato per rapporto sforzo/beneficio:
1. **PWA installabile** — aggiungere `manifest.json` + service worker minimale:
   l'app diventa installabile sul telefono dei tesserati e consultabile offline
   (catalogo visibile senza rete). _Beneficio alto, pubblico principale = mobile._
2. **Alleggerire il peso** (~3 MB / 1,5 MB gzip): caricare la libreria Word (docx.js)
   solo al primo export invece che sempre; ottimizzare le immagini base64.
3. **Vista "a schede" per le tabelle admin** su schermo piccolo (tesserati/ordini/prodotti).
4. **Breakpoint intermedio tablet** (tra 700px e 1024px oggi è desktop pieno).

---

## 🧠 Note tecniche utili per ripartire

- File unico: `public/index.html` (~27.800 righe, SPA con tutto incorporato).
- Stato `_emb` (riga 9): blob JSON iniziale. `_embVer` triggera il merge/aggiornamento.
- Flusso dati: `_emb` → localStorage → `loadState()` → `initSupabase()` → `loadFromSupabase()`.
- Segreti veri: solo nelle env di Netlify (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`),
  usati dalle Netlify Functions in `netlify/functions/`.
- Login tesserati: OTP a 6 cifre via Telegram (server-side), poi sessione Supabase con RLS.
- Test rapido: server statico locale + Chromium headless in
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
  (usato per verificare tutte le modifiche di questa sessione).

---

## ▶️ Come ripartire
1. Fare le 2 azioni manuali urgenti sopra (token bot + password admin 2).
2. Mergiare PR #88 (sicurezza) se non ancora fatto.
3. Partire dal **punto 3 sicurezza** (RLS `config`) — serve accesso Supabase.
4. Poi valutare i miglioramenti mobile (PWA in testa).
