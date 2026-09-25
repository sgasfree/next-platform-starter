// promemoria-scadenze — avviso automatico a 90 e 30 giorni dalla scadenza
// della tessera, su due canali indipendenti: Telegram e messaggistica
// interna dell'app.
//
// Gira una volta al giorno come Netlify Scheduled Function (orario e
// frequenza in netlify.toml, non qui). Non riceve nessuna richiesta HTTP da
// un utente: legge i soci con la service_role e scrive direttamente
// all'API di Telegram e alla tabella `messaggi`, come già fa state-save.mjs
// per le notifiche interne (notify-admins, recupero password). Per questo
// NON passa da telegram.mjs: quella function pretende un token di sessione
// firmato da un login, che qui non esiste — non c'è nessuno collegato, è il
// server che agisce da solo.
//
// Stessa logica del semaforo tessera nel pannello (_renderProfiloBody):
// giorni alla scadenza = differenza in giorni fra oggi e la data di
// scadenza, entrambe a mezzanotte. "Oggi" è calcolato nel fuso Europe/Rome
// e non in quello del server, che su Netlify è quasi sempre UTC — altrimenti
// un avviso "a 30 giorni esatti" potrebbe scattare un giorno prima o dopo
// a seconda di dove gira la funzione quella settimana.
//
// Il messaggio interno raggiunge TUTTI i tesserati attivi con una scadenza
// in finestra, anche chi non ha Telegram collegato — è l'unico avviso che
// riceverebbero, altrimenti nessuno. Il Telegram resta riservato a chi ha
// il chat ID registrato.
//
// Anti-doppio-invio: gli avvisi scattano su un giorno ESATTO (90 o 30), non
// su una finestra, quindi un solo giorno di calendario è a rischio — ma se
// la funzione viene rilanciata due volte nello stesso giorno (un retry di
// Netlify, un test manuale) manderebbe comunque il messaggio due volte.
// Per evitarlo teniamo in `config` un registro di chi è già stato avvisato
// OGGI — un ingresso per canale, non uno per socio: se il Telegram va a
// buon fine ma l'inserimento del messaggio interno fallisce (o viceversa),
// un rilancio riprova solo il canale mancante, senza duplicare quello
// riuscito.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN

const STATO_KEY = 'promemoria_scadenze_stato';
const SOGLIE = [90, 30]; // giorni alla scadenza per cui scatta l'avviso

const sbFetch = (url, key, path, opts = {}) =>
  fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Prefer': opts.prefer || '',
      ...opts.headers
    }
  });

// Data di oggi, a mezzanotte, nel fuso Europe/Rome — non quello del server.
function oggiRoma(){
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()); // 'YYYY-MM-DD'
  return new Date(iso); // mezzanotte UTC di quel giorno di calendario
}

// `scadenza` è salvata come testo 'YYYY-MM-DD' (vedi schema.sql): la stessa
// forma ISO-date-only che JS interpreta già come mezzanotte UTC, quindi si
// confronta direttamente con oggiRoma() senza altre conversioni.
function giorniAllaScadenza(scadenzaStr, oggi){
  if(!scadenzaStr) return null;
  const scad = new Date(scadenzaStr);
  if(isNaN(scad.getTime())) return null;
  return Math.round((scad - oggi) / 86400000);
}

