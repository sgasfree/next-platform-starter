// telegram-webhook — riceve gli update del bot Telegram.
//
// Serve all'accesso "con un tap": il messaggio del codice porta un bottone
// ✅ Sono io, entra; premendolo Telegram chiama questo endpoint e noi
// marchiamo l'OTP come approvato. La pagina aperta sul telefono se ne accorge
// (auth-poll-approval) ed entra da sola, senza digitare il codice.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//                TELEGRAM_WEBHOOK_SECRET
//
// Registrazione (una tantum, vedi supabase/SETUP.md):
//   curl -F "url=https://<sito>/.netlify/functions/telegram-webhook" \
//        -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
//        https://api.telegram.org/bot<TOKEN>/setWebhook

import { hashToken, sbFetch } from '../lib/otp-session.mjs';

// A Telegram rispondiamo sempre 200: un errore ripetuto farebbe accodare e
// ritentare gli update all'infinito.
const ok = (obj = { ok: true }) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const tgCall = (bot, method, payload) =>
  fetch(`https://api.telegram.org/bot${bot}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => null);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const BOT      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const SECRET   = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!SUPA_URL || !SUPA_KEY || !BOT || !SECRET) return ok({ ok: false });

  // Solo Telegram conosce il secret_token registrato con setWebhook: senza
  // questo controllo chiunque potrebbe fingere un'approvazione.
  const headers = event.headers || {};
  const got = headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token'];
  if (got !== SECRET) return { statusCode: 401, body: 'Unauthorized' };

  let update;
  try { update = JSON.parse(event.body); } catch { return ok({ ok: false }); }

  // ── /start: risposta di cortesia con il chat id (serve all'iscrizione) ─────
  const msg = update.message;
  if (msg && typeof msg.text === 'string' && msg.text.trim().startsWith('/start')) {
    await tgCall(BOT, 'sendMessage', {
      chat_id: msg.chat.id,
      parse_mode: 'HTML',
      text: `👋 Bot <b>SGAS Freeconomy</b> attivo.\n\n` +
            `Da qui riceverai i codici di accesso all'app e gli avvisi del GAS.\n` +
            `Il tuo Chat ID è <code>${msg.chat.id}</code>: comunicalo all'amministratore ` +
            `se la tua tessera non è ancora collegata.`
    });
    return ok();
  }

  // ── Approvazione dell'accesso ─────────────────────────────────────────────
  const cb = update.callback_query;
  if (!cb || typeof cb.data !== 'string' || !cb.data.startsWith('otp:')) return ok();

  const token = cb.data.slice(4);
  const answer = (text, alert = false) =>
    tgCall(BOT, 'answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert });

  if (!token) { await answer('Richiesta non valida.'); return ok(); }

  const res = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/otp_codes?approve_hash=eq.${encodeURIComponent(hashToken(token))}&limit=1`);
  const rows = await res.json().catch(() => null);
  const otp = Array.isArray(rows) ? rows[0] : null;

  if (!otp)                                            { await answer('⚠️ Richiesta non trovata.'); return ok(); }
  if (otp.consumed)                                    { await answer('Questo accesso è già stato completato.'); return ok(); }
  if (new Date(otp.expires_at).getTime() < Date.now()) { await answer('⏱ Richiesta scaduta: richiedi un nuovo codice.'); return ok(); }
  // Può approvare solo la chat a cui è stato inviato il codice.
  if (String(otp.chat_id || '') !== String(cb.from && cb.from.id)) { await answer('⚠️ Non autorizzato.'); return ok(); }

  if (!otp.approved_at) {
    const patch = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/otp_codes?id=eq.${otp.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({ approved_at: new Date().toISOString() })
    });
    if (!patch.ok) { await answer('⚠️ Errore, riprova.'); return ok(); }
  }

  await answer('✅ Accesso confermato — torna sull\'app!');
  // Toglie il bottone: resta un messaggio chiuso, non più riutilizzabile.
  if (cb.message) {
    await tgCall(BOT, 'editMessageReplyMarkup', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] }
    });
  }
  return ok();
};
