// state-save — Proxy autenticato per scrivere lo stato dell'app (tabella `config`)
// Usa solo fetch nativo + crypto (Node 18 built-in) — nessuna dipendenza npm.
//
// Scopo: la tabella `config` non deve più accettare scritture dirette con la
// anon key (pubblica). Ogni salvataggio passa da qui: la function verifica il
// chiamante (admin via email+password, oppure tesserato via tessera+cellulare)
// e scrive con la SERVICE_ROLE key, che bypassa la RLS.
//
// Env richieste: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STATE_TOKEN_SECRET
//
// Azioni (campo `action` nel body):
//   'token' → verifica credenziali e restituisce un token firmato (HMAC, 24h)
//   'save'  → verifica il token e fa l'upsert dello stato nella tabella config

import { pbkdf2Sync, createHmac, createHash, timingSafeEqual } from 'node:crypto';

const STATE_KEY = 'sgas_app_state';
// Le password admin NON possono stare nel blob 'sgas_app_state': quella riga è
// leggibile pubblicamente (policy config_read), quindi chiunque potrebbe
// scaricarne l'impronta e provare a forzarla offline. Vivono invece in una
// riga separata, che nessuna policy espone: si legge solo con la service_role,
// cioè solo da qui.
const CREDS_KEY = 'sgas_admin_creds';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 24 ore
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;  // 4 MB (il blob senza immagini è molto più piccolo)

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

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

// Normalizza la tessera come le altre function (ignora spazi, trattini, zeri).
const normTessera = s => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .replace(/([A-Z])0+(\d)/g, '$1$2');

const normTel = s => String(s || '').replace(/[\s\-]/g, '');