async function leggiStatoOggi(url, key, oggiStr){
  const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${STATO_KEY}&select=valore`);
  if(!res.ok) return { giorno: oggiStr, inviati: [] };
  const rows = await res.json().catch(() => null);
  if(!Array.isArray(rows) || !rows[0]) return { giorno: oggiStr, inviati: [] };
  try{
    const stato = JSON.parse(rows[0].valore);
    // Un registro di un altro giorno non conta: si riparte da zero.
    if(!stato || stato.giorno !== oggiStr) return { giorno: oggiStr, inviati: [] };
    return { giorno: oggiStr, inviati: Array.isArray(stato.inviati) ? stato.inviati : [] };
  }catch(e){ return { giorno: oggiStr, inviati: [] }; }
}

const scriviStatoOggi = (url, key, stato) =>
  sbFetch(url, key, `/rest/v1/config?on_conflict=chiave`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({
      chiave: STATO_KEY,
      valore: JSON.stringify(stato),
      updated_at: new Date().toISOString()
    })
  });

// Testo per Telegram: parse_mode HTML, quindi il grassetto è markup vero.
function testoTelegram(socio, giorni, scadenzaFmt){
  const nome = socio.nome ? `Ciao ${socio.nome},` : 'Ciao,';
  if(giorni === 90){
    return `🪪 <b>Promemoria tessera SGAS</b>\n\n${nome} la tua tessera <b>${socio.tessera}</b> scade tra <b>90 giorni</b>, il ${scadenzaFmt}.\n\nNessuna azione richiesta ora — è solo un promemoria.`;
  }
  return `🪪 <b>Promemoria tessera SGAS</b>\n\n${nome} la tua tessera <b>${socio.tessera}</b> scade tra <b>30 giorni</b>, il ${scadenzaFmt}.\n\nSe vuoi rinnovarla, contatta chi amministra il gruppo.`;
}

// Testo per la messaggistica interna: la bolla mostra il testo in chiaro
// (escHtml lato client), quindi niente tag — stesso contenuto, senza markup.
function testoInterno(socio, giorni, scadenzaFmt){
  const nome = socio.nome ? `Ciao ${socio.nome},` : 'Ciao,';
  if(giorni === 90){
    return `🪪 Promemoria tessera SGAS\n\n${nome} la tua tessera ${socio.tessera} scade tra 90 giorni, il ${scadenzaFmt}.\n\nNessuna azione richiesta ora — è solo un promemoria.`;
  }
  return `🪪 Promemoria tessera SGAS\n\n${nome} la tua tessera ${socio.tessera} scade tra 30 giorni, il ${scadenzaFmt}.\n\nSe vuoi rinnovarla, contatta chi amministra il gruppo.`;
}

export const handler = async () => {
  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const BOT      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if(!SUPA_URL || !SUPA_KEY || !BOT){
    console.error('promemoria-scadenze: configurazione server incompleta (env mancanti)');
    return { statusCode: 200, body: 'config incompleta' }; // non far fallire rumorosamente il cron
  }

  const oggi = oggiRoma();
  const oggiStr = oggi.toISOString().slice(0, 10);

  const res = await sbFetch(SUPA_URL, SUPA_KEY,
    '/rest/v1/soci?select=id,nome,cognome,tessera,scadenza,telegram_chat_id,attivo&attivo=eq.true');
  if(!res.ok){
    console.error('promemoria-scadenze: lettura soci fallita', res.status);
    return { statusCode: 200, body: 'lettura soci fallita' };
  }
  const soci = await res.json().catch(() => null);
  if(!Array.isArray(soci)) return { statusCode: 200, body: 'risposta soci non valida' };

  const stato = await leggiStatoOggi(SUPA_URL, SUPA_KEY, oggiStr);
  const giaFatti = new Set(stato.inviati);

  // Un candidato per ogni socio in finestra (90 o 30 giorni), a prescindere
  // dal Telegram: il messaggio interno vale per tutti. Chi ha già ricevuto
  // ENTRAMBI i canali oggi (rilancio della funzione) non genera nulla.
  const candidati = [];
  for(const s of soci){
    const giorni = giorniAllaScadenza(s.scadenza, oggi);
    if(giorni === null || !SOGLIE.includes(giorni)) continue;
    const chatId = String(s.telegram_chat_id || '').trim();
    const chiaveTg  = `${s.id}:${giorni}:tg`;
    const chiaveMsg = `${s.id}:${giorni}:msg`;
    const serveTg  = chatId && !giaFatti.has(chiaveTg);
    const serveMsg = !giaFatti.has(chiaveMsg);
    if(!serveTg && !serveMsg) continue;
    candidati.push({ socio: s, giorni, chatId, serveTg, serveMsg, chiaveTg, chiaveMsg });
  }

  // Riga esplicita anche qui, non solo il ritorno: senza, un'esecuzione
  // regolare che semplicemente non trova nessuno in finestra lascia nel
  // pannello Netlify solo la riga automatica di durata/memoria — indistingui-
  // bile a colpo d'occhio da un'esecuzione fallita prima di arrivare qui.
  if(!candidati.length){
    console.log(`promemoria-scadenze: nessun tesserato a 90/30 giorni oggi (${oggiStr})`);
    return { statusCode: 200, body: 'nessun avviso da mandare oggi' };
  }

  // ── Canale Telegram ────────────────────────────────────────────────────
  const daTg = candidati.filter(c => c.serveTg);
  const esitiTg = await Promise.all(daTg.map(({ socio, giorni }) => {
    const scadenzaFmt = new Date(socio.scadenza).toLocaleDateString('it-IT', { timeZone: 'UTC' });
    return fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(socio.telegram_chat_id).trim(),
        text: testoTelegram(socio, giorni, scadenzaFmt),
        parse_mode: 'HTML'
      })
    }).then(r => r.json()).catch(e => ({ ok: false, description: String(e) }));
  }));
  daTg.forEach((c, i) => { if(esitiTg[i] && esitiTg[i].ok) giaFatti.add(c.chiaveTg); });

  // ── Canale messaggistica interna ───────────────────────────────────────
  // Un unico insert multiplo invece di N chiamate separate: la tabella non
  // ha vincoli che richiedano un ordine, e un batch fallisce o riesce
  // insieme — qui va bene, perché il registro segna "riuscito" solo se
  // l'intero batch è passato (vedi sotto).
  const daMsg = candidati.filter(c => c.serveMsg);
  let msgOk = false;
  if(daMsg.length){
    const righe = daMsg.map(({ socio, giorni }) => ({
      socio_id:   socio.id,
      mittente:   'admin',
      testo:      testoInterno(socio, giorni,
                    new Date(socio.scadenza).toLocaleDateString('it-IT', { timeZone: 'UTC' })),
      letto:      false
    }));
    const resMsg = await sbFetch(SUPA_URL, SUPA_KEY, '/rest/v1/messaggi', {
      method: 'POST', prefer: 'return=minimal', body: JSON.stringify(righe)
    });
    msgOk = resMsg.ok;
    if(!resMsg.ok) console.error('promemoria-scadenze: insert messaggi interni fallito', resMsg.status);
  }
  if(msgOk) daMsg.forEach(c => giaFatti.add(c.chiaveMsg));

  await scriviStatoOggi(SUPA_URL, SUPA_KEY, { giorno: oggiStr, inviati: [...giaFatti] });

  const tgRiusciti = esitiTg.filter(e => e && e.ok).length;
  console.log(`promemoria-scadenze: Telegram ${tgRiusciti}/${daTg.length}, interni ${msgOk ? daMsg.length : 0}/${daMsg.length} (${oggiStr})`);
  return { statusCode: 200, body: `tg ${tgRiusciti}/${daTg.length}, interni ${msgOk ? daMsg.length : 0}/${daMsg.length}` };
};
