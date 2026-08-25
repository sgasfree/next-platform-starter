# 📍 Punto di ripristino — SGAS Freeconomy

_Snapshot al **24 agosto 2026** · branch `claude/review-sgas-freeconomy-GtDm6` · PR #107_

> Snapshot precedente: 26 luglio 2026 (incidente accessi, guida, riepilogo ordini).
> Questo documento lo sostituisce e ne conserva le parti ancora valide.

---

## ✅ STATO ATTUALE

App operativa. Login OTP e admin funzionanti. I lavori di questa sessione sono
su **PR #107**, non ancora unita a `main`.

### Configurazioni manuali già fatte (dall'utente)
- ✅ Token bot Telegram ruotato → `TELEGRAM_BOT_TOKEN` su Netlify
- ✅ `STATE_TOKEN_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TESSERE` su Netlify
- ✅ Migrazioni SQL `lock_config_writes.sql` e `otp_tap_approval.sql`

### ⚠️ Da verificare dopo il deploy
La function `telegram` ora legge la configurazione da Supabase: richiede
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `STATE_TOKEN_SECRET`. Le prime due
erano già usate da `state-save`, quindi dovrebbero esserci. Se le notifiche
d'ordine non arrivassero, è il primo posto da controllare: la function
risponderebbe *"Configurazione server incompleta"*.

---

## 🔐 SICUREZZA — falle chiuse in questa sessione

Sono state analizzate due relazioni esterne (12 giugno e 30 luglio). La prima è
in buona parte superata e su un punto era **errata** (sosteneva che non esistesse
alcuna sanitizzazione dell'HTML: `escHtml` esiste ed è usata 193 volte, anche nel
codice citato come vulnerabile). La seconda è accurata e ha trovato una falla
reale che la prima aveva mancato.

### Relay aperto del proxy Telegram — *risolto*
`netlify/functions/telegram.mjs` accettava destinatario e testo arbitrari senza
alcuna verifica: chiunque poteva far scrivere al bot del GAS qualsiasi messaggio
a qualsiasi persona. Per un tesserato era indistinguibile da una notifica vera.

Ora il destinatario dev'essere qualcuno che il GAS conosce:

| Chi chiede | Verso chi | Esito |
|---|---|---|
| Anonimo | chat degli admin | ✅ permesso (serve al recupero password) |
| Anonimo | chiunque altro | 🚫 rifiutato |
| Tesserato autenticato | chat già registrate | ✅ permesso |
| Admin autenticato | destinatario libero | ✅ permesso (pulsante "Test") |

### Impronte delle password admin esposte — *risolto*
L'impronta PBKDF2 era leggibile da chiunque in **due** posti: dentro
`public/index.html` e nel blob `sgas_app_state` su Supabase, che la policy
`config_read` espone in lettura pubblica. All'origine c'era l'export dell'app,
che rimuoveva le password in chiaro ma conservava di proposito le impronte.

- Le impronte vivono ora nella riga `sgas_admin_creds`, che nessuna policy
  espone: si legge solo con la service_role, cioè solo dalle Netlify Functions.
- **Migrazione automatica**: al primo accesso riuscito quelle rimaste nel blob
  pubblico vengono spostate e cancellate da lì, senza intervento manuale.
- Il login admin non confronta più nulla in locale: chiede al server.
- Sul dispositivo non resta alcuna impronta; restano solo le email.
- Cade anche il confronto in chiaro delle password non migrate.

