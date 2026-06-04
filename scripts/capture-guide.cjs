const puppeteer = require('puppeteer');
const GIFEncoder = require('gif-encoder-2');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:3000/index.html';
const OUT = path.join(__dirname, '../public/guide');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOK = 'guide-session-token-xyz';

const STATE = {
  config: { nomeGas: 'SGAS Freeconomy', logoUrl: '', tgBotToken: '', tgAdminChatId: '' },
  soci: [{ id: 's1', tessera: 'T001', nome: 'Mario Rossi', cellulare: '3331234567', telegramChatId: '', note: '' }],
  fornitori: [
    { id: 'f1', nome: 'BioOrto', categoria: 'Alimentari', descrizione: 'Verdure biologiche a km 0', attivo: true, img: '' },
    { id: 'f2', nome: 'EcoSaponi', categoria: 'Igiene', descrizione: 'Prodotti naturali per la casa', attivo: true, img: '' },
    { id: 'f3', nome: 'VinoNaturo', categoria: 'Vini', descrizione: 'Vini naturali e biodinamici', attivo: true, img: '' },
  ],
  prodotti: [
    { id: 'p1', fornitoreId: 'f1', nome: 'Zucchine Bio', prezzo: 2.5, unita: 'kg', attivo: true },
    { id: 'p2', fornitoreId: 'f1', nome: 'Pomodori San Marzano', prezzo: 3.2, unita: 'kg', attivo: true },
    { id: 'p3', fornitoreId: 'f1', nome: 'Insalata Mista', prezzo: 1.8, unita: 'sacch.', attivo: true },
    { id: 'p4', fornitoreId: 'f2', nome: 'Sapone Marseille', prezzo: 4.5, unita: 'pz', attivo: true },
  ],
  raccolte: [{ id: 'r1', nome: 'Raccolta Giugno 2026', aperta: true, fornitoriIds: ['f1','f2','f3'], dataRitiro: '2026-06-20', oraRitiro: '18:00', luogoRitiro: 'Via Roma 10, Firenze' }],
  prenotazioni: [{ id: 'pr1', nome: 'Cassetta Estiva', descrizione: 'Cassetta mista verdure di stagione', aperta: true, prodotti: [{ nome: 'Zucchine', prezzo: 2.5, qtyMin: 1, qtyMax: 5 },{ nome: 'Pomodori', prezzo: 3.0, qtyMin: 0, qtyMax: 10 }] }],
  ordini: [], ordiniPrenotazione: [],
  messaggi: [{ id: 'm1', socioId: 's1', socioNome: 'Mario Rossi', da: 'admin', testo: 'Benvenuto nel GAS! Scrivi pure per qualsiasi necessita.', data: new Date(Date.now()-7200000).toISOString(), lettoAdmin: true, lettoSocio: true }],
  cart: { raccoltaId: '', items: [] }
};

async function setLoggedIn(page) {
  await page.evaluate((s, tok) => {
    localStorage.setItem('sgas_state', JSON.stringify(s));
    localStorage.setItem('sgas_usr_tok', JSON.stringify({ type:'socio', adminEmail:'', socioId:'s1', _tok: tok }));
    sessionStorage.setItem('sgas_live_tok', tok);
  }, STATE, TOK);
}

async function setLoggedOut(page) {
  await page.evaluate(s => {
    localStorage.setItem('sgas_state', JSON.stringify(s));
    localStorage.removeItem('sgas_usr_tok');
    sessionStorage.removeItem('sgas_live_tok');
  }, STATE);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), type: 'png' });
  console.log('  📸', name);
}

async function makeGif(bufs, name, w, h, delay=1000) {
  if (bufs.length < 2) return;
  const enc = new GIFEncoder(w, h, 'neuquant', true);
  const ws = fs.createWriteStream(path.join(OUT, name));
  enc.createReadStream().pipe(ws);
  enc.setDelay(delay); enc.setRepeat(0); enc.start();
  for (const b of bufs) { enc.addFrame(new Uint8ClampedArray(PNG.sync.read(b).data)); }
  enc.finish();
  await new Promise(r => ws.on('finish', r));
  console.log('  🎞️ ', name);
}

async function click(page, sel) {
  try { const el = await page.$(sel); if (el) { await el.click(); return true; } } catch {}
  return false;
}

