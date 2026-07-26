# 📍 Punto di ripristino — SGAS Freeconomy

_Snapshot al **26 luglio 2026** · branch `claude/review-sgas-freeconomy-GtDm6` · tutto mergiato su `main`_

> Snapshot precedente: 15 luglio 2026 (sicurezza pre-lancio, export ordini, PWA).
> Questo documento lo sostituisce e ne riassume i contenuti.

---

## ✅ STATO ATTUALE — app operativa

Tutti i lavori sono **mergiati su `main`** e deployati. Login OTP e admin funzionanti.

### Configurazioni manuali già fatte (dall'utente)
- ✅ Token bot Telegram ruotato → `TELEGRAM_BOT_TOKEN` su Netlify
- ✅ `STATE_TOKEN_SECRET` su Netlify (proxy scritture)
- ✅ `TELEGRAM_WEBHOOK_SECRET` su Netlify (accesso con un tap)
- ✅ `ADMIN_TESSERE` su Netlify (chi entra via OTP diventa admin)
- ✅ Migrazione SQL `lock_config_writes.sql` (scritture `config` bloccate agli anonimi)
- ✅ Migrazione SQL `otp_tap_approval.sql` (colonne per l'accesso con un tap)
- ✅ Credenziali admin **ripristinate sul server** via OTP (vedi incidente sotto)

---

## 🔧 INCIDENTE RISOLTO — accesso bloccato (26/07)

Vale la pena ricordarlo, perché la diagnosi è stata lunga.

**Sintomi**: OTP non inviava più il codice; l'admin email+password non veniva
autorizzato dal server ("Non riesco ad autenticarmi col server").

**Tre cause distinte, tutte risolte**:
1. **Funzioni non caricate** — le Netlify Functions usavano `import` ma
   estensione `.js`: rinominate in `.mjs` (commit `c4eaba9`). Era la causa
   principale del blocco OTP.
2. **Ruolo admin mancante via OTP** — chi entra col codice Telegram si
   identifica come *tesserato*: il proxy ora controlla `ADMIN_TESSERE` e
   assegna il ruolo admin (PR #103).
3. **Credenziali admin azzerate sul server** — danno residuo del vecchio bug
   (corretto a suo tempo, ma i dati persi non erano stati ripristinati).
   Sanato entrando via OTP e risalvando la password.

⚠️ **Da ricordare**: se in futuro l'admin email+password non viene più
riconosciuto, la via d'uscita è **entrare con OTP** e risalvare la password da
Impostazioni → Configurazione GAS.

---

## 📦 LAVORO SVOLTO IN QUESTA SESSIONE

### 🔐 Accesso e sicurezza
| Cosa | Note |
|------|------|
| Fix perdita credenziali Admin 2/3 | Canale dedicato `admin-creds`; il salvataggio generico non trasporta più credenziali |
| Salvataggi non più silenziosi | Un rifiuto del database ora produce un avviso, non un falso successo |
| Blocco operazioni senza OTP | Tesserati/ordini/messaggi/prenotazioni: avviso esplicito se manca l'OTP |
| Codice recupero password | Inviato anche ad Admin 3 (prima era escluso) |
| Webhook Telegram dall'app | Impostazioni → Telegram → "Attiva accesso con un tap" (token mai esposto al browser) |
| Fix campi Chat ID | Mostravano testo grezzo: salvandoli si rompevano le notifiche |

### 📋 Funzionalità
| Cosa | Note |
|------|------|
| Riepilogo per Tesserato | Tabella pivot in Ordini: tesserato → fornitore → prodotti, con subtotali, filtro raccolta ed export CSV |
| Storico raccolte eliminate | Il nome resta nelle statistiche e negli ordini (niente più voce "Altra") |
| Accesso con un tap | Bottone "✅ Sono io, entra" nel messaggio Telegram + verifica automatica alla 6ª cifra |

### 📖 Guida tesserato
| Cosa | Note |
|------|------|
| Installazione app (PWA) | Istruzioni per Android, iPhone e Desktop |
| Terminologia | "Socio" → "Tesserato" in tutta la guida |
| Logo reale | Al posto dell'emoji 🌼 nei mockup |
| Login aggiornato | Accesso con un tap, verifica automatica, **codice valido 5 minuti** (diceva 10) |
| **Ricerca prodotti** | Come usare le due barre: nome, **codice articolo**, zona, caratteristiche, unità |

---

## 🔜 BACKLOG — cosa resta (tutto opzionale)

### Sicurezza (minori)
- **EmailJS**: restrizione per dominio nel pannello EmailJS.
- **Scrittura concorrente admin** (last-write-wins): valutare un avviso quando due admin editano la stessa sezione.
- **Hardening login admin**: spostare del tutto la verifica sul server (oggi il gate email+password è client-side; i dati però sono già protetti dal proxy).

### Mobile (rifiniture)
- **Tabelle admin a schede** su schermo piccolo (tesserati/ordini/prodotti).
- **Breakpoint intermedio tablet** (tra 700px e 1024px oggi è desktop pieno).

### Qualità
- **Test automatizzati** committati sui percorsi critici (oggi le verifiche sono manuali, con Chromium headless).
- **Modularizzare il frontend** (monolite in un file): refactor grosso, da valutare per ultimo.

### Documenti
- **Termini e Condizioni + Informativa Privacy**: mai scritti. Discussi i contenuti obbligatori (titolare, dati raccolti, finalità, servizi terzi — Supabase/Telegram/EmailJS —, conservazione, diritti). Da redigere prima di aprire a molti tesserati.

---

## 🧠 Note tecniche per ripartire

- **File**: `public/index.html` (SPA monolitica) + `public/docx-lib.js` (libreria Word, caricata solo al primo export) + `public/guida-socio.html`.
- **Netlify Functions** (⚠️ estensione `.mjs`, non `.js`): `auth-request-code`, `auth-verify-code`, `auth-poll-approval`, `auth-recover-tessera`, `telegram`, `telegram-webhook`, `state-save`. Helper condivisi in `netlify/lib/otp-session.mjs`.
- **`state-save.mjs`** è l'API admin autenticata: azioni `token`, `save`, `soci-list`, `admin-creds`, `telegram-setwebhook`, `telegram-webhookinfo`.
- **Due percorsi di scrittura**:
  - *Catalogo/raccolte/impostazioni* → blob `config` via proxy `state-save` (funziona con email+password **e** OTP).
  - *Tesserati/ordini/messaggi/prenotazioni* → tabelle dedicate con RLS, **richiedono sessione OTP**.
- **Login tesserati**: OTP a 6 cifre via Telegram (valido **5 minuti**, 30 s di attesa fra un invio e l'altro), oppure bottone "✅ Sono io, entra" nel messaggio.
- **Segreti**: solo nelle env di Netlify. Mai nel file pubblico.
- **Test**: server statico locale + Chromium headless in
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`.
- **Deploy**: Netlify collegato al repo → parte automaticamente al merge su `main`.
- ⚠️ **Attenzione**: su questo branch lavora anche un'altra sessione. Controllare
  `git log` prima di modifiche estese, per non sovrapporsi.

---

## ▶️ Come ripartire
1. L'app è operativa: si può usare normalmente.
2. Per nuovi lavori, scegliere una voce dal **Backlog**.
3. Flusso: sviluppo sul branch → verifica headless → commit → push → PR.
