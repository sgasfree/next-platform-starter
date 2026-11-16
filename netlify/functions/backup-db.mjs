// backup-db — copia di sicurezza automatica del database, una volta a notte.
//
// Netlify Scheduled Function (orario in netlify.toml, come per
// promemoria-scadenze). Nessuno la chiama dal browser: legge tutte le tabelle
// con la service_role e salva un file compresso in Netlify Blobs, fuori da
// Supabase. Cosa contiene, dove sta e quanto si conserva: netlify/lib/backup.mjs.
//
// Se qualcosa va storto (lettura fallita, oppure tesserati o catalogo
// crollati rispetto alla notte prima) avvisa gli admin su Telegram: un backup
// che smette di funzionare senza dirlo a nessuno si scopre il giorno in cui
// serve.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Facoltativa:   TELEGRAM_BOT_TOKEN (per gli avvisi)

import { getStore } from '@netlify/blobs';
import { STORE_NAME, creaBackup, elencaBackup, avvisaAdmin } from '../lib/backup.mjs';

const risposta = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json' } });

export default async () => {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bot = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if(!url || !key) return risposta(500, { ok:false, error:'Configurazione server incompleta' });

  try{
    // Lettura "forte": il confronto con la notte prima deve vedere l'ultimo
    // backup davvero salvato, non una copia in ritardo.
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    // Un rilancio ravvicinato (retry di Netlify) non deve creare doppioni.
    const ultimi = await elencaBackup(store).catch(() => []);
    if(ultimi[0] && ultimi[0].creato && Date.now() - Date.parse(ultimi[0].creato) < 10 * 60 * 1000)
      return risposta(200, { ok:true, saltato:'backup appena fatto', voce: ultimi[0] });

    const { voce, avvisi, eliminati } = await creaBackup(store, { url, key }, 'automatico');
    if(avvisi.length){
      await avvisaAdmin({ url, key, bot },
        '⚠️ S-GAS — controllo del backup notturno\n\nRispetto a ieri i dati sono diminuiti molto:\n• '
        + avvisi.join('\n• ')
        + '\n\nSe non è voluto, i backup dei giorni scorsi sono ancora disponibili in Impostazioni → Backup automatico (non ne è stato cancellato nessuno).');
    }
    console.log('backup-db ok', JSON.stringify({ key: voce.key, byte: voce.byte, conteggi: voce.conteggi, avvisi, eliminati }));
    return risposta(200, { ok:true, voce, avvisi, eliminati });
  }catch(e){
    console.error('backup-db errore', e);
    await avvisaAdmin({ url, key, bot },
      '⚠️ S-GAS — il backup automatico di stanotte NON è riuscito.\n\nMotivo: ' + String(e.message || e).slice(0, 300)
      + '\n\nPuoi riprovare da Impostazioni → Backup automatico → «Crea backup adesso».').catch(() => {});
    return risposta(500, { ok:false, error: String(e.message || e) });
  }
};