⚠️ **Conseguenze da ricordare**: la password admin si verifica solo **online**
(senza rete resta l'accesso OTP); per cambiare l'email di un Admin 2 o 3 va
ridigitata anche la password.

### Primo avvio — *risolto*
Con la verifica spostata sul server, la procedura guidata avrebbe impostato una
password sconosciuta al server. Aggiunta l'azione `admin-bootstrap`, l'unica
senza autenticazione, che **si chiude da sola** appena un amministratore esiste.

---

## 🐛 Difetti corretti

### Carrelli "fantasma" e ordini a €0
Il carrello (`S.cart`) viaggiava dentro lo stato condiviso su Supabase e veniva
distribuito a tutti i dispositivi collegati: ognuno adottava il carrello
dell'ultimo che l'aveva toccato. Da qui i carrelli con centinaia di articoli mai
aggiunti, e gli ordini a totale zero quando lo scambio avveniva durante l'invio.

- Il carrello non viene più sincronizzato né sovrascritto da remoto.
- `submitOrder()` scarta con avviso le righe che puntano a prodotti inesistenti
  e blocca l'invio se il totale risultasse comunque zero.
- L'avviso "dati aggiornati in tempo reale" non si ripete più a raffica.

⚠️ I dati già corrotti non si sistemano da soli: l'ordine a €0 di SGAS-00003 va
eliminato a mano da Admin → Ordini (serve l'accesso OTP), e chi ha ancora il
carrello gonfio deve premere una volta "🗑 Svuota carrello".

### Prodotti in ordine sparso
La scheda fornitore mostrava i prodotti nell'ordine di inserimento in archivio,
mentre l'elenco admin li ordina per nome. Su Pulitovolante (64 prodotti) le voci
risultavano introvabili. Ora vista tesserato e vetrina usano lo stesso criterio
dell'admin.

> Da verificare quando c'è tempo: in quel fornitore ci sono voci ripetute
> ("Pavimenti" ×3, "Eco Sapone Liquido Universale" ×3, "Vetri, specchi…" ×2).
> Con l'ordine alfabetico ora sono affiancate e facili da confrontare.

---

## 📋 Funzionalità e documenti

| Cosa | Note |
|---|---|
| CSV Riepilogo per Tesserato | Sequenza: Nominativo, Data, Fornitore, Codice fornitore, Prodotto, Prezzo, Q.tà, Importo. Mancavano data e prezzo unitario. Export ora riga per riga (la data non permette di aggregare fra ordini di date diverse); restano subtotali per tesserato e totale generale |
| Modulo ordine | Accanto alla data compare l'ora ("26/07/2026 — ore 14:35") e il contatto Telegram accanto al cellulare |
| Guida Tesserato | Raggiungibile dal menu della Vetrina, così si legge **prima** di chiedere la tessera |
| "Torna Vetrina" | Nuova rotta `#vetrina`: riporta alla vetrina, non alla schermata di accesso. Se una sessione è attiva viene ripristinata |
| Note legali | Bozza in `docs/BOZZA-note-legali.html` — **non pubblicata**, vedi sotto |

### ⚖️ Note legali — bozza NON pubblicata
Termini e Condizioni + Informativa privacy, scritti sul funzionamento reale
dell'app (nessun pagamento interno, nessun cookie di profilazione, servizi terzi
ricavati dal codice: Supabase, Netlify, Telegram, **EmailJS** — quest'ultimo
invia all'amministratore nome, cognome, cellulare e Telegram di chi ordina).

Sta in `docs/`, che **non viene pubblicata** (`netlify.toml` pubblica solo
`public/`). Spostarla in `public/` la renderebbe raggiungibile per indirizzo
diretto anche senza collegamenti nel menu.

**Prima di pubblicarla**: revisione di un professionista, 9 campi da compilare
(titolare, tempi di conservazione, regione di hosting, data di versione), e
rimozione della sezione finale "Nota per chi amministra".

**Nodo di fondo**: SGAS non è costituito in associazione, quindi il titolare del
trattamento non può essere "SGAS" — dev'essere una persona fisica, con
responsabilità e sanzioni a suo carico. Inoltre la legge 244/2007 (art. 1, commi
266-268) definisce i GAS come *soggetti associativi senza scopo di lucro*: senza
forma associativa quell'inquadramento fiscale non è invocabile. Da far
confermare a un commercialista.

---

## 🔜 BACKLOG

### Sicurezza — rapidi
- **Rimuovere `patch_sgas.py`**: non è referenziato da niente (né `package.json`,
  né doc, né build) e contiene il vecchio token, già ruotato. Pura pulizia.
- **TTL del token** `state-save` da 24 h a 2 h.
- **Riattivare il secret scanning** su Netlify (`SECRETS_SCAN_ENABLED = "false"`).
- **Pulizia automatica dei codici OTP scaduti** (un job `pg_cron` su Supabase).

### Sicurezza — impegnativi
- **CSP senza `unsafe-inline`**: richiede di estrarre il JS dal file monolitico.
- **Rate limiting per IP** sugli endpoint di autenticazione. Il rischio è
  sovrastimato nella relazione: con 30 s fra un codice e l'altro, 5 tentativi per
  codice e scadenza a 5 minuti, il brute-force non è praticabile.
- **Attributi non filtrati** (`src` del logo, `href` di telefono/WhatsApp): sono
  campi che solo un admin compila, quindi severità bassa.

### Altro
- Contatti (cellulare e Telegram) nel modulo ordine scaricato dall'**admin**:
  oggi non ci sono, ed è il documento che serve per consegne e ritiri.
- Registrare quando ciascun tesserato prende visione delle note legali.
- EmailJS: restrizione per dominio nel pannello.
- Tabelle admin a schede su schermo piccolo; breakpoint tablet.
- Test automatizzati committati (oggi le verifiche sono manuali, headless).
- Modularizzare il frontend: refactor grosso, da valutare per ultimo.

---

## 🧠 Note tecniche per ripartire

- **File**: `public/index.html` (SPA monolitica, ~8.600 righe) + `public/docx-lib.js`
  (libreria Word, caricata solo al primo export) + `public/guida-socio.html`.
- **Netlify Functions** (⚠️ estensione `.mjs`, non `.js`): `auth-request-code`,
  `auth-verify-code`, `auth-poll-approval`, `auth-recover-tessera`, `telegram`,
  `telegram-webhook`, `state-save`. Helper in `netlify/lib/otp-session.mjs`.
- **`state-save.mjs`** è l'API admin autenticata: azioni `token`, `save`,
  `soci-list`, `admin-creds`, `admin-bootstrap`, `telegram-setwebhook`,
  `telegram-webhookinfo`.
- **Righe nella tabella `config`**:
  - `sgas_app_state` → stato dell'app, **lettura pubblica** (serve alla vetrina).
    Non deve contenere segreti.
  - `sgas_admin_creds` → impronte delle password admin, **nessuna policy**:
    accessibile solo con la service_role.
- **Due percorsi di scrittura**:
  - *Catalogo/raccolte/impostazioni* → blob `config` via proxy `state-save`
    (funziona con email+password **e** OTP).
  - *Tesserati/ordini/messaggi/prenotazioni* → tabelle dedicate con RLS,
    **richiedono sessione OTP**.
- **Login tesserati**: OTP a 6 cifre via Telegram (valido **5 minuti**, 30 s fra
  un invio e l'altro), oppure bottone "✅ Sono io, entra" nel messaggio.
- **Login admin**: verificato dal server. Nessuna impronta sul dispositivo.
- **Segreti**: solo nelle env di Netlify. Mai nel file pubblico.
- **Test**: server statico locale + Chromium headless in
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`.
  ⚠️ `node_modules` viene ripulito: se manca `playwright-core`, reinstallarlo con
  `npm install playwright-core --no-save` e lanciare con
  `NODE_PATH=/home/user/next-platform-starter/node_modules`.
- **Deploy**: Netlify collegato al repo → parte automaticamente al merge su `main`.
- ⚠️ **Attenzione**: su questo branch ha lavorato anche un'altra sessione.
  Controllare `git log` prima di modifiche estese.

---

## ▶️ Come ripartire
1. L'app è operativa: si può usare normalmente.
2. **PR #107 è ancora aperta**: contiene tutti i lavori di questa sessione.
3. Per nuovi lavori, scegliere una voce dal **Backlog**.
4. Flusso: sviluppo sul branch → verifica headless → commit → push → PR.
