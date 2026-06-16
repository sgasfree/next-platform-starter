// auth-recover-tessera — Verifica identità socio (tessera + cellulare + nome)
// per il flusso "Recupera credenziali", senza esporre l'elenco soci al client.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const normTel = s => String(s || '').replace(/[\s\-]/g, '');

// Normalizza la tessera per il confronto: ignora spazi, trattini e zeri iniziali
// del numero. Così "SGAS 0016" = "SGAS-00016" = "SGAS00016".
const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

const sbFetch = (url, key, path) =>
  fetch(`${url}${path}`, {
    headers: { 'Authorization': `Bearer ${key}`, 'apikey': key }
  });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SUPA_URL || !SUPA_KEY) return json(500, { ok: false, error: 'Configurazione server incompleta' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'JSON non valido' }); }

  const step      = Number(body.step);
  const tessera   = String(body.tessera || '').trim();
  const cellulare = normTel(body.cellulare);
  const nome      = String(body.nome || '').trim().toLowerCase();
  if (!tessera || ![1, 2, 3].includes(step)) return json(400, { ok: false, error: 'Richiesta non valida' });

  const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=tessera,cellulare,telefono,nome,cognome`);
  const soci = await res.json();
  if (!Array.isArray(soci)) return json(500, { ok: false, error: 'Errore di lettura soci' });

  const socio = soci.find(s => normTessera(s.tessera) === normTessera(tessera));
  if (!socio) return json(404, { ok: false, error: 'Tessera non trovata. Verifica il numero o contatta l\'admin.' });

  if (step >= 2) {
    const stored = normTel(socio.cellulare || socio.telefono || '');
    if (!cellulare || stored !== cellulare)
      return json(404, { ok: false, error: 'Numero di cellulare non corrispondente.' });
  }

  if (step >= 3) {
    const soloNome     = (socio.nome || '').toLowerCase();
    const nomeCompleto  = ((socio.nome || '') + ' ' + (socio.cognome || '')).trim().toLowerCase();
    if (!nome || (soloNome !== nome && nomeCompleto !== nome))
      return json(404, { ok: false, error: 'Nome e cognome non corrispondenti.' });
  }

  return json(200, {
    ok: true,
    tessera: socio.tessera,
    cellulare: socio.cellulare || socio.telefono || ''
  });
};
