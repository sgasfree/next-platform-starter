# 🧭 Come capire e modificare l'app senza Claude

Guida pratica per orientarsi nel codice e fare modifiche da soli, se un
giorno non fosse disponibile un assistente IA. Non sostituisce
`docs/ARCHITETTURA-APP.md` (più tecnico e dettagliato): questa è pensata
per capire **dove mettere le mani** e **come pubblicare**, partendo da zero.

---

## 1. La mappa in breve

Tutta l'app che si vede nel browser è **un solo file**:

```
public/index.html
```

HTML, stile (CSS) e logica (JavaScript) sono tutti lì dentro, circa
10.000 righe. Non ci sono altri file da cui dipende l'aspetto delle
pagine: se cerchi un testo che vedi sul sito, lo trovi lì (Ctrl+F /
"Cerca nel file").

Il resto del progetto serve a far funzionare le parti che non sono solo
HTML:

| Dove | Cosa fa |
|---|---|
| `netlify/functions/*.mjs` | Le funzioni server: login, invio notifiche Telegram, salvataggio dati admin. Girano su Netlify, non nel browser. |
| `supabase/migrations/*.sql` | Storico delle modifiche alla struttura del database. |
| `netlify.toml` | Configurazione di pubblicazione (quale cartella pubblicare, regole di sicurezza). **Delicato, vedi sez. 6.** |
| `docs/` | Documentazione come questa — non viene pubblicata sul sito. |

---

## 2. Dove vivono davvero i dati

Questo è il punto che genera più confusione, perché **non tutti i dati
stanno nello stesso posto**:

- **Fornitori, prodotti, raccolte, soci, ordini, messaggi** → vivono in
  **Supabase** (un database online), nelle tabelle `fornitori`,
  `prodotti`, `raccolte`, `soci`, `ordini`, `messaggi`, `config`,
  `admins`, ecc. Si modificano dalla console di Supabase (Table Editor),
  **non** da `index.html`.
- **Testi fissi delle pagine** (es. "Chi Siamo", titoli, etichette dei
  bottoni) → sono scritti **dentro** `index.html`, dentro le funzioni
  che costruiscono quella pagina (es. `renderChiSiamo`).
- **`_emb`** (vicino all'inizio di `index.html`) → è una **fotografia di
  riserva** dei dati, usata solo per far vedere subito qualcosa mentre
  l'app aspetta la risposta di Supabase (o se Supabase non risponde).
  **Non modificarlo mai per aggiungere o cambiare un prodotto**: non è
  collegato al database vero, e le modifiche lì non si vedono da
  nessuna parte di reale.

Regola pratica: se devi cambiare **un prezzo, un prodotto, un
fornitore** → vai su Supabase. Se devi cambiare **un testo fisso della
pagina, uno stile, un comportamento** → vai su `index.html`.

---

## 3. Fare una modifica di testo a mano (es. come "Chi Siamo")

1. Su GitHub, apri `public/index.html` e clicca la matita (modifica) —
   oppure clonalo sul computer e aprilo con un editor di testo qualsiasi.
2. Usa la ricerca del browser/editor per trovare il testo esatto che
   vuoi cambiare (copialo dal sito, tra virgolette, per trovarlo subito).
3. Modifica **solo il testo tra le virgolette**, senza toccare i tag
   HTML (`<h2 style="...">`) o il codice JavaScript intorno. Se cancelli
   per sbaglio una virgola o una parentesi, l'intera pagina può smettere
   di funzionare.
4. Salva, fai commit con un messaggio che spiega cosa hai cambiato, e
   pubblica (sez. 5).

---

## 4. Aggiungere o modificare fornitori/prodotti

Si fa da **Supabase**, non da `index.html`:

1. Vai sul progetto Supabase collegato all'app (Table Editor).
2. Tabella `prodotti` → nuova riga: `nome`, `prezzo`, `unita`,
   `fornitorId` (deve corrispondere all'`id` del fornitore nella tabella
   `fornitori`), `disponibile` (true/false).
3. Tabella `fornitori` → nuova riga per un nuovo fornitore: `nome`,
   `categoria`, `descrizione`, ecc.

L'app legge questi dati al volo ogni volta che si apre: non serve
pubblicare nulla, basta salvare su Supabase.

> In alternativa, dentro l'app c'è già un **pannello Admin → Fornitori /
> Prodotti** che fa la stessa cosa con un'interfaccia, senza toccare il
> database a mano: più sicuro per chi non è pratico di SQL.

---

## 5. Provare una modifica prima di pubblicarla

Prima di pubblicare, apri il file modificato direttamente nel browser
dal tuo computer (doppio click su `index.html`, o trascinalo in una
finestra del browser) e controlla che la pagina interessata si veda
bene. Il catalogo/i dati reali potrebbero non caricarsi (serve una
connessione a Supabase configurata), ma basta per controllare che non
ci siano errori di battitura che rompono la pagina.

---

## 6. Pubblicare le modifiche

Il sito **non si aggiorna da solo quando salvi**: bisogna "pubblicare".

1. Le modifiche vanno fatte sul branch di lavoro (quello che stiamo
   usando con Claude: `claude/review-sgas-freeconomy-GtDm6`), con un
   commit.
2. Il branch viene unito (**merge**) al branch principale `main` tramite
   una **Pull Request** su GitHub.
3. **Netlify è collegato al repository**: appena qualcosa arriva su
   `main`, parte da solo un nuovo deploy. Dopo pochi minuti il sito è
   aggiornato — non serve nessun comando manuale.

Nota tecnica: Netlify non pubblica `public/` direttamente, ma una
cartella generata `dist/` (identica, tranne che il codice JavaScript
viene compresso per velocità). Questo passaggio è automatico
(`npm run build:static`), non devi farlo tu: avviene sul server di
Netlify ad ogni deploy.

---

## 7. Cosa NON toccare senza essere sicuri

- **`netlify.toml`** — regole di sicurezza (CSP) e configurazione di
  pubblicazione. Un errore qui può bloccare l'intero sito o impedire il
  caricamento di immagini/video.
- **Codice di login, password, token** (cerca `loginAdmin`,
  `hashPassword`, `OTP`) — è stato messo a punto con attenzione per la
  sicurezza; una modifica incauta può esporre dati o bloccare gli accessi.
- **`_emb`** — vedi sezione 2.
- **`netlify/functions/*.mjs`** — toccano dati sensibili (password,
  token) lato server; un errore qui è meno visibile ma più rischioso di
  un errore in `index.html`.

Se non sei sicuro, la modifica più sicura in assoluto resta un cambio di
**testo tra virgolette** in `index.html` (sezione 3): non tocca logica
né sicurezza.

---

## 8. Altri documenti utili

- **Guida Admin, dentro l'app stessa** (menu Admin → Guida): spiega come
  usare il pannello giorno per giorno (prezzi, raccolte, ecc.), senza
  bisogno di toccare il codice.
- **`docs/ARCHITETTURA-APP.md`** — architettura tecnica più dettagliata,
  utile se si vuole capire a fondo come funziona l'app.
- **`PUNTO-RIPRESA.md`** — stato del progetto, problemi noti, lavori in
  sospeso.
