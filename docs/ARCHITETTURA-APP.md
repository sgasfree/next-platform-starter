# 🏗️ Architettura dell'App SGAS Freeconomy

Documento tecnico: com'è strutturata l'app dall'inizio alla fine, con tutti i suoi
processi. Pensato per chi mantiene, sviluppa o deve capire il funzionamento interno.

---

## 1. Panoramica generale

**SGAS Freeconomy** è l'app gestionale di un **Gruppo di Acquisto Solidale (GAS)**.
Mette in contatto i **soci** (che ordinano) con i **fornitori** (i cui prodotti
sono a catalogo), il tutto coordinato da uno o più **amministratori**.

Caratteristiche chiave:

- **Single-Page Application** interamente contenuta in **`public/index.html`** (~26.000 righe: HTML + CSS + JavaScript vanilla, nessun framework).
- Funziona **offline / lato client**: i dati vivono nel `localStorage` del browser.
- **Sincronizzazione opzionale** tramite **Supabase** per condividere i dati tra dispositivi.
- **Notifiche** via **Telegram** ed **email (EmailJS)**.
- Distribuita come progetto Next.js starter su Netlify, ma la logica applicativa
  è tutta nel file HTML statico in `public/`.

---

## 2. Modello dei dati — l'oggetto `S`

Tutto lo stato è in un unico oggetto globale **`S`**, serializzato in JSON.

```javascript
let S = {
  config: { /* impostazioni admin: loghi, email, token Telegram, Supabase... */ },
  soci: [],                 // anagrafica soci (tessera, nome, cellulare, telegramChatId)
  fornitori: [],            // fornitori (nome, categoria, descrizione, visione)
  prodotti: [],             // prodotti (nome, prezzo, fornitoreId, categoria)
  raccolte: [],             // "round" di ordini aperti, con date e luogo di ritiro
  prenotazioni: [],         // campagne di prenotazione con quantità min/max
  ordini: [],               // ordini completati dai soci
  ordiniPrenotazione: [],   // ordini provenienti dalle prenotazioni
  messaggi: [],             // thread di chat socio ↔ admin
  cart: { raccoltaId:'', items:[] }  // carrello corrente del socio
};
```

### Persistenza
- **`localStorage["sgas_state"]`** → l'intero oggetto `S`. Salvato da **`saveState()`**.
  Ogni modifica (aggiunta al carrello, invio ordine, ecc.) richiama `saveState()`.
- **`sessionStorage` / `localStorage` token**:
  - `sgas_login_st` → tracciamento tentativi di login admin (anti brute-force).
  - `sgas_live_tok` / `sgas_usr_tok` → token di sessione utente.
- **`saveSession()`** salva l'utente autenticato per non richiedere il login ogni volta.

### Sincronizzazione (Supabase, opzionale)
- Configurata con `S.config.supabaseUrl` e `S.config.supabaseKey`.
- Inizializzata da **`initSupabase()`**.
- All'avvio l'app confronta i dati locali con quelli remoti/incorporati (`_emb`),
  preferisce i più recenti, **deduplica** per ID e **scarta** ordini non validi
  (senza data o ID). Le immagini base64 vengono rimosse dal payload di sync per
  alleggerirlo.

---

## 3. Ruoli e viste

L'app distingue due ruoli, selezionati tramite l'hash dell'URL.

### 👤 SOCIO (`/#`, default)
Autenticazione: **Tessera + Cellulare** (nessuna password). Può:
- sfogliare il catalogo (sola lettura);
- creare ordini e prenotazioni;
- chattare con l'admin;
- modificare il proprio profilo (cellulare, ID Telegram).

