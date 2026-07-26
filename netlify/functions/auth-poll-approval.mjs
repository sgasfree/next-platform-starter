// auth-poll-approval — Login socio via Telegram (variante "con un tap").
//
// La pagina che ha richiesto il codice interroga periodicamente questo
// endpoint con il pollToken ricevuto da auth-request-code. Appena il socio
// preme ✅ Sono io, entra dentro Telegram (vedi telegram-webhook), qui
// restituiamo la sessione Supabase e l'app entra da sola.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { json, hashToken, sbFetch, issueSocioSession } from '../lib/otp-session.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SUPA_URL || !SUPA_KEY) return json(500, { ok: false, error: 'Configurazione server incompleta' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const tessera   = String(body.tessera   || '').trim().toUpperCase();
  const pollToken = String(body.pollToken || '').trim();
  if (!tessera || !/^[a-f0-9]{32}$/.test(pollToken))
    return json(400, { ok: false, error: 'Richiesta non valida' });

  // Il token identifica da solo la riga: la tessera serve solo a restringere
  // la ricerca e a scegliere l'account da aprire.
  const res = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/otp_codes?tessera=eq.${encodeURIComponent(tessera)}` +
    `&poll_hash=eq.${encodeURIComponent(hashToken(pollToken))}&limit=1`);
  const rows = await res.json().catch(() => null);
  const otp = Array.isArray(rows) ? rows[0] : null;

  if (!otp) return json(404, { ok: false, error: 'Richiesta non trovata' });
  if (new Date(otp.expires_at).getTime() < Date.now())
    return json(410, { ok: false, error: 'Richiesta scaduta. Richiedi un nuovo codice.' });
  // Già usata (per esempio il codice è stato digitato a mano su un altro
  // dispositivo): niente sessione, ma non è un errore da mostrare.
  if (otp.consumed) return json(200, { ok: true, approved: false, done: true });
  if (!otp.approved_at) return json(200, { ok: true, approved: false });

  // Approvato su Telegram → consuma la riga e apri la sessione.
  const patch = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/otp_codes?id=eq.${otp.id}&consumed=eq.false`,
    { method: 'PATCH', prefer: 'return=representation', body: JSON.stringify({ consumed: true }) });
  const patched = await patch.json().catch(() => null);
  // Nessuna riga aggiornata = un'altra richiesta ha già consumato questo OTP.
  if (!patch.ok || !Array.isArray(patched) || patched.length === 0)
    return json(200, { ok: true, approved: false, done: true });

  const sess = await issueSocioSession(SUPA_URL, SUPA_KEY, tessera);
  if (!sess.ok) return json(sess.status || 500, { ok: false, error: sess.error });

  return json(200, {
    ok: true, approved: true,
    token_hash: sess.token_hash, socioId: sess.socioId, isAdmin: sess.isAdmin
  });
};
