// ============================================================================
// auth-verify-code — Login socio via Telegram (passo 2: verifica codice)
// ----------------------------------------------------------------------------
// Riceve { tessera, code }. Verifica il codice OTP; se valido, garantisce che
// il socio abbia un account Supabase Auth collegato e restituisce un token_hash
// monouso che il client scambia con verifyOtp() per ottenere una sessione vera
// (su cui funzionano le regole RLS).
//
// Variabili d'ambiente richieste su Netlify:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const MAX_ATTEMPTS = 5;

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const hashCode = (code, tessera) =>
  crypto.createHash('sha256').update(code + '|' + tessera).digest('hex');

// Email sintetica e stabile per l'account Auth del socio (non riceve mail).
const socioEmail = (socioId) => `socio-${String(socioId).toLowerCase()}@soci.sgas-freeconomy.app`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { ok: false, error: 'Configurazione server incompleta' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const tessera = String(body.tessera || '').trim().toUpperCase();
  const code = String(body.code || '').trim();
  if (!tessera || !/^\d{6}$/.test(code)) return json(400, { ok: false, error: 'Codice non valido' });

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Recupera l'ultimo codice valido per la tessera ──────────────────────
  const { data: otp, error: oErr } = await sb
    .from('otp_codes').select('*')
    .eq('tessera', tessera).eq('consumed', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (oErr) return json(500, { ok: false, error: 'Errore database' });
  if (!otp) return json(404, { ok: false, error: 'Nessun codice attivo. Richiedine uno nuovo.' });
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return json(410, { ok: false, error: 'Codice scaduto. Richiedine uno nuovo.' });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    await sb.from('otp_codes').update({ consumed: true }).eq('id', otp.id);
    return json(429, { ok: false, error: 'Troppi tentativi. Richiedi un nuovo codice.' });
  }

  // ── Confronta il codice ─────────────────────────────────────────────────
  if (hashCode(code, tessera) !== otp.code_hash) {
    await sb.from('otp_codes').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
    const left = MAX_ATTEMPTS - (otp.attempts + 1);
    return json(401, { ok: false, error: `Codice errato (${left} tentativi rimasti)` });
  }

  // Codice corretto → consuma
  await sb.from('otp_codes').update({ consumed: true }).eq('id', otp.id);

  // ── Trova il socio ──────────────────────────────────────────────────────
  const { data: socio, error: sErr } = await sb
    .from('soci').select('id, user_id, tessera').eq('tessera', tessera).maybeSingle();
  if (sErr || !socio) return json(404, { ok: false, error: 'Socio non trovato' });

  const email = socioEmail(socio.id);

  // ── Garantisci l'esistenza dell'account Auth collegato ──────────────────
  let userId = socio.user_id;
  if (!userId) {
    // Crea l'utente Auth (email sintetica già confermata, password casuale)
    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomBytes(24).toString('hex'),
      user_metadata: { socio_id: socio.id, tessera: socio.tessera }
    });
    if (cErr || !created || !created.user) {
      // Forse esiste già: prova a recuperarlo per email
      return json(500, { ok: false, error: 'Impossibile creare la sessione' });
    }
    userId = created.user.id;
    await sb.from('soci').update({ user_id: userId }).eq('id', socio.id);
  }

  // ── Genera un magic link e restituisci il token_hash al client ──────────
  const { data: link, error: lErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  if (lErr || !link || !link.properties) {
    return json(500, { ok: false, error: 'Impossibile generare la sessione' });
  }

  return json(200, {
    ok: true,
    token_hash: link.properties.hashed_token,
    socioId: socio.id
  });
};
