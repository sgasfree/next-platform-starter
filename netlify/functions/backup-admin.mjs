// backup-admin — i backup automatici visti dal pannello admin.
//
// POST JSON { action, token, key? } — `token` è lo stesso permesso firmato che
// l'admin usa per salvare (rilasciato da state-save.mjs): solo il ruolo admin
// passa. Azioni:
//   list      elenco dei backup conservati (data, origine, righe, dimensione)
//   run       crea un backup adesso
//   download  restituisce un backup (file .json.gz; lo decomprime il browser)
//
// I file stanno in Netlify Blobs, non in Supabase: vedi netlify/lib/backup.mjs.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STATE_TOKEN_SECRET

import { getStore } from '@netlify/blobs';
import { STORE_NAME, verifyToken, creaBackup, elencaBackup, leggiBackup } from '../lib/backup.mjs';

const risposta = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  if(req.method !== 'POST') return risposta(405, { ok:false, error:'Method Not Allowed' });

  const url    = (process.env.SUPABASE_URL || '').trim();
  const key    = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const SECRET = (process.env.STATE_TOKEN_SECRET || '').trim();
  if(!url || !key || !SECRET) return risposta(500, { ok:false, error:'Configurazione server incompleta' });

  let body;
  try{ body = await req.json(); }catch{ return risposta(400, { ok:false, error:'JSON non valido' }); }

  const payload = verifyToken(SECRET, body && body.token);
  if(!payload) return risposta(401, { ok:false, error:'Token non valido o scaduto' });
  if(payload.role !== 'admin') return risposta(403, { ok:false, error:'Riservato agli admin' });

  const action = String(body.action || '');
  try{
    // Lettura "forte": dopo «Crea backup adesso» l'elenco deve già contenerlo.
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    if(action === 'list'){
      return risposta(200, { ok:true, backup: await elencaBackup(store) });
    }

    if(action === 'run'){
      // Doppio clic o due admin insieme: non servono due copie identiche.
      const ultimi = await elencaBackup(store).catch(() => []);
      if(ultimi[0] && ultimi[0].creato && Date.now() - Date.parse(ultimi[0].creato) < 60 * 1000)
        return risposta(200, { ok:true, voce: ultimi[0], avvisi: [], backup: ultimi, appenaFatto:true });
      const { voce, avvisi } = await creaBackup(store, { url, key }, 'manuale');
      return risposta(200, { ok:true, voce, avvisi, backup: await elencaBackup(store) });
    }

    if(action === 'download'){
      const dati = await leggiBackup(store, String(body.key || ''));
      if(!dati) return risposta(404, { ok:false, error:'Backup non trovato' });
      return new Response(dati, { status: 200, headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${String(body.key).replace(/[^A-Za-z0-9._-]/g,'')}"`,
        'Cache-Control': 'no-store' } });
    }

    return risposta(400, { ok:false, error:'Azione non valida' });
  }catch(e){
    console.error('backup-admin errore', action, e);
    return risposta(500, { ok:false, error: String(e.message || e).slice(0, 300) });
  }
};