// Verifica una password contro un hash "pbkdf2:<salt_hex>:<hash_hex>"
// (stessi parametri del client: PBKDF2 SHA-256, 100000 iterazioni, 32 byte).
function verifyPbkdf2(password, stored){
  if(!password || !stored || !String(stored).startsWith('pbkdf2:')) return false;
  const parts = String(stored).split(':');
  if(parts.length !== 3) return false;
  try{
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const got = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return expected.length === got.length && timingSafeEqual(expected, got);
  }catch(e){ return false; }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64urlJson = obj => b64url(JSON.stringify(obj));

function signToken(secret, payloadObj){
  const body = b64urlJson(payloadObj);
  const sig  = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return body + '.' + sig;
}

function verifyToken(secret, token){
  if(!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  // Confronto a tempo costante
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if(a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try{
    const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    if(!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}

async function readConfigState(url, key){
  const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${STATE_KEY}&select=valore`);
  if(!res.ok) return null;
  const rows = await res.json();
  if(!Array.isArray(rows) || !rows[0]) return null;
  try{ return JSON.parse(rows[0].valore); }catch(e){ return null; }
}

const upsertConfigRow = (url, key, chiave, valore) =>
  sbFetch(url, key, `/rest/v1/config?on_conflict=chiave`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({ chiave, valore: JSON.stringify(valore), updated_at: new Date().toISOString() })
  });

// Impronte delle password admin, dalla riga riservata.
// Forma: { adminPassword, adminPassword2, adminPassword3 }
async function readAdminCreds(url, key){
  const res = await sbFetch(url, key, `/rest/v1/config?chiave=eq.${CREDS_KEY}&select=valore`);
  if(!res.ok) return {};
  const rows = await res.json().catch(()=> null);
  if(!Array.isArray(rows) || !rows[0]) return {};
  try{ return JSON.parse(rows[0].valore) || {}; }catch(e){ return {}; }
}

// Migrazione automatica: le installazioni precedenti tengono le impronte nel
// blob pubblico. Al primo accesso riuscito le si sposta nella riga riservata e
// le si cancella da quello pubblico, senza chiedere niente all'amministratore.
async function migraCredsDalBlob(url, key, state){
  const cfg = (state && state.config) || {};
  const creds = {};
  let daMigrare = false;
  ['adminPassword','adminPassword2','adminPassword3'].forEach(k => {
    if(cfg[k]){ creds[k] = cfg[k]; cfg[k] = ''; daMigrare = true; }
  });
  if(!daMigrare) return;
  const attuali = await readAdminCreds(url, key);
  await upsertConfigRow(url, key, CREDS_KEY, { ...creds, ...attuali });
  await upsertConfigRow(url, key, STATE_KEY, state);
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'Method Not Allowed' });

  const SUPA_URL = (process.env.SUPABASE_URL || '').trim();
  const SUPA_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const SECRET   = (process.env.STATE_TOKEN_SECRET || '').trim();
  if(!SUPA_URL || !SUPA_KEY || !SECRET)
    return json(500, { ok:false, error:'Configurazione server incompleta' });

  if((event.body || '').length > MAX_PAYLOAD_BYTES)
    return json(413, { ok:false, error:'Payload troppo grande' });

  let body;
  try{ body = JSON.parse(event.body); }catch{ return json(400, { ok:false, error:'JSON non valido' }); }

  const action = String(body.action || '');

  // ── Azione: rilascio token ────────────────────────────────────────────────
  if(action === 'token'){
    const kind = String(body.kind || '');
    if(kind === 'admin'){
      const email = String(body.email || '').trim().toLowerCase();
      const pass  = String(body.password || '');
      if(!email || !pass) return json(400, { ok:false, error:'Credenziali mancanti' });
      const state = await readConfigState(SUPA_URL, SUPA_KEY);
      const cfg = (state && state.config) || {};
      // Le email restano nel blob (servono al client), le impronte no.
      const creds = await readAdminCreds(SUPA_URL, SUPA_KEY);
      const hash = k => creds[k] || cfg[k] || '';   // cfg = residuo pre-migrazione
      const pairs = [
        [cfg.adminEmail,  hash('adminPassword')],
        [cfg.adminEmail2, hash('adminPassword2')],
        [cfg.adminEmail3, hash('adminPassword3')],
      ];
      const ok = pairs.some(([e,h]) => e && String(e).toLowerCase() === email && verifyPbkdf2(pass, h));
      if(!ok) return json(401, { ok:false, error:'Credenziali admin non valide' });
      // Accesso riuscito: se le impronte erano ancora nel blob pubblico, spostale
      // ora. Un errore qui non deve impedire l'accesso già verificato.
      try{ await migraCredsDalBlob(SUPA_URL, SUPA_KEY, state); }catch(e){}
      return json(200, { ok:true, token: signToken(SECRET, { role:'admin', sub:email, exp: Date.now()+TOKEN_TTL_MS }) });
    }
    if(kind === 'socio'){
      const tess = normTessera(body.tessera);
      const tel  = normTel(body.cellulare);
      if(!tess || !tel) return json(400, { ok:false, error:'Credenziali mancanti' });
      // Cerca il socio via service_role e confronta tessera normalizzata + cellulare
      const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=id,tessera,cellulare`);
      if(!res.ok) return json(500, { ok:false, error:'Lettura soci fallita' });
      const soci = await res.json();
      const match = Array.isArray(soci) && soci.find(s =>
        normTessera(s.tessera) === tess && normTel(s.cellulare) === tel);
      if(!match) return json(401, { ok:false, error:'Tesserato non riconosciuto' });
      // Un admin che entra col codice Telegram si identifica qui come tesserato:
      // se la sua tessera è fra quelle admin (ADMIN_TESSERE — la stessa fonte
      // che gli apre il pannello admin al login OTP) il token vale come admin,
      // altrimenti non potrebbe usare le azioni riservate pur essendo admin.
      const adminTess = (process.env.ADMIN_TESSERE || '')
        .split(',').map(t => normTessera(t)).filter(Boolean);
      const role = adminTess.includes(normTessera(match.tessera)) ? 'admin' : 'socio';
      return json(200, { ok:true, token: signToken(SECRET, { role, sub:String(match.id), exp: Date.now()+TOKEN_TTL_MS }) });
    }
    return json(400, { ok:false, error:'kind non valido' });
  }

  // ── Azione: elenco tesserati (solo admin) ─────────────────────────────────
  // L'anagrafica soci non è nel file pubblico e la RLS blocca la lettura anon;
  // gli admin email+password (senza sessione Supabase) la ottengono qui.
  if(action === 'soci-list'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });
    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/soci?select=*&order=tessera`);
    if(!res.ok) return json(502, { ok:false, error:'Lettura soci fallita' });
    const soci = await res.json().catch(()=> null);
    if(!Array.isArray(soci)) return json(502, { ok:false, error:'Risposta soci non valida' });
    return json(200, { ok:true, soci });
  }

  // ── Azione: registrazione / verifica webhook Telegram (solo admin) ────────
  // Evita all'admin di dover maneggiare a mano il bot token in un URL del
  // browser (dove finirebbe nella cronologia): token e secret restano qui sul
  // server, presi dalle env var di Netlify.
  if(action === 'telegram-setwebhook' || action === 'telegram-webhookinfo'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });

    const BOT  = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if(!BOT) return json(500, { ok:false, error:'TELEGRAM_BOT_TOKEN non configurato su Netlify' });

    // Verifica stato: utile per capire se il webhook è attivo e se Telegram
    // sta segnalando errori di consegna.
    if(action === 'telegram-webhookinfo'){
      try{
        const r = await fetch(`https://api.telegram.org/bot${BOT}/getWebhookInfo`);
        const d = await r.json().catch(()=>null);
        if(d && d.ok) return json(200, { ok:true, info:d.result });
        return json(502, { ok:false, error:(d&&d.description)||'Telegram non ha risposto correttamente' });
      }catch(e){ return json(502, { ok:false, error:'Chiamata a Telegram fallita: '+e.message }); }
    }

    const HOOK = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if(!HOOK) return json(500, { ok:false, error:'TELEGRAM_WEBHOOK_SECRET non configurato su Netlify (aggiungilo e rifai il deploy)' });

    // L'origine arriva dal client ma non ci fidiamo: deve essere https e un
    // hostname semplice, così non si può far puntare il webhook altrove.
    const site = String(body.siteUrl || '').trim().replace(/\/+$/, '');
    if(!/^https:\/\/[A-Za-z0-9.-]+$/.test(site))
      return json(400, { ok:false, error:'Indirizzo del sito non valido' });
    const hookUrl = site + '/.netlify/functions/telegram-webhook';

    try{
      const r = await fetch(`https://api.telegram.org/bot${BOT}/setWebhook`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          url: hookUrl,
          secret_token: HOOK,
          allowed_updates: ['message','callback_query']
        })
      });
      const d = await r.json().catch(()=>null);
      if(d && d.ok) return json(200, { ok:true, url:hookUrl, description:d.description || 'Webhook registrato' });
      return json(502, { ok:false, error:(d&&d.description) || 'Telegram ha rifiutato la registrazione' });
    }catch(e){ return json(502, { ok:false, error:'Chiamata a Telegram fallita: '+e.message }); }
  }

  // ── Azioni: recupero password admin ───────────────────────────────────────
  // Il codice viene generato, conservato (solo come impronta) e verificato QUI.
  // Prima nasceva e veniva controllato nel browser: chiunque poteva aggirarlo
  // dalla console, e soprattutto la nuova password non arrivava mai al server,
  // che è l'unico a poterla registrare.
  if(action === 'admin-recover-request' || action === 'admin-recover-confirm'){
    const email = String(body.email || '').trim().toLowerCase();
    if(!email) return json(400, { ok:false, error:'Email mancante' });

    const state = await readConfigState(SUPA_URL, SUPA_KEY);
    const cfg = (state && state.config) || {};
    // .trim() anche sul valore salvato: uno spazio finito per sbaglio nel campo
    // Impostazioni rendeva l'email irriconoscibile, e il recupero rispondeva
    // "email sconosciuta" senza che nulla lo lasciasse capire.
    const emailsAdmin = [cfg.adminEmail, cfg.adminEmail2, cfg.adminEmail3]
      .map(e => String(e || '').trim().toLowerCase());
    const slot = emailsAdmin.findIndex(e => e && e === email) + 1;   // 0 = non trovato

    const creds = await readAdminCreds(SUPA_URL, SUPA_KEY);
    const sha = s => createHash('sha256').update(String(s)).digest('hex');

    if(action === 'admin-recover-request'){
      // Nessuna email admin registrata sul server: non è il caso "email
      // sbagliata" (che va taciuto), è una configurazione incompleta che
      // rende il recupero impossibile per CHIUNQUE. Tacerlo significa
      // rispondere "inviato" a un messaggio che non partirà mai — ed è
      // esattamente così che il problema è rimasto invisibile.
      //
      // Perché può succedere: il salvataggio generico delle impostazioni
      // rimuove apposta le email admin dal payload (per non farle
      // sovrascrivere da un dispositivo con una copia vecchia), quindi
      // arrivano al server SOLO tramite il salvataggio dedicato delle
      // credenziali. Se quello non è mai stato fatto, qui non c'è nulla.
      // Non rivela quali email siano admin: dice solo che non ce n'è alcuna.
      if(!emailsAdmin.some(Boolean))
        return json(500, { ok:false, error:'Nessuna email amministratore registrata sul server: apri Impostazioni → Amministratori e salva di nuovo l\'email admin, poi riprova il recupero.' });

      // Risposta sempre uguale SOLO quando l'email non è registrata: non si
      // deve rivelare quali email siano admin. Ma se l'email ESISTE, chi la
      // possiede sa già di essere admin: possiamo (anzi dobbiamo) dirgli se
      // il codice non è partito, altrimenti resta bloccato senza saperlo.
      if(slot > 0){
        const code = String(Math.floor(100000 + Math.random() * 900000));
        creds.recovery = { slot, codeHash: sha(code + '|' + email),
                           exp: Date.now() + 15*60*1000, attempts: 0 };
        await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
        const BOT = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
        if(!BOT) return json(500, { ok:false, error:'TELEGRAM_BOT_TOKEN non configurato sul server' });
        const chats = [cfg.tgAdminChatId, cfg.tgAdminChatId2, cfg.tgAdminChatId3]
          .map(c => String(c || '').trim()).filter(Boolean);
        if(!chats.length) return json(500, { ok:false, error:'Nessun contatto Telegram amministratore configurato' });
        const testo = '🔐 SGAS — Codice reset password admin:\n\n' + code +
                      '\n\n⏱ Scade tra 15 minuti.\nSe non hai richiesto questo codice, ignora il messaggio.';
        const esiti = await Promise.all(chats.map(chat_id =>
          fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ chat_id, text: testo })
          }).then(r => r.json()).catch(e => ({ ok:false, description: String(e) }))));
        const almenoUnoInviato = esiti.some(e => e && e.ok);
        // Dettaglio per contatto: qui non è enumerazione (siamo già nel ramo
        // "email esiste ed è la propria"). Senza questo, un chat_id sbagliato
        // fra tre resta invisibile: "inviato" con successo grazie agli altri
        // due, mentre chi guarda proprio quel contatto non vede mai nulla.
        const dettagli = chats.map((chat_id, i) => ({
          chatId: chat_id, ok: !!(esiti[i] && esiti[i].ok),
          motivo: esiti[i] && !esiti[i].ok ? (esiti[i].description || 'errore sconosciuto') : null
        }));
        if(!almenoUnoInviato){
          delete creds.recovery;
          await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
          const motivo = (esiti.find(e => e && e.description) || {}).description || 'errore sconosciuto';
          return json(502, { ok:false, error:'Invio Telegram fallito: ' + motivo, dettagli });
        }
        return json(200, { ok:true, dettagli });
      }
      return json(200, { ok:true });
    }

    // ── conferma: verifica il codice e registra la nuova password ──
    const rec = creds.recovery;
    if(!rec || slot < 1) return json(400, { ok:false, error:'Nessun recupero in corso. Ricomincia.' });
    if(Date.now() > rec.exp){
      delete creds.recovery; await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
      return json(410, { ok:false, error:'Codice scaduto. Richiedine uno nuovo.' });
    }
    if((rec.attempts || 0) >= 3){
      delete creds.recovery; await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
      return json(429, { ok:false, error:'Troppi tentativi. Richiedi un nuovo codice.' });
    }
    const code = String(body.code || '').trim();
    if(rec.slot !== slot || sha(code + '|' + email) !== rec.codeHash){
      rec.attempts = (rec.attempts || 0) + 1;
      await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
      return json(401, { ok:false, error:'Codice errato', rimasti: Math.max(0, 3 - rec.attempts) });
    }

    const passwordHash = String(body.passwordHash || '');
    if(!passwordHash.startsWith('pbkdf2:'))
      return json(400, { ok:false, error:'Password non hashata' });

    creds[slot === 1 ? 'adminPassword' : `adminPassword${slot}`] = passwordHash;
    delete creds.recovery;
    const res = await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
    if(!res.ok) return json(502, { ok:false, error:'Salvataggio password fallito' });
    return json(200, { ok:true });
  }

  // ── Azioni: catalogo (fornitori e prodotti, tabelle dedicate) ─────────────
  // Stessa logica delle raccolte: una riga per record, così salvare un
  // prodotto non tocca gli altri e due admin non si sovrascrivono a vicenda.
  if(action === 'catalogo-upsert' || action === 'catalogo-delete'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });

    const tabella = String(body.tabella || '');
    if(tabella !== 'fornitori' && tabella !== 'prodotti')
      return json(400, { ok:false, error:'Tabella non valida' });

    if(action === 'catalogo-delete'){
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id])
        .map(x => String(x || '').trim()).filter(Boolean);
      if(!ids.length) return json(400, { ok:false, error:'Id mancante' });
      const lista = ids.map(encodeURIComponent).join(',');
      const res = await sbFetch(SUPA_URL, SUPA_KEY,
        `/rest/v1/${tabella}?id=in.(${lista})`, { method:'DELETE', prefer:'return=minimal' });
      if(!res.ok) return json(502, { ok:false, error:'Eliminazione fallita' });
      return json(200, { ok:true, eliminati: ids.length });
    }

    const lista = Array.isArray(body.righe) ? body.righe : (body.riga ? [body.riga] : []);
    if(!lista.length) return json(400, { ok:false, error:'Niente da salvare' });

    const orNull = v => (v === '' || v === undefined) ? null : v;
    const righe = [];
    for(const r of lista){
      const id = String((r && r.id) || '').trim();
      const nome = String((r && r.nome) || '').trim();
      if(!id || !nome) return json(400, { ok:false, error:'Record senza id o nome' });
      righe.push(tabella === 'fornitori' ? {
        id, nome,
        categoria:          orNull(r.categoria),
        emoji:              orNull(r.emoji),
        zona:               orNull(r.zona),
        descrizione:        orNull(r.descrizione),
        vision:             orNull(r.vision),
        caratteristiche:    Array.isArray(r.caratteristiche) ? r.caratteristiche : [],
        attivo:             r.attivo !== false,
        contattodiretto:    r.contattodiretto === true,
        nome_contatto:      orNull(r.nomeContatto),
        telefono:           orNull(r.telefono),
        whatsapp:           orNull(r.whatsapp),
        email_contatto:     orNull(r.emailContatto),
        telegram_contatto:  orNull(r.telegramContatto),
        indirizzo_contatto: orNull(r.indirizzoContatto),
        logo:               orNull(r.logo),
        banner:             orNull(r.banner),
        updated_at:         new Date().toISOString()
      } : {
        id, nome,
        fornitore_id: orNull(r.fornitorId),
        prezzo:      Number(r.prezzo) || 0,
        unita:       orNull(r.unita),
        codice:      orNull(r.codice),
        descrizione: orNull(r.descrizione),
        disponibile: r.disponibile !== false,
        foto:        orNull(r.foto),
        updated_at:  new Date().toISOString()
      });
    }

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/${tabella}?on_conflict=id`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(righe)
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Salvataggio catalogo fallito', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true, salvate: righe.length });
  }

  // ── Azioni: raccolte ordini (tabella dedicata) ────────────────────────────
  // Le raccolte hanno una riga ciascuna: scrivere una raccolta non tocca le
  // altre. La tabella non ha policy di scrittura, quindi si passa da qui con la
  // service_role: così anche l'admin con email+password (privo di sessione
  // Supabase) può gestirle, come faceva quando stavano nel blob.
  if(action === 'raccolte-upsert' || action === 'raccolte-delete'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });

    if(action === 'raccolte-delete'){
      const id = String(body.id || '').trim();
      if(!id) return json(400, { ok:false, error:'Id mancante' });
      const res = await sbFetch(SUPA_URL, SUPA_KEY,
        `/rest/v1/raccolte?id=eq.${encodeURIComponent(id)}`, { method:'DELETE', prefer:'return=minimal' });
      if(!res.ok) return json(502, { ok:false, error:'Eliminazione fallita' });
      return json(200, { ok:true });
    }

    // upsert: accetta una o più raccolte (la migrazione iniziale ne manda molte)
    const lista = Array.isArray(body.raccolte) ? body.raccolte
                : (body.raccolta ? [body.raccolta] : []);
    if(!lista.length) return json(400, { ok:false, error:'Nessuna raccolta da salvare' });

    const orNull = v => (v === '' || v === undefined) ? null : v;
    const righe = [];
    for(const r of lista){
      const id = String((r && r.id) || '').trim();
      const nome = String((r && r.nome) || '').trim();
      if(!id || !nome) return json(400, { ok:false, error:'Raccolta senza id o nome' });
      righe.push({
        id,
        nome,
        aperta:         r.aperta !== false,
        data_creazione: orNull(r.dataCreazione),
        data_chiusura:  orNull(r.dataChiusura),
        ora_chiusura:   orNull(r.oraChiusura),
        ritiro_data:    orNull(r.ritiroData),
        ritiro_ora:     orNull(r.ritiroOra),
        ritiro_luogo:   orNull(r.ritiroLuogo),
        fornitori:      Array.isArray(r.fornitori) ? r.fornitori : [],
        updated_at:     new Date().toISOString()
      });
    }

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/raccolte?on_conflict=id`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(righe)
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Salvataggio raccolte fallito', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true, salvate: righe.length });
  }

  // ── Azione: primo avvio, creazione del primo amministratore ───────────────
  // La procedura guidata crea l'admin quando non ne esiste ancora nessuno:
  // non può quindi presentare un token, perché non c'è ancora nessuno che
  // possa rilasciarglielo. Questa azione è l'unica senza autenticazione, e si
  // chiude da sola nel momento in cui un amministratore esiste: da lì in poi
  // le credenziali si cambiano solo con 'admin-creds', cioè da autenticati.
  if(action === 'admin-bootstrap'){
    const state = await readConfigState(SUPA_URL, SUPA_KEY) || { config:{} };
    if(!state.config) state.config = {};
    const creds = await readAdminCreds(SUPA_URL, SUPA_KEY);
    const esisteAdmin =
      ['adminPassword','adminPassword2','adminPassword3'].some(k => creds[k] || state.config[k]) ||
      ['adminEmail','adminEmail2','adminEmail3'].some(k => state.config[k]);
    if(esisteAdmin)
      return json(409, { ok:false, error:'Un amministratore è già configurato: usa l\'accesso normale' });

    const email = String(body.email || '').trim().toLowerCase();
    const passwordHash = String(body.passwordHash || '');
    if(!email || !email.includes('@')) return json(400, { ok:false, error:'Email non valida' });
    if(!passwordHash.startsWith('pbkdf2:')) return json(400, { ok:false, error:'Password non hashata' });

    state.config.adminEmail = email;
    state.config.adminPassword = '';
    const resCreds = await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, { adminPassword: passwordHash });
    if(!resCreds.ok) return json(502, { ok:false, error:'Scrittura credenziali fallita' });
    const resState = await upsertConfigRow(SUPA_URL, SUPA_KEY, STATE_KEY, state);
    if(!resState.ok) return json(502, { ok:false, error:'Scrittura stato fallita' });

    return json(200, { ok:true, token: signToken(SECRET, { role:'admin', sub:email, exp: Date.now()+TOKEN_TTL_MS }) });
  }

  // ── Azione: gestione credenziali admin (slot 1/2/3) ───────────────────────
  // Unico percorso autorizzato a scrivere email/password admin. Aggiorna SOLO
  // lo slot indicato, in scrittura-lettura sul valore più recente del server:
  // non passa mai dal blob "generico" (vedi protezione nell'azione 'save'),
  // quindi non rischia di essere sovrascritto o di sovrascrivere per errore
  // gli altri slot o i dati di catalogo.
  if(action === 'admin-creds'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(payload.role !== 'admin') return json(403, { ok:false, error:'Riservato agli admin' });
    const slot = Number(body.slot);
    if(![1,2,3].includes(slot)) return json(400, { ok:false, error:'Slot non valido' });
    const email = String(body.email || '').trim().toLowerCase();
    const passwordHash = String(body.passwordHash || ''); // già hashata pbkdf2 dal client, o '' per rimuovere
    if(passwordHash && !passwordHash.startsWith('pbkdf2:'))
      return json(400, { ok:false, error:'Password non hashata' });
    // Aggiornare la sola email senza toccare la password: serve a registrare
    // sul server un'email admin già in uso (il salvataggio generico non la
    // trasmette apposta), senza cancellare l'impronta della password di chi
    // non la sta cambiando.
    const soloEmail = body.keepPassword === true;
    if(soloEmail && !email)
      return json(400, { ok:false, error:'Email mancante' });

    const state = await readConfigState(SUPA_URL, SUPA_KEY);
    if(!state || !state.config) return json(500, { ok:false, error:'Stato remoto non disponibile' });

    const emailKey = slot===1 ? 'adminEmail' : `adminEmail${slot}`;
    const passKey  = slot===1 ? 'adminPassword' : `adminPassword${slot}`;

    // L'email resta nel blob pubblico (il client la usa per riconoscere lo
    // slot); l'impronta della password va nella riga riservata, e viene
    // rimossa dal blob se vi era rimasta da prima.
    state.config[emailKey] = email;
    state.config[passKey]  = '';

    const creds = await readAdminCreds(SUPA_URL, SUPA_KEY);
    if(!soloEmail) creds[passKey] = passwordHash;

    const resCreds = await upsertConfigRow(SUPA_URL, SUPA_KEY, CREDS_KEY, creds);
    if(!resCreds.ok){
      const txt = await resCreds.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura credenziali fallita', detail: txt.slice(0,200) });
    }
    const res = await upsertConfigRow(SUPA_URL, SUPA_KEY, STATE_KEY, state);
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura fallita', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true });
  }

  // ── Azione: salvataggio stato ─────────────────────────────────────────────
  if(action === 'save'){
    const payload = verifyToken(SECRET, body.token);
    if(!payload) return json(401, { ok:false, error:'Token non valido o scaduto' });
    if(typeof body.valore !== 'string' || !body.valore)
      return json(400, { ok:false, error:'Stato mancante' });
    // Sanity: deve essere JSON valido con un oggetto config
    let parsed;
    try{ parsed = JSON.parse(body.valore); }catch{ return json(400, { ok:false, error:'Stato non valido' }); }
    if(!parsed || typeof parsed !== 'object' || !parsed.config)
      return json(400, { ok:false, error:'Stato incompleto' });

    // Blindatura credenziali admin: questo è il salvataggio "generico" (catalogo,
    // raccolte, ordini...) che ogni dispositivo invia per intero ad ogni modifica.
    // Un dispositivo con una copia locale non aggiornata (che non conosce ancora
    // le credenziali di admin 2/3, es. perché configurate da un altro dispositivo)
    // altrimenti le cancellerebbe qui sopra a ogni salvataggio — bloccando admin
    // 2/3 fuori dall'app. Le credenziali si toccano SOLO tramite l'azione
    // dedicata 'admin-creds' qui sotto: un salvataggio generico non può mai
    // svuotare un campo credenziale che sul server è già valorizzato.
    const CRED_KEYS = ['adminEmail','adminPassword','adminEmail2','adminPassword2','adminEmail3','adminPassword3'];
    const remoteState = await readConfigState(SUPA_URL, SUPA_KEY);
    const remoteCfg = (remoteState && remoteState.config) || {};
    let credsProtected = false;
    CRED_KEYS.forEach(k=>{
      if(!parsed.config[k] && remoteCfg[k]){ parsed.config[k] = remoteCfg[k]; credsProtected = true; }
    });
    const finalValore = credsProtected ? JSON.stringify(parsed) : body.valore;

    const res = await sbFetch(SUPA_URL, SUPA_KEY, `/rest/v1/config?on_conflict=chiave`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ chiave: STATE_KEY, valore: finalValore, updated_at: new Date().toISOString() })
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      return json(502, { ok:false, error:'Scrittura fallita', detail: txt.slice(0,200) });
    }
    return json(200, { ok:true });
  }

  return json(400, { ok:false, error:'Azione non valida' });
};
