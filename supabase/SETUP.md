# Migrazione Supabase — Guida setup (Fase 1)

Questa guida elenca i passi **manuali** da fare nel pannello Supabase e Netlify.
Una volta completati, il login dei soci via codice Telegram sarà pronto da
collegare all'app (Fase 2).

---

## 1. Crea le tabelle e le regole di accesso

1. Vai su [supabase.com](https://supabase.com) → apri il tuo progetto
2. Menu laterale → **SQL Editor** → **New query**
3. Apri il file [`supabase/schema.sql`](./schema.sql), copia **tutto** il contenuto
4. Incollalo nell'editor e premi **Run**
5. Dovresti vedere "Success" senza errori (è rieseguibile senza problemi)

Questo crea le tabelle (`soci`, `ordini`, `messaggi`, `fornitori`, …) e attiva le
regole RLS che proteggono i dati per-socio.

---

## 2. Recupera le chiavi Supabase

Nel pannello Supabase → **Project Settings → API**:

| Valore | Dove si trova | A cosa serve |
|---|---|---|
| **Project URL** | "Project URL" | identifica il progetto |
| **anon public key** | "Project API keys → anon" | usata dal browser (sicura, limitata da RLS) |
| **service_role key** | "Project API keys → service_role" | ⚠️ SEGRETA — solo lato server |

> ⚠️ La **service_role key** bypassa tutte le regole RLS. Non va MAI messa nel
> codice del browser, solo nelle variabili d'ambiente di Netlify.

---

## 3. Imposta le variabili d'ambiente su Netlify

Netlify → tuo sito → **Site configuration → Environment variables → Add a variable**.
Aggiungi queste (spunta "Contains secret values" per le chiavi):

| Key | Value | Secret |
|---|---|---|
| `SUPABASE_URL` | il Project URL | no |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role key | ✅ sì |
| `TELEGRAM_BOT_TOKEN` | (già presente) | ✅ sì |
| `TELEGRAM_WEBHOOK_SECRET` | una stringa casuale scelta da te (es. `openssl rand -hex 16`) | ✅ sì |

> La **anon key** e l'URL andranno invece nel client in Fase 2 (sono pubbliche).

---

## 3-bis. Attiva l'accesso "con un tap" (webhook Telegram)

Il messaggio con il codice contiene anche il bottone **✅ Sono io, entra**:
premendolo, il socio entra nell'app senza copiare il codice a mano. Perché
funzioni servono due passi una tantum.

**a) Aggiungi le colonne alla tabella `otp_codes`**
Supabase → **SQL Editor** → incolla ed esegui
[`supabase/migrations/2026-07-25_otp_tap_approval.sql`](./migrations/2026-07-25_otp_tap_approval.sql).
È rieseguibile e non tocca i dati esistenti.

**b) Registra il webhook del bot** (dopo aver deployato le Functions e impostato
`TELEGRAM_WEBHOOK_SECRET`). Da un terminale, sostituendo token, dominio e secret:

```bash
curl -F "url=https://TUO-SITO.netlify.app/.netlify/functions/telegram-webhook" \
     -F "secret_token=IL_TUO_TELEGRAM_WEBHOOK_SECRET" \
     -F "allowed_updates=[\"message\",\"callback_query\"]" \
     "https://api.telegram.org/botIL_TUO_BOT_TOKEN/setWebhook"
```

Risposta attesa: `{"ok":true,"result":true,"description":"Webhook was set"}`.
Per controllare in seguito: `.../getWebhookInfo`; per rimuoverlo: `.../deleteWebhook`.

> Il `secret_token` viaggia in un header su ogni chiamata: la Function scarta
> tutto ciò che non lo presenta, così nessuno può fingere un'approvazione.
> Finché il webhook non è registrato l'app resta pienamente utilizzabile: il
> bottone semplicemente non fa nulla e si entra con il codice a 6 cifre.

---

## 4. Importa i soci nel database

Perché il login funzioni, i soci devono esistere nella tabella `soci` con il loro
`telegram_chat_id`. In Fase 3 faremo l'import automatico dall'app; per testare ora
puoi inserirne uno a mano dal **SQL Editor**:

```sql
insert into public.soci (id, tessera, nome, cognome, cellulare, telegram, telegram_chat_id)
values ('s0001', 'SGAS 0001', 'Nome', 'Cognome', '3470000000', 'tuo_username', '123456789')
on conflict (id) do update set
  tessera = excluded.tessera,
  cellulare = excluded.cellulare,
  telegram_chat_id = excluded.telegram_chat_id;
```

> Il `telegram_chat_id` di ogni socio si ottiene scrivendo a **@userinfobot** su
> Telegram, oppure è già presente nei dati dell'app (campo `telegramChatId`).

**Importante:** ogni socio deve aver avviato il bot almeno una volta (premuto
**Start**), altrimenti Telegram non può inviargli messaggi.

---

## 5. Designa gli admin

Gli admin sono utenti Supabase Auth presenti nella tabella `admins`. Creeremo il
flusso completo più avanti; per ora basta sapere che la regola `is_admin()`
controlla questa tabella.

---

## Stato del flusso di login (Fase 1)

```
Socio inserisce tessera + cellulare
        │
        ▼
[auth-request-code]  ── verifica socio ──▶ genera OTP + token ──▶ invia su Telegram
        │                                                        (codice + bottone)
        ├───────────────────────────┬────────────────────────────┐
        ▼                           ▼                            │
Socio digita il codice      Socio tocca "✅ Sono io, entra"       │
        │                           │                            │
        ▼                           ▼                            │
[auth-verify-code]          [telegram-webhook] ── segna approvato │
        │                           │                            │
        │                           ▼                            │
        │                   [auth-poll-approval] ◀── la pagina interroga ogni 3 s
        │                           │
        └───────────┬───────────────┘
                    ▼
     crea/collega account Auth ──▶ token_hash
                    │
                    ▼
Client: supabase.auth.verifyOtp({type:'magiclink', token_hash}) ──▶ sessione RLS
```

Quando hai completato i passi 1–3, dimmelo e collego il flusso all'app (Fase 2).
