// promemoria-scadenze — avviso Telegram automatico a 90 e 30 giorni dalla
// scadenza della tessera.
//
// Gira una volta al giorno come Netlify Scheduled Function (orario e
// frequenza in netlify.toml, non qui). Non riceve nessuna richiesta HTTP da
// un utente: legge i soci con la service_role e scrive direttamente
// all'API di Telegram, come già fa state-save.mjs per le notifiche interne
// (notify-admins, recupero password). Per questo NON passa da telegram.mjs:
// quella function pretende un token di sessione firmato da un login, che
// qui non esiste — non c'è nessuno collegato, è il server che agisce da
// solo.
//
// Stessa logica del semaforo tessera nel pannello (_renderProfiloBody):
// giorni alla scadenza = differenza in giorni fra oggi e la data di
// scadenza, entrambe a mezzanotte. "Oggi" è calcolato nel fuso Europe/Rome
// e non in quello del server, che su Netlify è quasi sempre UTC — altrimenti
// un avviso "a 30 giorni esatti" potrebbe scattare un giorno prima o dopo
// a seconda di dove gira la funzione quella settimana.
//
// Anti-doppio-invio: gli avvisi scattano su un giorno ESATTO (90 o 30), non
// su una finestra, quindi un solo giorno di calendario è a rischio — ma se
// la funzione viene rilanciata due volte nello stesso giorno (un retry di
// Netlify, un test manuale) manderebbe comunque il messaggio due volte.
// Per evitarlo teniamo in `config` un piccolo registro di chi è già stato
// avvisato OGGI, e lo saltiamo alla seconda esecuzione.
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

function testoPromemoria(socio, giorni, scadenzaFmt){
  const nome = socio.nome ? `Ciao ${socio.nome},` : 'Ciao,';
  if(giorni === 90){
    return `🪪 <b>Promemoria tessera SGAS</b>\n\n${nome} la tua tessera <b>${socio.tessera}</b> scade tra <b>90 giorni</b>, il ${scadenzaFmt}.\n\nNessuna azione richiesta ora — è solo un promemoria.`;
  }
  return `🪪 <b>Promemoria tessera SGAS</b>\n\n${nome} la tua tessera <b>${socio.tessera}</b> scade tra <b>30 giorni</b>, il ${scadenzaFmt}.\n\nSe vuoi rinnovarla, contatta chi amministra il gruppo.`;
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
  const giaInviati = new Set(stato.inviati);

  const daInviare = [];
  for(const s of soci){
    const chatId = String(s.telegram_chat_id || '').trim();
    if(!chatId) continue; // nessun Telegram collegato: non c'è dove mandarlo
    const giorni = giorniAllaScadenza(s.scadenza, oggi);
    if(giorni === null || !SOGLIE.includes(giorni)) continue;
    const chiave = `${s.id}:${giorni}`;
    if(giaInviati.has(chiave)) continue; // già mandato oggi (rilancio della funzione)
    daInviare.push({ socio: s, chatId, giorni, chiave });
  }

  // Anche qui una riga esplicita, non solo il ritorno: senza, un'esecuzione
  // regolare che semplicemente non trova nessuno a 90/30 giorni lascia nel
  // pannello Netlify solo la riga automatica di durata/memoria — indistingui-
  // bile a colpo d'occhio da un'esecuzione fallita prima di arrivare qui.
  if(!daInviare.length){
    console.log(`promemoria-scadenze: nessun tesserato a 90/30 giorni oggi (${oggiStr})`);
    return { statusCode: 200, body: 'nessun avviso da mandare oggi' };
  }

  const esiti = await Promise.all(daInviare.map(({ socio, chatId, giorni }) => {
    const scadenzaFmt = new Date(socio.scadenza).toLocaleDateString('it-IT', { timeZone: 'UTC' });
    return fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testoPromemoria(socio, giorni, scadenzaFmt),
        parse_mode: 'HTML'
      })
    }).then(r => r.json()).catch(e => ({ ok: false, description: String(e) }));
  }));

  // Registra come inviati SOLO quelli riusciti: un fallimento di rete non
  // deve far sparire il promemoria di domani, deve solo far riprovare oggi
  // stesso se la funzione viene rilanciata.
  daInviare.forEach((item, i) => { if(esiti[i] && esiti[i].ok) giaInviati.add(item.chiave); });
  await scriviStatoOggi(SUPA_URL, SUPA_KEY, { giorno: oggiStr, inviati: [...giaInviati] });

  const riusciti = esiti.filter(e => e && e.ok).length;
  console.log(`promemoria-scadenze: ${riusciti}/${daInviare.length} avvisi inviati (${oggiStr})`);
  return { statusCode: 200, body: `${riusciti}/${daInviare.length} inviati` };
};
