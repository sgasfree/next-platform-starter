// auth-request-code — Login socio via Telegram (passo 1: invio codice OTP)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN

import { createHash, randomInt } from 'node:crypto';

const CODE_TTL_MS       = 5 * 60 * 1000;  // 5 minuti
const RESEND_COOLDOWN_MS = 30 * 1000;      // 30 s tra invii successivi

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const hashCode = (code, tessera) =>
  createHash('sha256').update(code + '|' + tessera).digest('hex');

const normTel = s => String(s || '').replace(/[\s\-]/g, '');

// Normalizza la tessera per il confronto: ignora spazi, trattini e zeri iniziali
// del numero. Così "SGAS 0016" = "SGAS-00016" = "SGAS00016".
const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

// Helper: chiama la Supabase REST API
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const BOT      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!SUPA_URL || !SUPA_KEY || !BOT) return json(500, { ok: false, error: 'Configurazione server incompleta' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const tessera   = String(body.tessera  || '').trim().toUpperCase();
  const cellulare = normTel(body.cellulare);
  if (!tessera || !cellulare) return json(400, { ok: false, error: 'Inserisci tessera e cellulare' });

  // ── 1. Trova il socio ──────────────────────────────────────────────────────
  // Confronto tollerante al formato: la tessera può essere salvata con spazio,
  // trattino o zeri diversi rispetto a quanto digitato dall'utente.
  const socioRes = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/soci?select=id,tessera,cellulare,telegram,telegram_chat_id,attivo`
  );
  const soci = await socioRes.json();
  const socio = Array.isArray(soci)
    ? soci.find(s => normTessera(s.tessera) === normTessera(tessera) && normTel(s.cellulare) === cellulare)
    : null;
  if (!socio)
    return json(404, { ok: false, error: 'Tessera o cellulare non trovati' });
  if (socio.attivo === false) return json(403, { ok: false, error: 'Tessera non attiva' });
  if (!socio.telegram_chat_id)
    return json(409, { ok: false, error: "Nessun Telegram collegato a questa tessera. Contatta l'assistenza." });

  // ── 2. Anti-spam ──────────────────────────────────────────────────────────
  const recentRes = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/otp_codes?tessera=eq.${encodeURIComponent(tessera)}&order=created_at.desc&limit=1`
  );
  const recent = await recentRes.json();
  if (Array.isArray(recent) && recent[0]) {
    const age = Date.now() - new Date(recent[0].created_at).getTime();
    if (age < RESEND_COOLDOWN_MS)
      return json(429, { ok: false, error: 'Hai appena richiesto un codice. Attendi qualche secondo.' });
  }

  // ── 3. Genera e salva il codice ────────────────────────────────────────────
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const insertRes = await sbFetch(SUPA_URL, SUPA_KEY, '/rest/v1/otp_codes', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      tessera,
      code_hash: hashCode(code, tessera),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
    })
  });
  if (!insertRes.ok) return json(500, { ok: false, error: 'Impossibile generare il codice' });

  // ── 4. Invia su Telegram ───────────────────────────────────────────────────
  const text =
    `🔐 <b>SGAS Freeconomy</b>\n\nIl tuo codice di accesso è:\n\n<b>${code}</b>\n\n` +
    `Scade tra 5 minuti. Non condividerlo con nessuno.`;
  const tgRes  = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: socio.telegram_chat_id, text, parse_mode: 'HTML' })
  });
  const tgData = await tgRes.json();
  if (!tgData.ok)
    return json(502, { ok: false, error: 'Invio Telegram fallito. Verifica di aver avviato il bot.' });

  const handle = socio.telegram ? '@' + socio.telegram : 'il tuo Telegram';
  return json(200, { ok: true, sentTo: handle, expiresInSec: CODE_TTL_MS / 1000 });
};