Sezioni (commutate da **`showSocioSection(sec)`**):
| Sezione | ID | Contenuto |
|---------|----|-----------|
| Catalogo | `socio-catalogo` | Fornitori e prodotti (vista iniziale) |
| Fornitore | `socio-fornitore` | Dettaglio singolo fornitore |
| Carrello | `socio-cart` | Carrello e invio ordine |
| Messaggi | `socio-messaggi` | Chat con l'admin |
| Profilo | `socio-profilo` | Dati personali del socio |
| Prenotazioni | `socio-prenotazioni` | Campagne di prenotazione |
| Chi siamo | `socio-chisiamo` | Informazioni sul GAS |

### 🛠️ ADMIN (`/#admin`)
Autenticazione: **Email + Password** con hash **PBKDF2-SHA256** (100.000 iterazioni,
salt casuale). Supporta **fino a 3 account admin**. Funzioni anti-attacco:
max 5 tentativi, blocco di 15 minuti.

Può fare **CRUD completo** su: dashboard, soci, fornitori, prodotti, raccolte,
ordini, prenotazioni, messaggi, impostazioni, pagina "chi siamo".

---

## 4. Processi principali (dall'inizio alla fine)

### 4.1 Avvio dell'app
1. Caricamento di `index.html`.
2. Lettura di `localStorage["sgas_state"]`; merge con dati incorporati/remoti.
3. Eventuale `initSupabase()` se configurato.
4. Verifica del token di sessione → se valido, l'utente entra già loggato.
5. Routing in base all'hash: `#admin` → vista admin; altrimenti vista socio.

### 4.2 Login socio — `loginSocio()`
1. Normalizza Tessera (maiuscolo) e cellulare (senza spazi/trattini).
2. Cerca il socio in `S.soci` per tessera + cellulare corrispondenti.
3. Se trovato → imposta `currentUser`, `saveSession()`, mostra la vista socio.
4. Se non trovato → toast *"❌ Tessera o cellulare non trovati"*.

### 4.3 Recupero credenziali socio — `showRecovery('socio')`
Procedura a 3 passi che verifica in sequenza:
1. **Tessera** → `recVerifyStep1()`
2. **Cellulare** → `recVerifyStep2()`
3. **Nome e Cognome** → `recVerifyStep3()`

Al successo mostra Tessera + Cellulare e precompila il login.

### 4.4 Reset password admin — `adminRecStep1..3` + `adminRecSavePass()`
1. L'admin inserisce la propria email.
2. L'app genera un **codice a 6 cifre**, lo invia via **Telegram** all'admin
   (`sendTelegramMsg`); il codice scade in **15 minuti** (max 3 tentativi).
3. Verifica del codice → inserimento nuova password → salvataggio con
   **PBKDF2** in `S.config`.

### 4.5 Ordine del socio — dal carrello a `submitOrder()`
1. Stato raccolta mostrato in cima al catalogo (aperta/chiusa, data/luogo ritiro).
2. Selezione prodotti con **−/+** → `cartChange(pid, delta)` aggiorna `S.cart.items`
   e il badge, salvando lo stato.
3. Carrello (`renderCart()`): rimozione singola **✕**, svuota **🗑**, selezione raccolta.
4. **`submitOrder()`**:
   - valida la raccolta selezionata;
   - crea l'ordine (`ORD-` + codice univoco, dati socio, articoli, totale, timestamp);
   - lo aggiunge a `S.ordini`, svuota il carrello;
   - **esporta un documento Word (.docx)**;
   - invia **email** all'admin (EmailJS) e **notifiche Telegram** ad admin e socio;
   - toast di conferma e ritorno al catalogo.

### 4.6 Messaggistica — `sendMsgSocio()` / `renderMessaggiSocio()`
- Thread unico socio ↔ admin in `S.messaggi`.
- Ogni messaggio: `id`, `socioId`, `da` ('socio'/'admin'), `testo`, `data`,
  flag di lettura `lettoAdmin` / `lettoSocio`.
- Badge dei non letti via `updateMsgBadges()`; spunte **✓✓** = letto.

