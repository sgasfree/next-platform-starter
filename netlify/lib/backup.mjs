// backup.mjs — copia di sicurezza del database, condivisa da:
//   - backup-db.mjs     (gira da sola ogni notte)
//   - backup-admin.mjs  (elenco, scarico e "crea adesso" dal pannello admin)
//
// DOVE STA LA COPIA
// In Netlify Blobs, nello store "sgas-backup" del sito: uno spazio privato,
// raggiungibile solo dalle funzioni di questo sito (e dall'account Netlify),
// SEPARATO da Supabase. È il punto: se il database venisse svuotato per un
// errore, un bug o un guasto, la copia non sparisce insieme a lui.
// Il piano gratuito di Supabase non offre backup ripristinabili.
//
// COSA CONTIENE
// Tutte le tabelle con dati veri (vedi TABELLE), lette con la service_role.
// Restano fuori di proposito:
//   - otp_codes, admin_presence: dati che valgono pochi minuti;
//   - le impronte delle password admin e i codici di recupero (riga
//     `sgas_admin_creds`): della riga si tengono solo i Chat ID Telegram.
//     Un file di backup può finire sul computer di un admin: meglio che non
//     contenga nulla che serva a entrare. Le password si reimpostano.
//   - gli account di accesso (auth.users): si ricreano da soli al primo
//     accesso col codice Telegram.
//
// QUANTO SI CONSERVA
// Gli ultimi GIORNI_TENUTI backup, più il primo di ogni mese per MESI_TENUTI
// mesi. Così un problema scoperto tardi (dati rovinati tre settimane fa) ha
// ancora una copia buona a cui tornare.

import { gzipSync, gunzipSync } from 'node:zlib';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STORE_NAME   = 'sgas-backup';
export const PREFISSO     = 'backup-';
export const GIORNI_TENUTI = 30;
export const MESI_TENUTI   = 12;
const PAGINA = 1000;              // righe per richiesta (limite di PostgREST)
const CREDS_KEY = 'sgas_admin_creds';

// `essenziale`: se la lettura fallisce il backup NON viene salvato (meglio
// nessuna copia che una copia a metà scambiata per buona). Le altre, se
// mancano, vengono solo annotate fra le "saltate".
export const TABELLE = [
  { nome:'soci',                ordine:'id',      essenziale:true  },
  { nome:'ordini',              ordine:'id',      essenziale:true  },
  { nome:'messaggi',            ordine:'id',      essenziale:true  },
  { nome:'raccolte',            ordine:'id',      essenziale:true  },
  { nome:'prenotazioni',        ordine:'id',      essenziale:true  },
  { nome:'ordini_prenotazione', ordine:'id',      essenziale:true  },
  { nome:'fornitori',           ordine:'id',      essenziale:true  },
  { nome:'prodotti',            ordine:'id',      essenziale:true  },
  { nome:'config',              ordine:'chiave',  essenziale:true  },
  { nome:'categorie',           ordine:'id',      essenziale:false },
  { nome:'admins',              ordine:'user_id', essenziale:false },
  { nome:'suppliers',           ordine:'id',      essenziale:false },
];
// Tabelle in cui un crollo improvviso delle righe è quasi certamente un
// guaio e non lavoro normale (gli ordini e i messaggi invece si cancellano).
const DA_SORVEGLIARE = ['soci', 'fornitori', 'prodotti'];

const sbFetch = (url, key, path, opts = {}) =>
  fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      ...opts.headers
    }
  });

