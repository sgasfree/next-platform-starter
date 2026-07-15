# 📍 Punto di ripristino — SGAS Freeconomy

_Snapshot al **15 luglio 2026** · branch `claude/review-sgas-freeconomy-GtDm6` · tutto mergiato su `main`_

---

## ✅ STATO ATTUALE — pronto per l'apertura ai tesserati

Tutte le PR di questa fase (#82 → #94) sono **mergiate su `main`**. L'app è funzionante,
con sicurezza pre-lancio chiusa, export ordini completi, e PWA installabile.

### Configurazioni manuali GIÀ FATTE (dall'utente)
- ✅ **Token bot Telegram** rigenerato con @BotFather e aggiornato su Netlify (`TELEGRAM_BOT_TOKEN`)
- ✅ **`STATE_TOKEN_SECRET`** impostato su Netlify (scope Builds/Functions/Runtime, tutti i contesti)
- ✅ **Migrazione SQL** `lock_config_writes.sql` eseguita su Supabase → scritture `config` bloccate agli anonimi
- ✅ **Password Admin 2** reimpostata (la vecchia era pubblica → compromessa)

> ⚠️ Se in futuro si rigenera l'app con "Genera App per Netlify", il codice ora
> rimuove automaticamente segreti e password in chiaro dal file esportato.

---

## 📦 LAVORO SVOLTO (PR #82–#94, tutte merged)

### 🔒 Sicurezza (pre-lancio, completata)
| PR | Cosa |
|----|------|
| #88 | Rimossi dal file pubblico: password Admin 2 in chiaro, token bot, anagrafica soci; fix export che re-incorporava i segreti |
| #89 | **Proxy autenticato** `netlify/functions/state-save.js` per le scritture `config` (verifica admin/tesserato, scrive con service_role) + migrazione SQL |
| #91 | Azione `soci-list` nel proxy: admin email+password leggono i tesserati senza esporli nel file |
| — | Migrazione `supabase/migrations/2026-07-05_lock_config_writes.sql` (eseguita) |

**Verificato**: i segreti veri (service_role, bot token) NON sono nel sorgente; auth dati
protetta lato server (OTP + RLS + proxy); input escapati (no XSS); resta solo il gate
admin lato client + hash pbkdf2 incorporato (rischio moderato — hardening futuro opzionale).

### 🧾 Export ordini (tutti i formati allineati)
| PR | Cosa |
|----|------|
| #82 | CSV: **virgola** decimale, colonna TOTALE corretta, numeri allineati a destra |
| #92/#93 | CSV singolo ordine allineato agli altri; ordini mostrano sempre la **tessera** (mai l'uid) |
| #93 | CSV: **riepilogo cumulato per prodotto** (dettaglio per tesserato + totali da ordinare) |
| #93 | Word: **virgola** decimale come i CSV |

**8 export** (3 CSV + 4 Word + wrapper) verificati: virgola, tessera, codice, cumulo dove serve.

### 📱 Mobile
| PR | Cosa |
|----|------|
| #90 | Libreria Word (docx.js, 725 KB) estratta in `public/docx-lib.js`, caricata solo al primo export → index.html −24% |
| #94 | **PWA**: `manifest.json` + `sw.js` + icone → installabile in home + catalogo offline |

### 🐛 Fix vari
| PR | Cosa |
|----|------|
| #92 | Vetrina servizi: conta/mostra tutti i prodotti come il catalogo (fix "0 prodotti") |
| #94 | Ricerca: azzerata al cambio categoria (fix "categoria vuota dopo una ricerca") |
| #86 | Fornitori duplicati (Tombea/whyfarm) rimossi + etichetta categoria admin |
| #87 | Fix realtime che annullava i cambi password con 3 admin + rimosso OneSignal morto |

---

## 🔜 BACKLOG — cosa resta (tutto opzionale, l'app è già operativa)

### Sicurezza (minori)
- **EmailJS**: attivare la restrizione per dominio nel pannello EmailJS (invii solo dal sito ufficiale).
- **Scrittura concorrente admin** (last-write-wins): valutare avviso quando due admin editano la stessa sezione. Priorità in base all'uso reale.
- **Hardening auth admin**: spostare tutto il login admin sul server (la function verifica già la password; si tratta di emettere il token di sessione admin lato server). Contenuto ma non banale. I dati sono già protetti, quindi bassa urgenza.

### Mobile (rifiniture)
- **Tabelle admin a schede** su schermo piccolo (tesserati/ordini/prodotti).
- **Breakpoint intermedio tablet** (tra 700px e 1024px oggi è desktop pieno).

### Qualità
- **Test automatizzati** su percorsi critici (ordini, export, auth): committare una piccola suite headless (riuso quella usata a mano finora).
- **Modularizzare il frontend** (oggi monolite in un file): refactor grosso e rischioso su un'app in produzione → per ultimo.

---

## 🧠 Note tecniche per ripartire

- **File**: `public/index.html` (~8.000 righe dopo l'estrazione docx) + `public/docx-lib.js` (libreria Word).
- **Stato `_emb`** (riga 9): blob JSON iniziale. `_embVer` triggera merge/aggiornamento.
- **Flusso dati**: `_emb` → localStorage → `loadState()` → `initSupabase()` → `loadFromSupabase()`.
- **Scritture `config`**: passano dal proxy `state-save` (token firmato al login) con fallback anon solo se il proxy è irraggiungibile; la RLS ora blocca le scritture anon dirette.
- **Segreti veri**: solo nelle env di Netlify (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `STATE_TOKEN_SECRET`), usati dalle Netlify Functions in `netlify/functions/`.
- **Login tesserati**: OTP a 6 cifre via Telegram (server-side) → sessione Supabase con RLS. Metodo legacy tessera+cellulare come riserva.
- **Login admin**: email+password (verifica client) OPPURE OTP Telegram (per le tessere in `ADMIN_TESSERE`).
- **PWA**: `manifest.json` + `sw.js` (network-first HTML, cache-first asset, no intercept di Supabase/Functions). Icone `icon-192/512/maskable-512.png`.
- **Test**: server statico locale + Chromium headless in
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
  (usato per verificare ogni modifica di questa sessione).
- **Deploy**: Netlify collegato al repo → auto-deploy al merge su `main`.

---

## ▶️ Come ripartire la prossima volta
1. L'app è **operativa e sicura**: si può aprire ai tesserati.
2. Per nuovi lavori, partire da un elemento del **Backlog** sopra.
3. Ogni modifica: sviluppo su `claude/review-sgas-freeconomy-GtDm6`, verifica headless, commit, push, PR.
