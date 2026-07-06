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
      return json(200, { ok:true, token: signToken(SECRET, { role:'socio', sub:String(match.id), exp: Date.now()+TOKEN_TTL_MS }) });
    }
    return json(400, { ok:false, error:'kind non valido' });
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

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/config?on_conflict=chiave`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ chiave: STATE_KEY, valore: body.valore, updated_at: new Date().toISOString() })
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura fallita', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true });
  }

  return json(400, { ok:false, error:'Azione non valida' });
};
