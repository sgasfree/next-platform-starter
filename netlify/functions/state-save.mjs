// state-save — Proxy autenticato per scrivere lo stato dell'app (tabella `config`)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Scopo: la tabella `config` non deve più accettare scritture dirette con la
// anon key (pubblica). Ogni salvataggio passa da qui: la function verifica il
// chiamante (admin via email+password, oppure tesserato via tessera+cellulare)
// e scrive con la SERVICE_ROLE key, che bypassa la RLS.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STATE_TOKEN_SECRET
//
// Azioni (campo `action` nel body):
//   'token' → verifica credenziali e restituisce un token firmato (HMAC, 24h)
//   'save'  → verifica il token e fa l'upsert dello stato nella tabella config

import { pbkdf2Sync, createHmac, timingSafeEqual } from 'node:crypto';

const STATE_KEY = 'sgas_app_state';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 24 ore
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;  // 4 MB (il blob senza immagini è molto più piccolo)

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

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

// Normalizza la tessera come le altre function (ignora spazi, trattini, zeri).
const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

const normTel = s => String(s || '').replace(/[\s\-]/g, '');

// Verifica una password contro un hash "pbkdf2:<salt_hex>:<hash_hex>"
// (stessi parametri del client: PBKDF2 SHA-256, 100000 iterazioni, 32 byte).
function verifyPbkdf2(password, stored){
  if(!password || !stored || !String(stored).startsWith('pbkdf2:')) return false;
  const parts = String(stored).split(':');
  if(parts.length !== 3) return false;
  try{
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const got = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return expected.length === got.length && timingSafeEqual(expected, got);
  }catch(e){ return false; }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64urlJson = obj => b64url(JSON.stringify(obj));

function signToken(secret, payloadObj){
  const body = b64urlJson(payloadObj);
  const sig  = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return body + '.' + sig;
}

function verifyToken(secret, token){
  if(!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  // Confronto a tempo costante
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if(a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try{
    const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    if(!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}

async function readConfigState(url, key){
  const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${STATE_KEY}&select=valore`);
  if(!res.ok) return null;
  const rows = await res.json();
  if(!Array.isArray(rows) || !rows[0]) return null;
  try{ return JSON.parse(rows[0].valore); }catch(e){ return null; }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const SECRET   = (process.env.STATE_TOKEN_SECRET || '').trim();
  if(!SUPA_URL || !SUPA_KEY || !SECRET)
    return json(500, { ok:false, error:'Configurazione server incompleta' });

  if((event.body || '').length > MAX_PAYLOAD_BYTES)
    return json(413, { ok:false, error:'Payload troppo grande' });

  let body;
  try{ body = JSON.parse(event.body); }catch{ return json(400, { ok:false, error:'JSON non valido' }); }

  const action = String(body.action || '');

  // ── Azione: rilascio token ────────────────────────────────────────────────
  if(action === 'token'){
    const kind = String(body.kind || '');
    if(kind === 'admin'){
      const email = String(body.email || '').trim().toLowerCase();
      const pass  = String(body.password || '');
      if(!email || !pass) return json(400, { ok:false, error:'Credenziali mancanti' });
      const state = await readConfigState(SUPA_URL, SUPA_KEY);
      const cfg = (state && state.config) || {};
      const pairs = [
        [cfg.adminEmail,  cfg.adminPassword],
        [cfg.adminEmail2, cfg.adminPassword2],
        [cfg.adminEmail3, cfg.adminPassword3],
      ];
      const ok = pairs.some(([e,h]) => e && String(e).toLowerCase() === email && verifyPbkdf2(pass, h));
      if(!ok) return json(401, { ok:false, error:'Credenziali admin non valide' });
      return json(200, { ok:true, token: signToken(SECRET, { role:'admin', sub:email, exp: Date.now()+TOKEN_TTL_MS }) });
    }
    if(kind === 'socio'){
      const tess = normTessera(body.tessera);
      const tel  = normTel(body.cellulare);
      if(!tess || !tel) return json(400, { ok:false, error:'Credenziali mancanti' });
      // Cerca il socio via service_role e confronta tessera normalizzata + cellulare
      const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=id,tessera,cellulare`);
      if(!res.ok) return json(500, { ok:false, error:'Lettura soci fallita' });
      const soci = await res.json();
      const match = Array.isArray(soci) && soci.find(s =>
        normTessera(s.tessera) === tess && normTel(s.cellulare) === tel);
      if(!match) return json(401, { ok:false, error:'Tesserato non riconosciuto' });
      // Un admin che entra col codice Telegram si identifica qui come tesserato:
      // se la sua tessera è fra quelle admin (ADMIN_TESSERE — la stessa fonte
      // che gli apre il pannello admin al login OTP) il token vale come admin,
      // altrimenti non potrebbe usare le azioni riservate pur essendo admin.
      const adminTess = (process.env.ADMIN_TESSERE || '')
        .split(',').map(t => normTessera(t)).filter(Boolean);
      const role = adminTess.includes(normTessera(match.tessera)) ? 'admin' : 'socio';
      return json(200, { ok:true, token: signToken(SECRET, { role, sub:String(match.id), exp: Date.now()+TOKEN_TTL_MS }) });
    }
    return json(400, { ok:false, error:'kind non valido' });
  }

  // ── Azione: elenco tesserati (solo admin) ─────────────────────────────────
  // L'anagrafica soci non è nel file pubblico e la RLS blocca la lettura anon;
  // gli admin email+password (senza sessione Supabase) la ottengono qui.
  if(action === 'soci-list'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });
    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=*&order=tessera`);
    if(!res.ok) return json(502, { ok:false, error:'Lettura soci fallita' });
    const soci = await res.json().catch(()=> null);
    if(!Array.isArray(soci)) return json(502, { ok:false, error:'Risposta soci non valida' });
    return json(200, { ok:true, soci });
  }

  // ── Azione: registrazione / verifica webhook Telegram (solo admin) ────────
  // Evita all'admin di dover maneggiare a mano il bot token in un URL del
  // browser (dove finirebbe nella cronologia): token e secret restano qui sul
  // server, presi dalle env var di Netlify.
  if(action === 'telegram-setwebhook' || action === 'telegram-webhookinfo'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });

    const BOT  = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if(!BOT) return json(500, { ok:false, error:'TELEGRAM_BOT_TOKEN non configurato su Netlify' });

    // Verifica stato: utile per capire se il webhook è attivo e se Telegram
    // sta segnalando errori di consegna.
    if(action === 'telegram-webhookinfo'){
      try{
        const r = await fetch(`https://api.telegram.org/bot${BOT}/getWebhookInfo`);
        const d = await r.json().catch(()=>null);
        if(d && d.ok) return json(200, { ok:true, info:d.result });
        return json(502, { ok:false, error:(d&&d.description)||'Telegram non ha risposto correttamente' });
      }catch(e){ return json(502, { ok:false, error:'Chiamata a Telegram fallita: '+e.message }); }
    }

    const HOOK = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if(!HOOK) return json(500, { ok:false, error:'TELEGRAM_WEBHOOK_SECRET non configurato su Netlify (aggiungilo e rifai il deploy)' });

    // L'origine arriva dal client ma non ci fidiamo: deve essere https e un
    // hostname semplice, così non si può far puntare il webhook altrove.
    const site = String(body.siteUrl || '').trim().replace(/\/+$/, '');
    if(!/^https:\/\/[A-Za-z0-9.-]+$/.test(site))
      return json(400, { ok:false, error:'Indirizzo del sito non valido' });
    const hookUrl = site + '/.netlify/functions/telegram-webhook';

    try{
      const r = await fetch(`https://api.telegram.org/bot${BOT}/setWebhook`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          url: hookUrl,
          secret_token: HOOK,
          allowed_updates: ['message','callback_query']
        })
      });
      const d = await r.json().catch(()=>null);
      if(d && d.ok) return json(200, { ok:true, url:hookUrl, description:d.description || 'Webhook registrato' });
      return json(502, { ok:false, error:(d&&d.description) || 'Telegram ha rifiutato la registrazione' });
    }catch(e){ return json(502, { ok:false, error:'Chiamata a Telegram fallita: '+e.message }); }
  }

  // ── Azione: gestione credenziali admin (slot 1/2/3) ───────────────────────
  // Unico percorso autorizzato a scrivere email/password admin. Aggiorna SOLO
  // lo slot indicato, in scrittura-lettura sul valore più recente del server:
  // non passa mai dal blob "generico" (vedi protezione nell'azione 'save'),
  // quindi non rischia di essere sovrascritto o di sovrascrivere per errore
  // gli altri slot o i dati di catalogo.
  if(action === 'admin-creds'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });
    const slot = Number(body.slot);
    if(![1,2,3].includes(slot)) return json(400, { ok:false, error:'Slot non valido' });
    const email = String(body.email || '').trim().toLowerCase();
    const passwordHash = String(body.passwordHash || ''); // già hashata pbkdf2 dal client, o '' per rimuovere
    if(passwordHash && !passwordHash.startsWith('pbkdf2:'))
      return json(400, { ok:false, error:'Password non hashata' });

    const state = await readConfigState(SUPA_URL, SUPA_KEY);
    if(!state || !state.config) return json(500, { ok:false, error:'Stato remoto non disponibile' });

    const emailKey = slot===1 ? 'adminEmail' : `adminEmail${slot}`;
    const passKey  = slot===1 ? 'adminPassword' : `adminPassword${slot}`;
    state.config[emailKey] = email;
    state.config[passKey]  = passwordHash;

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/config?on_conflict=chiave`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ chiave: STATE_KEY, valore: JSON.stringify(state), updated_at: new Date().toISOString() })
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura fallita', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true });
  }

  // ── Azione: salvataggio stato ─────────────────────────────────────────────
  if(action === 'save'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(typeof body.valore !== 'string' || !body.valore)
      return json(400, { ok:false, error:'Stato mancante' });
    // Sanity: deve essere JSON valido con un oggetto config
    let parsed;
    try{ parsed = JSON.parse(body.valore); }catch{ return json(400, { ok:false, error:'Stato non valido' }); }
    if(!parsed || typeof parsed !== 'object' || !parsed.config)
      return json(400, { ok:false, error:'Stato incompleto' });

    // Blindatura credenziali admin: questo è il salvataggio "generico" (catalogo,
    // raccolte, ordini...) che ogni dispositivo invia per intero ad ogni modifica.
    // Un dispositivo con una copia locale non aggiornata (che non conosce ancora
    // le credenziali di admin 2/3, es. perché configurate da un altro dispositivo)
    // altrimenti le cancellerebbe qui sopra a ogni salvataggio — bloccando admin
    // 2/3 fuori dall'app. Le credenziali si toccano SOLO tramite l'azione
    // dedicata 'admin-creds' qui sotto: un salvataggio generico non può mai
    // svuotare un campo credenziale che sul server è già valorizzato.
    const CRED_KEYS = ['adminEmail','adminPassword','adminEmail2','adminPassword2','adminEmail3','adminPassword3'];
    const remoteState = await readConfigState(SUPA_URL, SUPA_KEY);
    const remoteCfg = (remoteState && remoteState.config) || {};
    let credsProtected = false;
    CRED_KEYS.forEach(k=>{
      if(!parsed.config[k] && remoteCfg[k]){ parsed.config[k] = remoteCfg[k]; credsProtected = true; }
    });
    const finalValore = credsProtected ? JSON.stringify(parsed) : body.valore;

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/config?on_conflict=chiave`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ chiave: STATE_KEY, valore: finalValore, updated_at: new Date().toISOString() })
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura fallita', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true });
  }

  return json(400, { ok:false, error:'Azione non valida' });
};