### 4.7 Prenotazioni — `inviaOrdinePrenotazione(prenId)`
1. Il socio vede solo le prenotazioni con `aperta === true`.
2. Inserisce le quantità (validate contro `qtyMin`/`qtyMax`).
3. **`inviaOrdinePrenotazione`** crea una voce in `S.ordiniPrenotazione`.
4. Annullamento con `cancellaOrdinePrenotazione(ordineId, prenId)`.

### 4.8 Notifiche
- **Telegram** — `sendTelegramMsg(chatId, text)`: usa `S.config.tgBotToken`,
  con destinatari `tgAdminChatId`(2/3) e il `telegramChatId` del socio.
  Eventi: nuovo ordine, codice reset admin, messaggi.
- **Email** — via EmailJS, all'invio di un nuovo ordine.

---

## 5. Mappa funzioni → riga (riferimento rapido)

| Processo | Funzione | Riga ~ |
|----------|----------|--------|
| Salvataggio stato | `saveState()` | 21798 |
| Salvataggio sessione | `saveSession()` | 22046 |
| Init Supabase | `initSupabase()` | 21867 |
| Login socio | `loginSocio()` | 22697 |
| Recupero socio (step 1-3) | `recVerifyStep1/2/3()` | 22474-22501 |
| Recupero/reset admin | `adminRecStep1..3`, `adminRecSavePass()` | 22554-22648 |
| Login admin | `loginAdmin()` | 22754 |
| Hash/verify password | `hashPassword()` / `verifyPassword()` | 22723-22730 |
| Catalogo fornitori | `renderFornitori()` | 22838 |
| Apri fornitore | `openFornitore(id)` | 22910 |
| Modifica carrello | `cartChange(pid, delta)` | 23052 |
| Render carrello | `renderCart()` | 23072 |
| Invio ordine | `submitOrder()` | 23165 |
| Render messaggi socio | `renderMessaggiSocio()` | 25877 |
| Invio messaggio socio | `sendMsgSocio()` | 25827 |
| Render prenotazioni | `renderPrenotazioniSocio()` | 26285 |
| Invio prenotazione | `inviaOrdinePrenotazione()` | 26422 |
| Notifica Telegram | `sendTelegramMsg()` | 21988 |

> ⚠️ I numeri di riga sono indicativi e possono variare con le modifiche future:
> usali come punto di partenza, non come riferimento assoluto.

---

## 6. Diagramma di flusso (alto livello)

```
            ┌──────────────────────────────┐
            │      Avvio index.html        │
            │  carica S da localStorage    │
            │  + merge Supabase/_emb       │
            └──────────────┬───────────────┘
                           │  routing per hash
              ┌────────────┴────────────┐
              ▼                         ▼
        #  (SOCIO)                 #admin (ADMIN)
   Tessera + Cellulare         Email + Password (PBKDF2)
              │                         │
   ┌──────────┼───────────┐            CRUD su tutte le entità
   ▼          ▼           ▼     (soci, fornitori, prodotti,
 Catalogo  Prenotaz.   Messaggi  raccolte, ordini, prenotazioni,
   │          │           │       messaggi, impostazioni)
   ▼          ▼           │
 Carrello  Prenota        │
   │          │           │
   ▼          ▼           ▼
 submitOrder  ordiniPrenotazione  → S.messaggi
   │
   ├─ salva in S.ordini
   ├─ esporta .docx
   └─ notifiche Email + Telegram (admin + socio)
                           │
                           ▼
              saveState() → localStorage
              (+ sync Supabase se attivo)
```

---

## 7. Note di manutenzione
- Tutta l'app è in **`public/index.html`**: HTML, stile e logica nello stesso file.
- `index.html` è servito **senza cache** per evitare versioni vecchie sui mobile.
- Le immagini possono essere salvate come **base64** nello stato, ma vengono
  rimosse dal payload Supabase per non superare i limiti di dimensione.
- Punto di ripristino corrente: tag/branch **`restore-point-2026-06-04`**.