async function tryClicks(page, ...sels) {
  for (const s of sels) { if (await click(page, s)) return true; }
  return false;
}

async function main() {
  const W = 390, H = 780;
  const br = await puppeteer.launch({ headless: true, defaultViewport: { width: W, height: H }, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const pg = await br.newPage();
  await pg.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16 like Mac OS X) AppleWebKit/605.1.15');

  // ─── LOGIN ────────────────────────────────────────────
  console.log('\n[1] Login');
  await pg.goto(URL, { waitUntil: 'networkidle0' });
  await setLoggedOut(pg);
  await pg.reload({ waitUntil: 'networkidle0' });
  await sleep(1500);

  const lf = [];
  lf.push(await pg.screenshot({ type:'png' }));
  await shot(pg, '01-login-vuoto.png');

  await pg.$eval('#l-tessera', el => { el.value = ''; el.focus(); });
  await pg.keyboard.type('T001', { delay: 100 });
  await sleep(500);
  lf.push(await pg.screenshot({ type:'png' }));
  await shot(pg, '02-login-tessera.png');

  await pg.$eval('#l-phone', el => { el.value = ''; el.focus(); });
  await pg.keyboard.type('3331234567', { delay: 80 });
  await sleep(500);
  lf.push(await pg.screenshot({ type:'png' }));
  await shot(pg, '03-login-completo.png');
  lf.push(await pg.screenshot({ type:'png' }));
  await makeGif(lf, 'gif-login.gif', W, H, 900);

  // ─── RECUPERO ─────────────────────────────────────────
  console.log('\n[2] Recupero credenziali');
  await click(pg, "button[onclick=\"showRecovery('socio')\"]");
  await sleep(800);
  await shot(pg, '04-recupero-step1.png');

  const rInput = await pg.$('#rec-step1');
  if (rInput) {
    await rInput.focus();
    await pg.keyboard.type('T001', { delay: 80 });
    await sleep(400);
    await shot(pg, '05-recupero-step1-compilato.png');
  }

  // ─── CATALOGO ─────────────────────────────────────────
  console.log('\n[3] Catalogo');
  await setLoggedIn(pg);
  await pg.reload({ waitUntil: 'networkidle0' });
  await sleep(2000);

  // Check what we see
  const h = await pg.evaluate(() => document.querySelector('h1,h2,.section-title')?.textContent || document.title);
  console.log('  Titolo pagina:', h);

  await shot(pg, '06-catalogo.png');

  // ─── FORNITORE ────────────────────────────────────────
  console.log('\n[4] Fornitore + aggiungi prodotto');
  const ordF = [await pg.screenshot({ type:'png' })];

  // get first fornitore button/card
  const fornSel = await pg.evaluate(() => {
    const candidates = document.querySelectorAll('[onclick*="openFornitore"]');
    if (candidates.length) return '[onclick*="openFornitore"]';
    return null;
  });
  if (fornSel) {
    await click(pg, fornSel);
    await sleep(1000);
    ordF.push(await pg.screenshot({ type:'png' }));
    await shot(pg, '07-fornitore.png');

    // Find + button
    const plusSel = await pg.evaluate(() => {
      const btns = document.querySelectorAll('button');
      const plus = Array.from(btns).find(b => b.textContent.trim() === '+' && b.offsetParent);
      if (plus) { plus.id = 'first-plus-btn'; return '#first-plus-btn'; }
      const oc = document.querySelectorAll('[onclick*="cartChange"]');
      const visible = Array.from(oc).find(el => el.offsetParent && el.textContent.includes('+'));
      if (visible) { visible.id = 'first-plus-btn2'; return '#first-plus-btn2'; }
      return null;
    });
    if (plusSel) {
      await click(pg, plusSel);
      await sleep(500);
      ordF.push(await pg.screenshot({ type:'png' }));
      await shot(pg, '08-prodotto-aggiunto.png');
      await click(pg, plusSel);
      await sleep(300);
      ordF.push(await pg.screenshot({ type:'png' }));
    } else {
      console.log('  ⚠️  bottone + non trovato');
    }
  }

  // ─── CARRELLO ─────────────────────────────────────────
  console.log('\n[5] Carrello');
  const cartSel = await pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[onclick]')).find(e => e.getAttribute('onclick')?.includes('cart') && e.offsetParent);
    return el ? el.getAttribute('onclick') : null;
  });
  console.log('  Cart onclick:', cartSel);

  const cartClicked = await tryClicks(pg, '[onclick*="socio-cart"]', '[onclick*="\'cart\'"]', '.btn-cart', '#btn-cart', '[onclick*="showSocioSection"][onclick*="cart"]');
  if (cartClicked) {
    await sleep(800);
    ordF.push(await pg.screenshot({ type:'png' }));
    await shot(pg, '09-carrello.png');
    const sel = await pg.$('select');
    if (sel) {
      await sel.select('r1');
      await sleep(400);
      ordF.push(await pg.screenshot({ type:'png' }));
      await shot(pg, '10-carrello-raccolta.png');
    }
  }
  await makeGif(ordF, 'gif-ordine.gif', W, H, 1100);

  // ─── MESSAGGI ─────────────────────────────────────────
  console.log('\n[6] Messaggi');
  await setLoggedIn(pg);
  await pg.reload({ waitUntil: 'networkidle0' });
  await sleep(1800);

  // Dump all onclick attrs to find messaging button
  const msgBtn = await pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[onclick]')).find(e =>
      (e.getAttribute('onclick')||'').toLowerCase().includes('messagg') && e.offsetParent
    );
    return el ? { onclick: el.getAttribute('onclick'), text: el.textContent.trim().slice(0,30) } : null;
  });
  console.log('  Msg button:', JSON.stringify(msgBtn));

  if (msgBtn) {
    const mf = [];
    await pg.evaluate((oc) => { const el = Array.from(document.querySelectorAll('[onclick]')).find(e => e.getAttribute('onclick') === oc); if(el) el.click(); }, msgBtn.onclick);
    await sleep(900);
    mf.push(await pg.screenshot({ type:'png' }));
    await shot(pg, '11-messaggi.png');

    const ta = await pg.$('textarea, #msg-input, [placeholder*="messaggio"]');
    if (ta) {
      await ta.focus();
      await pg.keyboard.type('Ciao! Quando arriva il mio ordine?', { delay: 50 });
      await sleep(400);
      mf.push(await pg.screenshot({ type:'png' }));
      await shot(pg, '12-messaggio-scritto.png');
    }
    await makeGif(mf, 'gif-messaggio.gif', W, H, 900);
  }

  // ─── PRENOTAZIONI ─────────────────────────────────────
  console.log('\n[7] Prenotazioni');
  const prenBtn = await pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[onclick]')).find(e =>
      (e.getAttribute('onclick')||'').toLowerCase().includes('prenotaz') && e.offsetParent
    );
    return el ? el.getAttribute('onclick') : null;
  });
  console.log('  Pren button onclick:', prenBtn);

  if (prenBtn) {
    await pg.evaluate(oc => { Array.from(document.querySelectorAll('[onclick]')).find(e => e.getAttribute('onclick') === oc)?.click(); }, prenBtn);
    await sleep(900);
    const pf = [await pg.screenshot({ type:'png' })];
    await shot(pg, '13-prenotazioni.png');

    const qi = await pg.$('input[type="number"]');
    if (qi) {
      await qi.focus();
      await pg.keyboard.type('2');
      await sleep(400);
      pf.push(await pg.screenshot({ type:'png' }));
      await shot(pg, '14-prenotazione-qty.png');
    }
    await makeGif(pf, 'gif-prenotazione.gif', W, H, 900);
  }

  // ─── ASSISTENZA ───────────────────────────────────────
  console.log('\n[8] Assistenza');
  const assBtn = await pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[onclick]')).find(e =>
      (e.getAttribute('onclick')||'').toLowerCase().includes('assist') && e.offsetParent
    );
    return el ? el.getAttribute('onclick') : null;
  });
  if (assBtn) {
    await pg.evaluate(oc => { Array.from(document.querySelectorAll('[onclick]')).find(e => e.getAttribute('onclick') === oc)?.click(); }, assBtn);
    await sleep(600);
    await shot(pg, '15-assistenza.png');
  }

  await br.close();
  const files = fs.readdirSync(OUT);
  console.log(`\n✅ ${files.length} file salvati in public/guide/`);
  console.log(files.map(f => '  ' + f).join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
