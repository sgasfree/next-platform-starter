// telegram — Invio messaggi tramite il bot, con destinatari verificati.
//
// Il bot token vive solo qui (env var), mai nel browser. Senza controlli però
// questa function sarebbe un relay aperto: chiunque conoscesse l'indirizzo
// potrebbe far scrivere al bot del GAS un messaggio qualsiasi a un
// destinatario qualsiasi — indistinguibile, per un tesserato, da una notifica
// legittima. Da qui le due regole sotto.
//
// Regole di accesso:
//   • Chat ID degli admin (letti dalla configurazione lato server):
//     ammessi anche senza token. Serve al recupero password, che parte quando
//     nessuno è ancora autenticato.
//   • Token di un admin: destinatario libero. Serve al pulsante "Test" delle
//     impostazioni, che verifica un Chat ID prima di salvarlo.
//   • Token di un tesserato: solo verso un chat ID già registrato.
//   • Qualsiasi altro destinatario: rifiutato.
//
// Env richieste: TELEGRAM_BOT_TOKEN, SUPABASE_URL,
//                SUPABASE_SERVICE_ROLE_KEY, STATE_TOKEN_SECRET

import { createHmac, timingSafeEqual } from 'node:crypto';

const STATE_KEY = 'sgas_app_state';

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const sbFetch = (url, key, path) =>
  fetch(`${url}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key
    }
  });

// Stessa verifica di state-save.mjs: HMAC-SHA256 su payload base64url + scadenza.
function verifyToken(secret, token){
  if(!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if(a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try{
    const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    if(!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}

const normChat = v => String(v == null ? '' : v).trim();

// Chat ID dei tre admin, dalla configurazione salvata su Supabase.
async function adminChatIds(url, key){
  try{
    const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${STATE_KEY}&select=valore`);
    if(!res.ok) return [];
    const rows = await res.json();
    if(!Array.isArray(rows) || !rows[0]) return [];
    const conf = (JSON.parse(rows[0].valore) || {}).config || {};
    return [conf.tgAdminChatId, conf.tgAdminChatId2, conf.tgAdminChatId3]
      .map(normChat).filter(Boolean);
  }catch(e){ return []; }
}

// Chat ID registrati dei tesserati.
async function socioChatIds(url, key){
  try{
    const res = await sbFetch(url, key, '/rest/v1/soci?select=telegram_chat_id');
    if(!res.ok) return [];
    const rows = await res.json();
    if(!Array.isArray(rows)) return [];
    return rows.map(r => normChat(r && r.telegram_chat_id)).filter(Boolean);
  }catch(e){ return []; }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const BOT      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const SECRET   = (process.env.STATE_TOKEN_SECRET || '').trim();
  if (!BOT) {
    return json(500, { ok: false, description: 'Bot token not configured on server' });
  }
  if (!SUPA_URL || !SUPA_KEY || !SECRET) {
    return json(500, { ok: false, description: 'Configurazione server incompleta' });
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return json(400, { ok: false, description: 'Invalid JSON' });
  }

  const { chat_id, text, parse_mode, token } = body;
  if (!chat_id || !text) {
    return json(400, { ok: false, description: 'Missing chat_id or text' });
  }

  // Serve SEMPRE un token valido. Prima i chat ID degli admin erano ammessi
  // anche senza: serviva al recupero password, che parte da non autenticati.
  // Quel flusso però ora invia da solo (state-save chiama Telegram
  // direttamente), mentre l'eccezione restava aperta — e i chat ID degli admin
  // sono nel blob a lettura pubblica. Chiunque poteva quindi far scrivere al
  // bot ufficiale del GAS un messaggio a piacere agli amministratori:
  // indistinguibile, per chi lo riceve, da un avviso legittimo (per esempio un
  // finto "codice di reset").
  const payload = verifyToken(SECRET, token);
  if (!payload) {
    return json(401, { ok: false, description: 'Non autorizzato' });
  }

  // Il destinatario deve essere qualcuno che il GAS conosce già.
  const target = normChat(chat_id);
  // Un admin autenticato può scrivere a chiunque (serve al pulsante "Test",
  // che prova un Chat ID non ancora salvato). Un tesserato no: può raggiungere
  // solo gli admin o un destinatario già registrato.
  let consentito = payload.role === 'admin';
  if (!consentito) {
    const admins = await adminChatIds(SUPA_URL, SUPA_KEY);
    consentito = admins.includes(target)
      || (await socioChatIds(SUPA_URL, SUPA_KEY)).includes(target);
  }

  if (!consentito) {
    return json(403, { ok: false, description: 'Destinatario non riconosciuto' });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: parse_mode || 'HTML' })
    });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return json(502, { ok: false, description: e.message });
  }
};
