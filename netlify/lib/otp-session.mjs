// otp-session — helper condivisi dal flusso di login OTP (Telegram).
//
// Usati da: auth-request-code, auth-verify-code, auth-poll-approval,
// telegram-webhook. Solo fetch nativo + crypto (Node 18 built-in).

import { createHash, randomBytes } from 'node:crypto';

export const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

// Hash del codice OTP a 6 cifre (legato alla tessera).
export const hashCode = (code, tessera) =>
  createHash('sha256').update(code + '|' + tessera).digest('hex');

// Hash dei token opachi (approvazione via Telegram, polling del client):
// nel database ne salviamo solo l'impronta, il valore in chiaro vive nel
// messaggio Telegram e nel browser che ha richiesto il codice.
export const hashToken = t => createHash('sha256').update(String(t)).digest('hex');

export const newToken = () => randomBytes(16).toString('hex');

export const normTel = s => String(s || '').replace(/[\s\-]/g, '');

// Normalizza la tessera per il confronto: ignora spazi, trattini e zeri iniziali
// del numero. Così "SGAS 0016" = "SGAS-00016" = "SGAS00016".
export const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

// Helper: chiama la Supabase REST API con la service_role key.
export const sbFetch = (url, key, path, opts = {}) =>
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

// Tessere che devono diventare admin Supabase (tabella `admins`) automaticamente
// al login OTP. Configurabile via env ADMIN_TESSERE (lista separata da virgole),
// es. "SGAS-00015,SGAS-00001". Confronto tramite normTessera (ignora zeri/trattini).
const adminTessere = () => (process.env.ADMIN_TESSERE || '')
  .split(',')
  .map(t => normTessera(t))
  .filter(Boolean);

// Email sintetica stabile per l'account Auth del socio (mai usata per ricevere mail).
const socioEmail = id => `socio-${String(id).toLowerCase()}@soci.sgas-freeconomy.app`;

// Crea (o riusa) l'account Auth del socio e restituisce un magic link monouso.
// Condiviso fra la verifica del codice a 6 cifre e l'approvazione con un tap
// su Telegram: entrambe le strade, una volta accertata l'identità, aprono la
// stessa sessione Supabase.
//
// Ritorna { ok:true, token_hash, socioId, isAdmin } oppure { ok:false, status, error }.
export async function issueSocioSession(SUPA_URL, SUPA_KEY, tessera) {
  const socioRes = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=id,user_id,tessera`);
  const soci = await socioRes.json();
  const socio = Array.isArray(soci)
    ? soci.find(s => normTessera(s.tessera) === normTessera(tessera))
    : null;
  if (!socio) return { ok: false, status: 404, error: 'Socio non trovato' };
  const email = socioEmail(socio.id);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPA_KEY}`,
    'apikey': SUPA_KEY
  };

  // ── Garantisci l'account Auth del socio ───────────────────────────────────
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

  // ── Genera il magic link monouso ──────────────────────────────────────────
  // L'API REST di GoTrue restituisce hashed_token al livello principale
  // (la libreria supabase-js lo annida sotto "properties").
  const linkRes = await fetch(`${SUPA_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ type: 'magiclink', email })
  });
  const link = await linkRes.json().catch(() => ({}));
  const tokenHash = (link.properties && link.properties.hashed_token) || link.hashed_token;
  if (!tokenHash) return { ok: false, status: 500, error: 'Impossibile generare la sessione' };

  // ── Collega il user_id al socio se non era ancora impostato ───────────────
  if (!userId) userId = link.user_id || link.id || (link.user && link.user.id) || null;
  if (userId && userId !== socio.user_id) {
    await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?id=eq.${encodeURIComponent(socio.id)}`,
      { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ user_id: userId }) });
  }

  // ── Auto-promozione admin ─────────────────────────────────────────────────
  // Se la tessera è in ADMIN_TESSERE, garantisci la riga nella tabella `admins`
  // a OGNI login. È idempotente (upsert su PK user_id) e resiste alla
  // ricreazione dell'account Auth: il nuovo user_id viene ri-collegato qui.
  let isAdmin = false;
  if (userId && adminTessere().includes(normTessera(socio.tessera))) {
    try {
      const admRes = await sbFetch(SUPA_URL, SUPA_KEY, '/rest/v1/admins',
        { method: 'POST',
          prefer: 'resolution=merge-duplicates,return=minimal',
          body: JSON.stringify({ user_id: userId, email }) });
      isAdmin = admRes.ok;
    } catch (e) { /* non bloccare il login se l'upsert fallisce */ }
  }

  return { ok: true, token_hash: tokenHash, socioId: socio.id, isAdmin };
}