// Stessa verifica dei token di state-save.mjs (firma HMAC + scadenza).
export function verifyToken(secret, token){
  if(!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if(a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try{
    const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    if(!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}

// Legge una tabella intera, a pagine, in ordine di chiave.
async function leggiTabella(url, key, t){
  const righe = [];
  for(let offset = 0; ; offset += PAGINA){
    const res = await sbFetch(url, key,
      `/rest/v1/${t.nome}?select=*&order=${t.ordine}.asc&limit=${PAGINA}&offset=${offset}`);
    if(!res.ok){
      const testo = await res.text().catch(()=> '');
      throw new Error(`lettura "${t.nome}" fallita (${res.status}) ${testo.slice(0,120)}`);
    }
    const pagina = await res.json();
    if(!Array.isArray(pagina)) throw new Error(`lettura "${t.nome}": risposta inattesa`);
    righe.push(...pagina);
    if(pagina.length < PAGINA) break;
  }
  return righe;
}

// Della riga riservata restano solo i Chat ID Telegram degli admin.
function ripulisciConfig(righe){
  return righe.map(r => {
    if(r.chiave !== CREDS_KEY) return r;
    let dentro = {};
    try{ dentro = JSON.parse(r.valore) || {}; }catch(e){ dentro = {}; }
    const tenuti = {};
    Object.keys(dentro).forEach(k => { if(/^tgAdminChatId/.test(k)) tenuti[k] = dentro[k]; });
    return { ...r, valore: JSON.stringify(tenuti) };
  });
}

// Legge tutto il database e restituisce il documento di backup.
export async function esportaTutto(url, key, origine){
  const tabelle = {}, conteggi = {}, saltate = {};
  for(const t of TABELLE){
    try{
      let righe = await leggiTabella(url, key, t);
      if(t.nome === 'config') righe = ripulisciConfig(righe);
      tabelle[t.nome] = righe;
      conteggi[t.nome] = righe.length;
    }catch(e){
      if(t.essenziale) throw e;
      saltate[t.nome] = String(e.message || e);
    }
  }
  let progetto = '';
  try{ progetto = new URL(url).host; }catch(e){}
  return {
    formato: 'sgas-backup', versione: 1,
    creato: new Date().toISOString(), origine, progetto,
    nota: 'Copia di sicurezza del database S-GAS. Non contiene password ne\' codici di accesso.',
    conteggi, saltate, tabelle
  };
}

const chiaveDa = iso => PREFISSO + iso.replace(/[:.]/g, '-') + '.json.gz';
const aArrayBuffer = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Elenco dei backup, dal più recente. Ogni voce: { key, creato, origine,
// byte, conteggi, saltate }.
export async function elencaBackup(store){
  const { blobs } = await store.list({ prefix: PREFISSO });
  const voci = await Promise.all((blobs || []).map(async b => {
    let m = null;
    try{ m = await store.getMetadata(b.key); }catch(e){}
    const md = (m && m.metadata) || {};
    return { key: b.key, creato: md.creato || '', origine: md.origine || '',
             byte: md.byte || 0, conteggi: md.conteggi || {}, saltate: md.saltate || {} };
  }));
  // La data è nel nome: l'ordine alfabetico inverso è già quello cronologico.
  return voci.sort((a, b) => a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
}

// Quali backup eliminare: restano gli ultimi GIORNI_TENUTI e, fra i più
// vecchi, il primo di ogni mese per MESI_TENUTI mesi.
export function daEliminare(voci, adesso = new Date()){
  const ordinati = [...voci].sort((a, b) => a.key < b.key ? 1 : -1);
  const vecchi = ordinati.slice(GIORNI_TENUTI);
  const limite = new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth() - MESI_TENUTI, 1));
  const primoDelMese = {};
  [...vecchi].reverse().forEach(v => {          // dal più vecchio
    const mese = v.key.slice(PREFISSO.length, PREFISSO.length + 7);   // AAAA-MM
    if(!primoDelMese[mese]) primoDelMese[mese] = v.key;
  });
  return vecchi.filter(v => {
    const mese = v.key.slice(PREFISSO.length, PREFISSO.length + 7);
    const dataMese = new Date(mese + '-01T00:00:00Z');
    const mensileBuono = primoDelMese[mese] === v.key && !(dataMese < limite);
    return !mensileBuono;
  }).map(v => v.key);
}

// Confronta con il backup precedente: un crollo di tesserati o catalogo è il
// segnale che qualcosa ha svuotato il database.
export function crolli(conteggi, precedente){
  const avvisi = [];
  if(!precedente) return avvisi;
  DA_SORVEGLIARE.forEach(nome => {
    const prima = Number(precedente[nome]) || 0, ora = Number(conteggi[nome]) || 0;
    if(prima >= 4 && ora < prima / 2) avvisi.push(`${nome}: da ${prima} a ${ora} righe`);
  });
  return avvisi;
}

// Crea un backup, lo controlla, lo salva e ripulisce i vecchi.
// Restituisce la voce salvata più gli eventuali avvisi.
export async function creaBackup(store, { url, key }, origine){
  const precedenti = await elencaBackup(store).catch(() => []);
  const doc = await esportaTutto(url, key, origine);
  const gz = gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'));

  // Controllo prima di salvare: il file compresso si riapre e contiene
  // esattamente le righe lette. Un backup che non si riapre non è un backup.
  const riletto = JSON.parse(gunzipSync(gz).toString('utf8'));
  for(const nome of Object.keys(doc.conteggi)){
    if(!Array.isArray(riletto.tabelle[nome]) || riletto.tabelle[nome].length !== doc.conteggi[nome])
      throw new Error(`controllo del backup fallito sulla tabella "${nome}"`);
  }

  const chiave = chiaveDa(doc.creato);
  const voce = { key: chiave, creato: doc.creato, origine, byte: gz.length,
                 conteggi: doc.conteggi, saltate: doc.saltate };
  await store.set(chiave, aArrayBuffer(gz), { metadata: {
    creato: voce.creato, origine, byte: voce.byte, conteggi: voce.conteggi, saltate: voce.saltate } });

  const avvisi = crolli(doc.conteggi, precedenti[0] && precedenti[0].conteggi);
  // Se i dati sono crollati NON si elimina nulla: le copie vecchie sono
  // proprio quelle che servono.
  let eliminati = 0;
  if(!avvisi.length){
    const via = daEliminare([voce, ...precedenti]);
    await Promise.all(via.map(k => store.delete(k).then(() => { eliminati++; }).catch(() => {})));
  }
  return { voce, avvisi, eliminati };
}

// Scarica un backup (compresso). null se non esiste.
export async function leggiBackup(store, chiave){
  if(typeof chiave !== 'string' || !chiave.startsWith(PREFISSO) || !/^[A-Za-z0-9._-]+$/.test(chiave)) return null;
  const dati = await store.get(chiave, { type: 'arrayBuffer' });
  return dati ? Buffer.from(dati) : null;
}

// Avvisa gli admin su Telegram (usato solo quando qualcosa non va: un backup
// che fallisce in silenzio è peggio di nessun backup).
export async function avvisaAdmin({ url, key, bot }, testo){
  if(!bot) return 0;
  let chats = [];
  try{
    const leggi = async chiave => {
      const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${chiave}&select=valore`);
      const righe = res.ok ? await res.json() : [];
      try{ return JSON.parse(righe[0].valore) || {}; }catch(e){ return {}; }
    };
    const creds = await leggi(CREDS_KEY);
    chats = [creds.tgAdminChatId, creds.tgAdminChatId2, creds.tgAdminChatId3];
    if(!chats.some(Boolean)){
      const cfg = (await leggi('sgas_app_state')).config || {};
      chats = [cfg.tgAdminChatId, cfg.tgAdminChatId2, cfg.tgAdminChatId3];
    }
    chats = [...new Set(chats.map(c => String(c || '').trim()).filter(Boolean))];
  }catch(e){ return 0; }
  const esiti = await Promise.all(chats.map(chat_id =>
    fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id, text: testo })
    }).then(r => r.json()).catch(() => ({ ok:false }))));
  return esiti.filter(e => e && e.ok).length;
}
