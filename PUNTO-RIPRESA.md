# 📍 Punto di ripresa — SGAS Freeconomy

_Ultimo aggiornamento: 4 luglio 2026 · branch `claude/review-sgas-freeconomy-GtDm6`_

---

## 👥 Tesserati non visibili con login email+password → RISOLTO (PR #91)
Dopo la rimozione dell'anagrafica dal file pubblico (PR #88), un admin che entra
con **email+password** (senza sessione Supabase) non vedeva i tesserati (la RLS
blocca la lettura anon). I dati NON sono persi: sono nella tabella `soci` di Supabase.
- **Sblocco immediato (nessun deploy)**: entra via **Telegram OTP** → i tesserati ricompaiono.
- **Fix definitivo (PR #91)**: azione `soci-list` nel proxy → gli admin email+password
  leggono i tesserati via service_role. ⚠️ Funziona solo dopo aver impostato
  `STATE_TOKEN_SECRET` su Netlify (stesso secret del punto 3) e deployato.

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

### 🔴 Sicurezza — punto 3: PROXY PRONTO, manca il rollout (PR #89)
**Codice completo e testato**; restano 2 passi manuali + l'attivazione SQL a stadi.
- ✅ Creata Netlify Function `netlify/functions/state-save.js`: proxy che verifica
  il chiamante (admin via email+password, tesserato via tessera+cellulare) e scrive
  `config` con la service_role. Token firmato HMAC (24h). Testata a fondo (crittografia
  + 8 casi handler + flusso client end-to-end con Chromium headless).
- ✅ Client (`syncToSupabase`) ora salva via proxy **con fallback al percorso anon**
  finché la policy SQL non è attiva → nessun downtime.
- ✅ Migrazione SQL pronta: `supabase/migrations/2026-07-05_lock_config_writes.sql`.
- ✅ SQL di setup in-app aggiornato alla versione sicura (niente più `public_rw`).

**ROLLOUT (in ordine, quando riprendiamo):**
1. Deploy dell'app (merge PR #89).
2. Su **Netlify** → env var: aggiungere `STATE_TOKEN_SECRET` = stringa lunga e casuale
   (es. 40+ caratteri). Senza questa, il proxy non parte e resta attivo il fallback anon.
3. Verificare in produzione: login admin → salvataggio → `config.updated_at` cambia;
   ordine da tesserato → l'admin lo vede. (Il proxy gestisce entrambi.)
4. Solo dopo la verifica: eseguire la migrazione SQL nel **SQL Editor Supabase**
   (`2026-07-05_lock_config_writes.sql`) → blocca le scritture anonime.
5. (facoltativo) Dopo qualche giorno, rimuovere il fallback anon dal client.

### 🟠 Sicurezza — punti minori
- **EmailJS**: attivare restrizione per dominio nel pannello EmailJS (invii solo dal
  dominio Netlify ufficiale). Opzionale: spostare invio email lato server.
- **Scrittura concorrente admin** (last-write-wins): valutare avviso quando due admin
  editano la stessa sezione, o salvataggio per-entità invece del blob intero.
  Priorità in base a quanti admin lavorano davvero in contemporanea.

### 📱 Miglioramenti mobile
1. ✅ **PWA installabile** — FATTO: `public/manifest.json` + `public/sw.js`
   (service worker) + icone (192/512/maskable). App installabile sul telefono
   (icona in home, schermo intero) e catalogo consultabile offline. Cache
   conservativa: network-first per l'HTML, cache-first per gli asset, nessuna
   intercettazione di Supabase/Functions. Verificato headless: manifest valido,
   SW attivo, ricarica offline funzionante.
2. ✅ **Alleggerire il peso** — FATTO (PR #90): libreria Word (docx.js, 725 KB)
   estratta in `public/docx-lib.js` e caricata solo al primo export. index.html
   da 3,0 MB → 2,29 MB (−24%). Resta possibile ottimizzare le immagini base64.
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
