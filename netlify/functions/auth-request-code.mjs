// auth-request-code — Login socio via Telegram (passo 1: invio codice OTP)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN

import { randomInt } from 'node:crypto';
import { json, hashCode, hashToken, newToken, normTel, normTessera, sbFetch }
  from '../lib/otp-session.mjs';

const CODE_TTL_MS       = 5 * 60 * 1000;  // 5 minuti
const RESEND_COOLDOWN_MS = 30 * 1000;      // 30 s tra invii successivi

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
  // Oltre al codice a 6 cifre generiamo due token opachi:
  //  · approveToken → viaggia nel bottone Telegram (callback_data). Chi lo
  //    preme conferma l'accesso senza digitare nulla.
  //  · pollToken    → resta nel browser che ha chiesto il codice: solo quella
  //    pagina può trasformare l'approvazione in una sessione.
  // Nel database salviamo solo il loro hash, come per il codice.
  const code         = String(randomInt(0, 1000000)).padStart(6, '0');
  const approveToken = newToken();
  const pollToken    = newToken();
  const insertRes = await sbFetch(SUPA_URL, SUPA_KEY, '/rest/v1/otp_codes', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      tessera,
      code_hash: hashCode(code, tessera),
      approve_hash: hashToken(approveToken),
      poll_hash: hashToken(pollToken),
      chat_id: String(socio.telegram_chat_id),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
    })
  });
  if (!insertRes.ok) return json(500, { ok: false, error: 'Impossibile generare il codice' });

  // ── 4. Invia su Telegram ───────────────────────────────────────────────────
  // Il messaggio porta con sé il bottone di conferma: un tap lì dentro fa
  // entrare la pagina che sta aspettando, senza copiare il codice a mano.
  const text =
    `🔐 <b>SGAS Freeconomy</b>\n\nStai accedendo all'app.\n` +
    `Tocca <b>✅ Sono io, entra</b> qui sotto per entrare subito,\n` +
    `oppure inserisci questo codice:\n\n<b>${code}</b>\n\n` +
    `Scade tra 5 minuti. Non condividerlo con nessuno.\n` +
    `Se non sei stato tu, ignora questo messaggio.`;
  const tgRes  = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: socio.telegram_chat_id,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '✅ Sono io, entra', callback_data: 'otp:' + approveToken }]]
      }
    })
  });
  const tgData = await tgRes.json();
  if (!tgData.ok)
    return json(502, { ok: false, error: 'Invio Telegram fallito. Verifica di aver avviato il bot.' });

  const handle = socio.telegram ? '@' + socio.telegram : 'il tuo Telegram';
  return json(200, {
    ok: true,
    sentTo: handle,
    pollToken,
    expiresInSec: CODE_TTL_MS / 1000
  });
};
