// auth-verify-code — Login socio via Telegram (passo 2: verifica OTP)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createHash, randomBytes } from 'node:crypto';

const MAX_ATTEMPTS = 5;

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const hashCode = (code, tessera) =>
  createHash('sha256').update(code + '|' + tessera).digest('hex');

// Normalizza la tessera per il confronto: ignora spazi, trattini e zeri iniziali.
const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

// Tessere che devono diventare admin Supabase (tabella `admins`) automaticamente
// al login OTP. Configurabile via env ADMIN_TESSERE (lista separata da virgole),
// es. "SGAS-00015,SGAS-00001". Confronto tramite normTessera (ignora zeri/trattini).
const adminTessere = (process.env.ADMIN_TESSERE || '')
  .split(',')
  .map(t => normTessera(t))
  .filter(Boolean);

// Email sintetica stabile per l'account Auth del socio (mai usata per ricevere mail).
const socioEmail = id => `socio-${String(id).toLowerCase()}@soci.sgas-freeconomy.app`;

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

  // ── 3. Recupera il socio ──────────────────────────────────────────────────
  const socioRes = await sbFetch(SUPA_URL, SUPA_KEY,
    `/rest/v1/soci?select=id,user_id,tessera`
  );
  const soci = await socioRes.json();
  const socio = Array.isArray(soci)
    ? soci.find(s => normTessera(s.tessera) === normTessera(tessera))
    : null;
  if (!socio) return json(404, { ok: false, error: 'Socio non trovato' });
  const email = socioEmail(socio.id);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPA_KEY}`,
    'apikey': SUPA_KEY
  };

  // ── 4. Garantisci l'account Auth del socio ────────────────────────────────
  // Se il socio non ha ancora un user_id, prova a creare l'utente Auth.
  // Se l'email esiste già (run precedente), non è un errore: il magic link
  // qui sotto lo trova comunque per email.
  let userId = socio.user_id;
  if (!userId) {
    const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email,
        email_confirm: true,
        password: randomBytes(24).toString('hex'),
        user_metadata: { socio_id: socio.id, tessera: socio.tessera }
      })
    });
    const created = await createRes.json().catch(() => ({}));
    if (created && created.id) userId = created.id;  // altrimenti lo prendiamo dal link
  }

  // ── 5. Genera il magic link monouso ───────────────────────────────────────
  // L'API REST di GoTrue restituisce hashed_token al livello principale
  // (la libreria supabase-js lo annida sotto "properties").
  const linkRes = await fetch(`${SUPA_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ type: 'magiclink', email })
  });
  const link = await linkRes.json().catch(() => ({}));
  const tokenHash = (link.properties && link.properties.hashed_token) || link.hashed_token;
  if (!tokenHash) return json(500, { ok: false, error: 'Impossibile generare la sessione' });

  // ── 6. Collega il user_id al socio se non era ancora impostato ────────────
  if (!userId) userId = link.user_id || link.id || (link.user && link.user.id) || null;
  if (userId && userId !== socio.user_id) {
    await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?id=eq.${encodeURIComponent(socio.id)}`,
      { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ user_id: userId }) });
  }

  // ── 7. Auto-promozione admin ──────────────────────────────────────────────
  // Se la tessera è in ADMIN_TESSERE, garantisci la riga nella tabella `admins`
  // a OGNI login. È idempotente (upsert su PK user_id) e resiste alla
  // ricreazione dell'account Auth: il nuovo user_id viene ri-collegato qui.
  if (userId && adminTessere.includes(normTessera(socio.tessera))) {
    let isAdmin = false;
    try {
      const admRes = await sbFetch(SUPA_URL, SUPA_KEY, '/rest/v1/admins',
        { method: 'POST',
          prefer: 'resolution=merge-duplicates,return=minimal',
          body: JSON.stringify({ user_id: userId, email }) });
      isAdmin = admRes.ok;
    } catch (e) { /* non bloccare il login se l'upsert fallisce */ }
    return json(200, { ok: true, token_hash: tokenHash, socioId: socio.id, isAdmin });
  }

  return json(200, { ok: true, token_hash: tokenHash, socioId: socio.id });
};
