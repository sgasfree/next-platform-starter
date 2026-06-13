// ============================================================================
// auth-request-code — Login socio via Telegram (passo 1: invio codice)
// ----------------------------------------------------------------------------
// Riceve { tessera, cellulare }, verifica il socio sul database, genera un
// codice OTP a 6 cifre, lo salva (hashato) in otp_codes e lo invia sul Telegram
// del socio tramite il bot. Non rivela mai il codice nella risposta.
//
// Variabili d'ambiente richieste su Netlify:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
// ============================================================================
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const CODE_TTL_MS = 5 * 60 * 1000;   // il codice scade dopo 5 minuti
const RESEND_COOLDOWN_MS = 30 * 1000; // minimo 30s tra due invii

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const hashCode = (code, tessera) =>
  crypto.createHash('sha256').update(code + '|' + tessera).digest('hex');

const normTel = (s) => String(s || '').replace(/[\s\-]/g, '');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !key || !botToken) {
    return json(500, { ok: false, error: 'Configurazione server incompleta' });
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const tessera = String(body.tessera || '').trim().toUpperCase();
  const cellulare = normTel(body.cellulare);
  if (!tessera || !cellulare) return json(400, { ok: false, error: 'Inserisci tessera e cellulare' });

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Trova il socio per tessera + cellulare ──────────────────────────────
  const { data: socio, error: sErr } = await sb
    .from('soci').select('id, tessera, cellulare, telegram, telegram_chat_id, attivo')
    .eq('tessera', tessera).maybeSingle();

  if (sErr) return json(500, { ok: false, error: 'Errore database' });
  if (!socio || normTel(socio.cellulare) !== cellulare) {
    return json(404, { ok: false, error: 'Tessera o cellulare non trovati' });
  }
  if (socio.attivo === false) return json(403, { ok: false, error: 'Tessera non attiva' });
  if (!socio.telegram_chat_id) {
    return json(409, { ok: false, error: 'Nessun Telegram collegato a questa tessera. Contatta l\'assistenza.' });
  }

  // ── Anti-spam: blocca un nuovo invio se uno è appena partito ────────────
  const { data: recent } = await sb
    .from('otp_codes').select('created_at')
    .eq('tessera', tessera).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return json(429, { ok: false, error: 'Hai appena richiesto un codice. Attendi qualche secondo.' });
  }

  // ── Genera e salva il codice ────────────────────────────────────────────
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const { error: iErr } = await sb.from('otp_codes').insert({
    tessera,
    code_hash: hashCode(code, tessera),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
  });
  if (iErr) return json(500, { ok: false, error: 'Impossibile generare il codice' });

  // ── Invia su Telegram ───────────────────────────────────────────────────
  const text =
    `🔐 <b>SGAS Freeconomy</b>\n\nIl tuo codice di accesso è:\n\n<b>${code}</b>\n\n` +
    `Scade tra 5 minuti. Non condividerlo con nessuno.`;
  try {
    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: socio.telegram_chat_id, text, parse_mode: 'HTML' })
    });
    const tgData = await tg.json();
    if (!tgData.ok) return json(502, { ok: false, error: 'Invio Telegram fallito. Verifica di aver avviato il bot.' });
  } catch {
    return json(502, { ok: false, error: 'Invio Telegram non riuscito' });
  }

  const handle = socio.telegram ? '@' + socio.telegram : 'il tuo Telegram';
  return json(200, { ok: true, sentTo: handle, expiresInSec: CODE_TTL_MS / 1000 });
};
