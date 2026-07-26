// auth-verify-code — Login socio via Telegram (passo 2: verifica OTP)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { json, hashCode, sbFetch, issueSocioSession } from '../lib/otp-session.mjs';

const MAX_ATTEMPTS = 5;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SUPA_URL || !SUPA_KEY) return json(500, { ok: false, error: 'Configurazione server incompleta' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const tessera = String(body.tessera || '').trim().toUpperCase();
  const code    = String(body.code    || '').trim();
  if (!tessera || !/^\d{6}$/.test(code)) return json(400, { ok: false, error: 'Codice non valido' });

  // ── 1. Recupera l'ultimo OTP valido ───────────────────────────────────────
  const otpRes = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/otp_codes?tessera=eq.${encodeURIComponent(tessera)}&consumed=eq.false&order=created_at.desc&limit=1`
  );
  const otps = await otpRes.json();
  if (!Array.isArray(otps) || otps.length === 0)
    return json(404, { ok: false, error: 'Nessun codice attivo. Richiedine uno nuovo.' });
  const otp = otps[0];
  if (new Date(otp.expires_at).getTime() < Date.now())
    return json(410, { ok: false, error: 'Codice scaduto. Richiedine uno nuovo.' });
  if (otp.attempts >= MAX_ATTEMPTS) {
    await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/otp_codes?id=eq.${otp.id}`,
      { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ consumed: true }) });
    return json(429, { ok: false, error: 'Troppi tentativi. Richiedi un nuovo codice.' });
  }

  // ── 2. Confronta il codice ────────────────────────────────────────────────
  if (hashCode(code, tessera) !== otp.code_hash) {
    await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/otp_codes?id=eq.${otp.id}`,
      { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ attempts: otp.attempts + 1 }) });
    const left = MAX_ATTEMPTS - (otp.attempts + 1);
    return json(401, { ok: false, error: `Codice errato (${left} tentativi rimasti)` });
  }

  // Codice corretto → consuma
  await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/otp_codes?id=eq.${otp.id}`,
    { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ consumed: true }) });

  // ── 3. Apri la sessione Supabase del socio ────────────────────────────────
  // Stessa logica usata dall'approvazione con un tap su Telegram
  // (netlify/lib/otp-session.mjs): account Auth, magic link, promozione admin.
  const sess = await issueSocioSession(SUPA_URL, SUPA_KEY, tessera);
  if (!sess.ok) return json(sess.status || 500, { ok: false, error: sess.error });

  return json(200, { ok: true, token_hash: sess.token_hash, socioId: sess.socioId, isAdmin: sess.isAdmin });
};
