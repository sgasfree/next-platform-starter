#!/usr/bin/env python3
"""
SGAS Freeconomy — patch completo v3
Patch 1-8: tutte le patch precedenti
Patch 9: Supabase real-time sync multi-admin completo
  - URL/Key configurabili da impostazioni
  - Real-time subscription (notifica istantanea tra admin)
  - Esclusione logoData dal sync (troppo grande)
  - UI impostazioni con campi URL/Key + test connection
  - Istruzioni SQL per creare la tabella
"""

import json, sys

SRC    = '/root/.claude/uploads/f70f52f9-1434-4493-bf2b-8a63c49576fd/9f15bbed-index.html'
BACKUP = '/root/.claude/uploads/d9ab8598-0c8c-476a-8b28-2ec8cbd3496f/21c88098-backupsgasPULITO.json'
OUT    = '/home/user/next-platform-starter/public/index.html'

print('Reading files...')
with open(SRC, 'r', errors='replace') as f:
    html = f.read()
with open(BACKUP, 'r') as f:
    backup = json.load(f)

ok = []
def patch(name, old, new):
    global html
    if old in html:
        html = html.replace(old, new, 1)
        ok.append(name)
    else:
        print(f'  ⚠️  NOT FOUND: {name}')

# ══════════════════════════════════════════════════════════════════
# PATCH 1-8 (da versioni precedenti)
# ══════════════════════════════════════════════════════════════════

# ── 1: _emb con backup UUID + _embVer='2' + supabasePaused:false ──
print('Patch 1: _emb aggiornato...')
emb_var = 'var _emb='
idx = html.find(emb_var)
start = idx + len(emb_var)
chunk = html[start:]
depth=0; in_str=False; esc=False; end_idx=0
for i,c in enumerate(chunk):
    if esc: esc=False; continue
    if c=='\\' and in_str: esc=True; continue
    if c=='"' and not esc: in_str=not in_str; continue
    if not in_str:
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0: end_idx=i+1; break
emb = json.loads(chunk[:end_idx])
orig_config = emb.get('config', {})
backup_config = backup.get('config', {})
merged = backup_config.copy()
if not merged.get('logoData'):
    merged['logoData'] = orig_config.get('logoData', '')
merged['supabasePaused'] = False        # abilita sync
merged['supabaseUrl']    = ''           # da configurare
merged['supabaseKey']    = ''           # da configurare
emb['config']    = merged
emb['fornitori'] = backup['fornitori']
emb['prodotti']  = backup['prodotti']
emb['soci']      = backup['soci']
emb['categorie'] = backup.get('categorie', emb.get('categorie', []))
emb['premi']     = []
emb['news']      = []
emb['_embVer']   = '2'
new_emb = json.dumps(emb, ensure_ascii=False, separators=(',',':'))
html = html[:idx] + emb_var + new_emb + html[idx+len(emb_var)+end_idx:]
ok.append('1: _emb aggiornato')
print(f'   {len(backup["fornitori"])} fornitori, {len(backup["prodotti"])} prodotti')

# ── 2: init script _embVer ──
print('Patch 2: init script...')
patch('2: init _embVer',
    'var _raw=localStorage.getItem("sgas_state");\n'
    '  if(_raw){\n'
    '    var _cur=JSON.parse(_raw);\n'
    '    _cur.config=_emb.config;\n'
    '    _cur.soci=_emb.soci;\n'
    '    _cur.fornitori=_emb.fornitori;\n'
    '    _cur.prodotti=_emb.prodotti;\n'
    '    _cur.categorie=_emb.categorie;\n'
    '    _cur.raccolte=_emb.raccolte;\n'
    '    _cur.premi=_emb.premi;\n'
    '    localStorage.setItem("sgas_state",JSON.stringify(_cur));\n'
    '  }else{\n'
    '    localStorage.setItem("sgas_state",JSON.stringify(_emb));\n'
    '  }',
    'var _raw=localStorage.getItem("sgas_state");\n'
    '  if(_raw){\n'
    '    var _cur=JSON.parse(_raw);\n'
    '    if(_cur._embVer!==_emb._embVer){\n'
    '      var _savedToken=_cur.config&&_cur.config.tgBotToken;\n'
    '      var _savedSupa=_cur.config&&{url:_cur.config.supabaseUrl,key:_cur.config.supabaseKey,paused:_cur.config.supabasePaused};\n'
    '      _cur.config=Object.assign({},_emb.config);\n'
    '      if(_savedToken) _cur.config.tgBotToken=_savedToken;\n'
    '      if(_savedSupa&&_savedSupa.url){_cur.config.supabaseUrl=_savedSupa.url;_cur.config.supabaseKey=_savedSupa.key;_cur.config.supabasePaused=_savedSupa.paused;}\n'
    '      _cur.fornitori=_emb.fornitori;\n'
    '      _cur.prodotti=_emb.prodotti;\n'
    '      _cur.soci=_emb.soci;\n'
    '      _cur.categorie=_emb.categorie;\n'
    '      _cur.premi=_emb.premi;\n'
    '      _cur._embVer=_emb._embVer;\n'
    '    }\n'
    '    // Deduplicazione fornitori: rimuovi doppi per nome, preferisci UUID\n'
    '    if(_cur.fornitori&&_cur.fornitori.length>20){\n'
    '      var _seen={};\n'
    '      _cur.fornitori=_cur.fornitori.filter(function(f){\n'
    '        var k=(f.nome||"").toLowerCase().trim();\n'
    '        if(_seen[k])return false;\n'
    '        _seen[k]=true;return true;\n'
    '      });\n'
    '    }\n'
    '    // Deduplicazione prodotti: rimuovi doppi per nome+fornitorId\n'
    '    if(_cur.prodotti&&_cur.prodotti.length>600){\n'
    '      var _seenP={};\n'
    '      _cur.prodotti=_cur.prodotti.filter(function(p){\n'
    '        var k=(p.nome||"").toLowerCase().trim()+"_"+(p.fornitorId||"");\n'
    '        if(_seenP[k])return false;\n'
    '        _seenP[k]=true;return true;\n'
    '      });\n'
    '    }\n'
    '    localStorage.setItem("sgas_state",JSON.stringify(_cur));\n'
    '  }else{\n'
    '    localStorage.setItem("sgas_state",JSON.stringify(_emb));\n'
    '  }'
)

# ── 3: OneSignal script tag ──
print('Patch 3: OneSignal tag...')
patch('3: OneSignal tag',
    '<script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer=""></script>',
    '')

# ── 4: OneSignal init block ──
print('Patch 4: OneSignal block...')
idx_os  = html.find("const OS_APP_ID  = '")
if idx_os == -1: idx_os = html.find("const OS_APP_ID=")
if idx_os == -1: idx_os = html.find("const OS_APP_ID =")
idx_end = html.find('}\n\nconst TG_ASSIST', idx_os if idx_os!=-1 else 0)
if idx_os!=-1 and idx_end!=-1:
    # Sostituisci il blocco OneSignal con stub sendPush no-op
    stub = 'async function sendPush(){ /* OneSignal rimosso */ }\nfunction promptPushPermission(){ /* OneSignal rimosso */ }\n\n'
    html = html[:idx_os] + stub + html[idx_end+len('}\n\n'):]
    ok.append('4: OneSignal block + sendPush stub')
else:
    print('  ⚠️  OneSignal block not found')

# ── 5: campanella ──
print('Patch 5: campanella...')
idx_bell = html.find('onclick="promptPushPermission()"')
if idx_bell != -1:
    btn_start = html.rfind('<button', 0, idx_bell)
    btn_end   = html.find('</button>', idx_bell) + len('</button>')
    html = html[:btn_start] + html[btn_end:]
    ok.append('5: campanella')
else:
    print('  ⚠️  campanella non trovata')

# ── 6: ordine Word ──
print('Patch 6: ordine Word...')
# 6a: colW + rows2 + header/data (targeted replacements)
patch('6a: colW',
    '  const colW = [3500,900,800,1500,1600];',
    '  const colW = [2200,1500,800,800,1400,1400];')

patch('6b: socio+forn in rows2',
    '  }\n  const rows2 = o.items.map(i=>{\n'
    '    const p = S.prodotti.find(x=>x.id===i.prodottoId);\n'
    "    const nome = p?p.nome:i.prodottoId;\n"
    "    const unita = p?p.unita||'':'';\n"
    '    const prezzo = p?p.prezzo:0;\n'
    '    const tot = prezzo*i.qty;\n'
    '    return {nome,unita,qty:i.qty,prezzo,tot};\n'
    '  });',
    '  }\n'
    '  const socio = S.soci.find(x=>x.id===o.socioId);\n'
    "  const socioNomeCompleto = socio?(socio.nome||'')+(socio.cognome?' '+socio.cognome:''):(o.socioNome||o.socioId);\n"
    "  const socioTessera = socio?socio.tessera||'—':'—';\n"
    '  const rows2 = o.items.map(i=>{\n'
    '    const p = S.prodotti.find(x=>x.id===i.prodottoId);\n'
    '    const f = p?S.fornitori.find(x=>x.id===p.fornitorId):null;\n'
    "    const nome = p?p.nome:i.prodottoId;\n"
    "    const forn = f?f.nome:'—';\n"
    "    const unita = p?p.unita||'':'';\n"
    '    const prezzo = p?p.prezzo:0;\n'
    '    const tot = prezzo*i.qty;\n'
    '    return {nome,forn,unita,qty:i.qty,prezzo,tot};\n'
    '  });')

patch('6c: headerRow 6 col',
    "    mkCell('Prodotto',true,false,true,colW[0]),\n"
    "    mkCell('Unità',true,false,true,colW[1]),\n"
    "    mkCell('Q.tà',true,true,true,colW[2]),\n"
    "    mkCell('Prezzo',true,true,true,colW[3]),\n"
    "    mkCell('Totale',true,true,true,colW[4])",
    "    mkCell('Prodotto',true,false,true,colW[0]),\n"
    "    mkCell('Fornitore',true,false,true,colW[1]),\n"
    "    mkCell('Unità',true,false,true,colW[2]),\n"
    "    mkCell('Q.tà',true,true,true,colW[3]),\n"
    "    mkCell('Prezzo',true,true,true,colW[4]),\n"
    "    mkCell('Totale',true,true,true,colW[5])")

patch('6d: dataRows 6 col',
    "    mkCell(r.nome,false,false,false,colW[0]),\n"
    "    mkCell(r.unita,false,false,false,colW[1]),\n"
    "    mkCell(r.qty,false,true,false,colW[2]),\n"
    "    mkCell('€ '+r.prezzo.toFixed(2),false,true,false,colW[3]),\n"
    "    mkCell('€ '+r.tot.toFixed(2),false,true,false,colW[4])\n"
    "  ]}));",
    "    mkCell(r.nome,false,false,false,colW[0]),\n"
    "    mkCell(r.forn,false,false,false,colW[1]),\n"
    "    mkCell(r.unita,false,false,false,colW[2]),\n"
    "    mkCell(r.qty,false,true,false,colW[3]),\n"
    "    mkCell('€ '+r.prezzo.toFixed(2),false,true,false,colW[4]),\n"
    "    mkCell('€ '+r.tot.toFixed(2),false,true,false,colW[5])\n"
    "  ]}));")

patch('6e: totalRow span:5',
    '    new TableCell({borders:bdrs,width:{size:colW[0]+colW[1]+colW[2]+colW[3],type:WidthType.DXA},columnSpan:4,\n'
    '      margins:{top:80,bottom:80,left:120,right:120},shading:{fill:\'A8D5A2\',type:ShadingType.CLEAR},\n'
    "      children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'TOTALE',bold:true,size:22,font:'Arial'})]})]}),\n"
    '    new TableCell({borders:bdrs,width:{size:colW[4],type:WidthType.DXA},',
    '    new TableCell({borders:bdrs,width:{size:colW[0]+colW[1]+colW[2]+colW[3]+colW[4],type:WidthType.DXA},columnSpan:5,\n'
    '      margins:{top:80,bottom:80,left:120,right:120},shading:{fill:\'A8D5A2\',type:ShadingType.CLEAR},\n'
    "      children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'TOTALE',bold:true,size:22,font:'Arial'})]})]}),\n"
    '    new TableCell({borders:bdrs,width:{size:colW[5],type:WidthType.DXA},')

patch('6f: socio tessera para',
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'Socio: '+(o.socioNome||o.socioId),size:22,font:'Arial'})]}));",
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:20},\n"
    "    children:[new TextRun({text:'Socio: '+socioNomeCompleto,bold:true,size:22,font:'Arial'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'Tessera: '+socioTessera,size:20,font:'Arial',color:'2E7D32'})]}));")

# ── 7: NEWS rimozione ──
print('Patch 7: NEWS rimozione...')
patch('7a: admin nav news',
    "        <button class=\"nav-item\" id=\"nav-news\" onclick=\"adminNav('news')\"><span class=\"nav-icon\">📰</span>News</button>\n", '')
patch('7b: socio topbar news',
    "    <button class=\"topbar-icon\" onclick=\"showSocioSection('news');renderNewsSocio()\" title=\"Notizie\" style=\"position:relative;\">\n"
    "      📰<span class=\"badge\" id=\"news-badge-socio\" style=\"display:none;\">!</span>\n"
    "    </button>\n", '')
patch('7c: panels news ref',
    "  if(sec==='news') acts.innerHTML=`<button class=\"btn btn-primary btn-sm\" onclick=\"modalNewNews()\">📰 Nuovo articolo</button>`;\n"
    "  const panels={dashboard:renderDashboard,soci:renderSoci,fornitori:renderFornitori_admin,prodotti:renderProdotti_admin,raccolte:renderRaccolte,ordini:renderOrdini,prenotazioni:renderPrenotazioni,news:renderNews,messaggi:renderAdminMsgList,settings:renderSettings,chisiamo:()=>renderChiSiamo('admin')};\n",
    "  const panels={dashboard:renderDashboard,soci:renderSoci,fornitori:renderFornitori_admin,prodotti:renderProdotti_admin,raccolte:renderRaccolte,ordini:renderOrdini,prenotazioni:renderPrenotazioni,messaggi:renderAdminMsgList,settings:renderSettings,chisiamo:()=>renderChiSiamo('admin')};\n")
patch('7d: socio news HTML',
    "  <!-- News socio -->\n"
    "  <div id=\"socio-news\" style=\"display:none;\" class=\"content\">\n"
    "    <button class=\"back-btn\" onclick=\"backToCatalogo()\">← Torna al catalogo</button>\n"
    "    <h2 class=\"section-title\">📰 Notizie dal GAS</h2>\n"
    "    <div id=\"news-socio-content\"><div style=\"padding:40px;text-align:center;color:var(--text-light);\">Caricamento...</div></div>\n"
    "  </div>\n", '')
news_block_start = '// ════════════════════ NEWS ════════════════════\n'
news_block_end   = '// ════════════════════ MESSAGGI ════════════════════\n'
idx_ns = html.find(news_block_start); idx_ne = html.find(news_block_end)
if idx_ns != -1 and idx_ne != -1:
    html = html[:idx_ns] + html[idx_ne:]; ok.append('7e: news JS block')
socio_news_fn = '// ── SOCIO: leggi le news ──\nfunction renderNewsSocio(){'
socio_news_end = "    +'</div></div>';\n}\n"
idx_sns = html.find(socio_news_fn); idx_sne = html.find(socio_news_end, idx_sns if idx_sns!=-1 else 0)
if idx_sns != -1 and idx_sne != -1:
    html = html[:idx_sns] + html[idx_sne+len(socio_news_end):]; ok.append('7f: renderNewsSocio')

# ── 8: FEDELTÀ rimozione ──
print('Patch 8: FEDELTÀ rimozione...')
fed_start = '    <div class="card" style="margin-bottom:16px;">\n      <h3 style="font-family:var(--font-serif,serif);margin-bottom:8px;">⭐ Programma Fedeltà'
fed_end_m = '    <div class="card">\n      <h3 style="font-family:var(--font-serif,serif);margin-bottom:12px;">\U0001f4be Backup'
idx_fs = html.find(fed_start); idx_fe = html.find(fed_end_m, idx_fs if idx_fs!=-1 else 0)
if idx_fs != -1 and idx_fe != -1:
    html = html[:idx_fs] + html[idx_fe:]; ok.append('8a: fedeltà card HTML')
else:
    print(f'  ⚠️  fedeltà card not found ({idx_fs}, {idx_fe})')

fedelta_js_start = '// ════════ SISTEMA PUNTI FEDELTÀ ════════\n'
fedelta_js_end   = 'function loadState(){'
idx_fjs = html.find(fedelta_js_start); idx_fje = html.find(fedelta_js_end)
if idx_fjs != -1 and idx_fje != -1:
    html = html[:idx_fjs] + html[idx_fje:]; ok.append('8b: LIVELLI/getLivello')

profilo_comment = '// ════════════════════ PROFILO ════════════════════\n'
profilo_fn = 'function renderProfilo(){'
idx_pc = html.find(profilo_comment); idx_pf = html.find(profilo_fn)
if idx_pc != -1 and idx_pf != -1 and idx_pc < idx_pf:
    html = html[:idx_pc+len(profilo_comment)] + '\n' + html[idx_pf:]; ok.append('8c: renderCardPunti+riscatta')

premi_fns_start = 'function savePuntiConfig(){'
premi_fns_end   = 'function esportaAppNetlify(){'
idx_pfns = html.find(premi_fns_start); idx_pfne = html.find(premi_fns_end)
if idx_pfns != -1 and idx_pfne != -1:
    html = html[:idx_pfns] + html[idx_pfne:]; ok.append('8d: savePuntiConfig/renderPremiAdmin')
patch('8e: news/premi from export',
    "    news:      S.news      || [],\n"
    "    premi:     S.premi     || [],\n", '')

# 8f: fedeltà card nel template JS di renderSettings() — usa \${ per template literal
patch('8f: fedeltà card JS renderSettings',
    '    <div class="card" style="margin-bottom:16px;">\n'
    '      <h3 style="font-family:var(--font-serif,serif);margin-bottom:8px;">⭐ Programma Fedeltà — Configurazione</h3>\n'
    '      <p style="font-size:.82rem;color:var(--text-light);margin-bottom:12px;">Configura i punti per euro speso e gestisci i premi riscattabili dai soci.</p>\n'
    '      <div class="field">\n'
    '        <label>Punti per ogni €1 speso</label>\n'
    '        <input id="s-punti-rate" type="number" step="0.01" min="0.01" max="10" value="\\${S.config.puntiPerEuro||0.2}" style="max-width:120px;">\n'
    '        <div style="font-size:.75rem;color:var(--text-light);margin-top:4px;">Es: 0.2 = 1 punto ogni €5 · 1 = 1 punto ogni €1 · 0.1 = 1 punto ogni €10</div>\n'
    '      </div>\n'
    '      <button class="btn btn-primary btn-sm" onclick="savePuntiConfig()" style="margin-bottom:18px;">💾 Salva configurazione punti</button>\n'
    '      <div style="font-size:.8rem;font-weight:800;color:var(--green-dark);margin-bottom:10px;">🎁 Premi Riscattabili</div>\n'
    '      <div id="admin-premi-list"></div>\n'
    '      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">\n'
    '        <button class="btn btn-primary btn-sm" onclick="modalNewPremio()">➕ Nuovo Premio</button>\n'
    '      </div>\n'
    '      <div style="font-size:.8rem;font-weight:800;color:var(--green-dark);margin:18px 0 10px;">📊 Riscatti Soci</div>\n'
    '      <div id="admin-riscatti-list"></div>\n'
    '    </div>\n'
    '    <div class="card">\n'
    '      <h3 style="font-family:var(--font-serif,serif);margin-bottom:12px;">💾 Backup & Ripristino</h3>',
    '    <div class="card">\n'
    '      <h3 style="font-family:var(--font-serif,serif);margin-bottom:12px;">💾 Backup & Ripristino</h3>'
)

# 8g: setTimeout(renderPremiAdmin) call in renderSettings
patch('8g: setTimeout renderPremiAdmin call',
    '  setTimeout(renderPremiAdmin, 50);\n', '')

# ══════════════════════════════════════════════════════════════════
# PATCH 10 — CLEANUP RIFERIMENTI RESIDUI FEDELTÀ/NEWS
# ══════════════════════════════════════════════════════════════════
print('Patch 10: cleanup riferimenti residui...')

# 10a: showSocioSection — rimuovi 'news' dall'array (panel rimosso)
patch('10a: showSocioSection remove news',
    "  ['catalogo','fornitore','cart','profilo','messaggi','news','prenotazioni','chisiamo'].forEach(s=>{",
    "  ['catalogo','fornitore','cart','profilo','messaggi','prenotazioni','chisiamo'].forEach(s=>{"
)

# 10b: loadState — rimuovi DEFAULT_PREMI, S.news, newsLastSeen
patch('10b: loadState remove premi/news',
    "  if(!S.premi) S.premi=DEFAULT_PREMI.map(p=>({...p}));\n"
    "  if(!S.news) S.news=[];\n"
    "  if(!S.newsLastSeen) S.newsLastSeen={}; // {socioId: isoString}\n",
    ""
)

# 10c: buildOrderTgMsg — rimuovi parametro punti e logica fedeltà
patch('10c: buildOrderTgMsg remove punti',
    "function buildOrderTgMsg(ord, forSocio, puntiGuadagnati=0){",
    "function buildOrderTgMsg(ord, forSocio){"
)
patch('10c2: buildOrderTgMsg remove punti block',
    "  if(forSocio){\n"
    "    const puntiAttuali = getPuntiSocio(ord.socioId);\n"
    "    const lv = getLivello(puntiAttuali);\n"
    "    const puntiMsg = puntiGuadagnati>0 ? `\\n⭐ Punti guadagnati: +${puntiGuadagnati} (Totale: ${puntiAttuali}) ${lv.emoji} ${lv.nome}` : '';\n"
    "    return `✅ <b>Ordine confermato!</b>\\n`+\n"
    "      `📋 <b>${ord.id}</b>\\n`+\n"
    "      `🗓 Raccolta: ${raccNome}\\n`+\n"
    "      `👤 ${ord.socioNome} ${ord.socioCognome}\\n\\n`+\n"
    "      `${righe}\\n`+\n"
    "      `💶 <b>Totale: €${ord.totale.toFixed(2)}</b>`+puntiMsg+`\\n\\n`+\n"
    "      `Grazie per il tuo ordine!`;",
    "  if(forSocio){\n"
    "    return `✅ <b>Ordine confermato!</b>\\n`+\n"
    "      `📋 <b>${ord.id}</b>\\n`+\n"
    "      `🗓 Raccolta: ${raccNome}\\n`+\n"
    "      `👤 ${ord.socioNome} ${ord.socioCognome}\\n\\n`+\n"
    "      `${righe}\\n`+\n"
    "      `💶 <b>Totale: €${ord.totale.toFixed(2)}</b>\\n\\n`+\n"
    "      `Grazie per il tuo ordine!`;"
)

# 10d: confermaOrdine — rimuovi calcolo punti fedeltà
patch('10d: confermaOrdine remove punti',
    "  // Aggiungi punti fedeltà al socio\n"
    "  const puntiGuadagnati = calcolaPuntiOrdine(total);\n"
    "  const socioFedel = S.soci.find(x=>x.id===currentUser.id);\n"
    "  if(socioFedel){\n"
    "    socioFedel.punti = (socioFedel.punti||0) + puntiGuadagnati;\n"
    "    currentUser.punti = socioFedel.punti;\n"
    "  }\n",
    ""
)
patch('10d2: confermaOrdine remove puntiGuadagnati in sendTelegram',
    "  if(socioChatId) sendTelegramMsg(socioChatId, buildOrderTgMsg(ord, true, puntiGuadagnati));",
    "  if(socioChatId) sendTelegramMsg(socioChatId, buildOrderTgMsg(ord, true));"
)

# 10e: export — rimuovi newsLastSeen
patch('10e: export remove newsLastSeen',
    "    newsLastSeen: S.newsLastSeen || {},\n", "")

# 10f: rimuovi updateNewsBadge (riferisce news-badge-socio rimosso)
patch('10f: remove updateNewsBadge',
    "function updateNewsBadge(){\n"
    "  if(!currentUser||currentUser.type!=='socio') return;\n"
    "  const b=document.getElementById('news-badge-socio');\n"
    "  if(!b) return;\n"
    "  if(!S.news||!S.news.length){b.style.display='none';return;}\n"
    "  // Count news published after the socio last opened the news section\n"
    "  const lastSeen=S.newsLastSeen&&S.newsLastSeen[currentUser.id]\n"
    "    ? new Date(S.newsLastSeen[currentUser.id])\n"
    "    : new Date(0);\n"
    "  const unread=S.news.filter(n=>{\n"
    "    try{ return new Date(n.data) > lastSeen; }catch(e){ return true; }\n"
    "  }).length;\n"
    "  if(unread>0){\n"
    "    b.textContent=unread>99?'99+':String(unread);\n"
    "    b.style.display='flex';\n"
    "  } else {\n"
    "    b.style.display='none';\n"
    "  }\n"
    "}",
    "function updateNewsBadge(){ /* rimossa sezione news */ }"
)

# ══════════════════════════════════════════════════════════════════
# PATCH 11 — RIMOZIONE GALLERIA FORNITORE
# ══════════════════════════════════════════════════════════════════
print('Patch 11: rimozione galleria fornitore...')

# 11a: campo galleria nel modal fornForm()
patch('11a: galleria field in fornForm',
    '    <div class="field">\n'
    '      <label>📸 Galleria foto (max 6)</label>\n'
    '      <div id="m-fgalleria-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">\n'
    "        ${(f.galleria||[]).map((src,i)=>`<div style=\"position:relative;width:72px;height:72px;\">\n"
    '          <img src="${src}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:2px solid var(--green-light);">\n'
    '          <button type="button" onclick="_fornGalleria.splice(${i},1);_fornRefreshGalleria()" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:var(--danger,#e53935);color:#fff;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>\n'
    "        </div>`).join('')}\n"
    '      </div>\n'
    '      <label class="btn btn-secondary btn-sm" id="m-fgalleria-btn" style="cursor:pointer;display:inline-block;">📷 Aggiungi foto<input type="file" accept="image/*" multiple style="display:none;" onchange="_fornAddGalleria(event)"></label>\n'
    '    </div>`;\n'
    '}',
    '    `;\n'
    '}'
)

# 11b: _fornGalleria init in modalNewFornitore
patch('11b: _fornGalleria in modalNewFornitore',
    '  _fornLogo=null; _fornGalleria=[];\n',
    '  _fornLogo=null;\n'
)

# 11c: _fornGalleria init in modalEditFornitore
patch('11c: _fornGalleria in modalEditFornitore',
    '  _fornLogo=f.logo||null; _fornGalleria=[...(f.galleria||[])];\n',
    '  _fornLogo=f.logo||null;\n'
)

# 11d: galleria in saveFornitore data object
patch('11d: galleria in saveFornitore',
    '    galleria:_fornGalleria.length?[..._fornGalleria]:undefined,\n',
    ''
)

# 11e: _fornGalleria variable + _fornRefreshGalleria + _fornAddGalleria functions
patch('11e: _fornGalleria var + helper fns',
    'let _fornLogo = null;\n'
    'let _fornGalleria = [];\n'
    '\n'
    'function _fornRefreshGalleria(){\n'
    '  const wrap=document.getElementById(\'m-fgalleria-preview\');\n'
    '  if(!wrap) return;\n'
    '  const btn=document.getElementById(\'m-fgalleria-btn\');\n'
    "  wrap.innerHTML=_fornGalleria.map((src,i)=>`<div style=\"position:relative;width:72px;height:72px;\">\n"
    '    <img src="${src}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:2px solid var(--green-light);">\n'
    '    <button type="button" onclick="_fornGalleria.splice(${i},1);_fornRefreshGalleria()" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:var(--danger,#e53935);color:#fff;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>\n'
    "  </div>`).join('');\n"
    "  if(btn) btn.style.display=_fornGalleria.length>=6?'none':'inline-block';\n"
    '}\n'
    '\n'
    'function _fornAddGalleria(ev){\n'
    '  const files=[...ev.target.files];\n'
    '  const rimasti=6-_fornGalleria.length;\n'
    "  if(!rimasti){toast('Massimo 6 foto galleria');return;}\n"
    '  let loaded=0;\n'
    '  files.slice(0,rimasti).forEach(file=>{\n'
    "    if(file.size>3*1024*1024){toast('Foto troppo grande (max 3 MB)');return;}\n"
    '    const reader=new FileReader();\n'
    '    reader.onload=e=>{\n'
    '      _fornGalleria.push(e.target.result);\n'
    '      loaded++;\n'
    '      if(loaded===Math.min(files.length,rimasti)) _fornRefreshGalleria();\n'
    '    };\n'
    '    reader.readAsDataURL(file);\n'
    '  });\n'
    '}',
    'let _fornLogo = null;'
)

# 11f: openGalleriaFull function
old_galleria_full = (
    'function openGalleriaFull(galleria, startIdx){\n'
    '  let idx=startIdx||0;\n'
    '  function renderLightbox(){\n'
    "    document.getElementById('galleria-lightbox').innerHTML=`\n"
    '      <div style="position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;" onclick="this.remove()">\n'
    '        <div style="position:relative;max-width:min(90vw,600px);width:100%;" onclick="event.stopPropagation()">\n'
    '          <img src="${galleria[idx]}" style="width:100%;max-height:75vh;object-fit:contain;border-radius:14px;display:block;">\n'
    '          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:12px;">\n'
    "            <button onclick=\"idx=(idx-1+galleria.length)%galleria.length;renderLightbox()\" style=\"background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:40px;height:40px;font-size:1.2rem;cursor:pointer;\" ${galleria.length<=1?'disabled':''}>‹</button>\n"
    '            <span style="color:rgba(255,255,255,.7);font-size:.82rem;">${idx+1} / ${galleria.length}</span>\n'
    "            <button onclick=\"idx=(idx+1)%galleria.length;renderLightbox()\" style=\"background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:40px;height:40px;font-size:1.2rem;cursor:pointer;\" ${galleria.length<=1?'disabled':''}>›</button>\n"
    '          </div>\n'
    '          <div style="text-align:center;margin-top:8px;">\n'
    "            <button onclick=\"document.getElementById('galleria-lightbox').innerHTML=''\" style=\"background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:20px;padding:6px 20px;cursor:pointer;font-size:.82rem;\">✕ Chiudi</button>\n"
    '          </div>\n'
    '        </div>\n'
    "        <div style=\"display:flex;gap:6px;margin-top:14px;overflow-x:auto;max-width:min(90vw,600px);padding-bottom:4px;\">\n"
    "          ${galleria.map((src,i)=>`<img src=\"${src}\" onclick=\"idx=${i};renderLightbox()\" style=\"width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:${i===idx?1:.45};border:2px solid ${i===idx?'var(--green)':'transparent'};flex-shrink:0;\">`).join('')}\n"
    '        </div>\n'
    '      </div>`;\n'
    '  }\n'
    "  let lb=document.getElementById('galleria-lightbox');\n"
    "  if(!lb){lb=document.createElement('div');lb.id='galleria-lightbox';document.body.appendChild(lb);}\n"
    '  renderLightbox();\n'
    '}'
)
patch('11f: openGalleriaFull function', old_galleria_full, 'function openGalleriaFull(){ /* galleria rimossa */ }')

# 11g: galleria display in openFornitore (socio view)
patch('11g: galleria in openFornitore socio',
    "\n      ${(f.galleria&&f.galleria.length)?`\n"
    '      <div style="margin-top:14px;">\n'
    '        <div style="font-size:.78rem;font-weight:800;color:var(--green-dark);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📸 Galleria</div>\n'
    '        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin;">\n'
    "          ${f.galleria.map((src,i)=>`<img src=\"${src}\" onclick=\"openGalleriaFull(${JSON.stringify(f.galleria)},${i})\" style=\"width:110px;height:110px;object-fit:cover;border-radius:12px;flex-shrink:0;cursor:pointer;border:2px solid var(--green-light);\">`).join('')}\n"
    '        </div>\n'
    '      </div>`:\'\'}',
    ''
)

# 11h: galleria display in openFornitoreOspite (guest view)
patch('11h: galleria in openFornitoreOspite',
    "+((f.galleria&&f.galleria.length)?'<div style=\"margin-top:14px;\"><div style=\"font-size:.78rem;font-weight:800;color:var(--green-dark);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;\">📸 Galleria</div><div style=\"display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin;\">'+f.galleria.map(function(src,i){return '<img src=\"'+src+'\" onclick=\"openGalleriaFull('+JSON.stringify(f.galleria)+','+i+')\" style=\"width:110px;height:110px;object-fit:cover;border-radius:12px;flex-shrink:0;cursor:pointer;border:2px solid var(--green-light);\">';}).join('')+'</div></div>':'')",
    ''
)

# ══════════════════════════════════════════════════════════════════
# PATCH 9 — SUPABASE REAL-TIME SYNC MULTI-ADMIN
# ══════════════════════════════════════════════════════════════════
print('Patch 9: Supabase real-time multi-admin...')

# 9a: Make URL/Key configurable + fix getSupabase
patch('9a: supabase dynamic client',
    "// ════════ SUPABASE INTEGRATION ════════\n"
    "const SUPA_URL = 'https://luhuwhmtaerkwipyilcy.supabase.co';\n"
    "const SUPA_KEY = 'sb_publishable__H0upg9BcaxqYG7U0VwG1A_Uwe5hyFC';\n"
    "let _supaClient = null;\n"
    "\n"
    "function getSupabase(){\n"
    "  if(!_supaClient && window.supabase){\n"
    "    try{ _supaClient = window.supabase.createClient(SUPA_URL, SUPA_KEY); }catch(e){}\n"
    "  }\n"
    "  return _supaClient;\n"
    "}",
    "// ════════ SUPABASE INTEGRATION ════════\n"
    "let _supaClient = null;\n"
    "let _supaUrlUsed = '';\n"
    "let _supaSubscribed = false;\n"
    "\n"
    "function getSupabase(){\n"
    "  const url = (S.config && S.config.supabaseUrl||'').trim();\n"
    "  const key = (S.config && S.config.supabaseKey||'').trim();\n"
    "  if(!url || !key) return null;\n"
    "  if(!_supaClient || _supaUrlUsed !== url){\n"
    "    try{ _supaClient = window.supabase.createClient(url, key); _supaUrlUsed = url; _supaSubscribed = false; }catch(e){ _supaClient=null; }\n"
    "  }\n"
    "  return _supaClient;\n"
    "}"
)

# 9b: syncToSupabase — exclude logoData from sync
patch('9b: sync exclude logoData',
    "    try{\n"
    "      // Non sincronizzare supabasePaused: è preferenza locale del dispositivo\n"
    "      const payloadObj = JSON.parse(JSON.stringify(S));\n"
    "      if(payloadObj.config) payloadObj.config.supabasePaused = false;\n"
    "      const payload = JSON.stringify(payloadObj);\n"
    "      await sb.from('config').upsert(\n"
    "        { chiave:'sgas_app_state', valore:payload, updated_at: new Date().toISOString() },\n"
    "        { onConflict:'chiave' }\n"
    "      );\n"
    "    }catch(e){ console.warn('Supabase sync error:', e); }",
    "    try{\n"
    "      const payloadObj = JSON.parse(JSON.stringify(S));\n"
    "      if(payloadObj.config){\n"
    "        payloadObj.config.supabasePaused = false;\n"
    "        delete payloadObj.config.logoData;    // non sincronizzare il logo (troppo grande)\n"
    "        delete payloadObj.config.logoBase64;\n"
    "      }\n"
    "      const payload = JSON.stringify(payloadObj);\n"
    "      await sb.from('config').upsert(\n"
    "        { chiave:'sgas_app_state', valore:payload, updated_at: new Date().toISOString() },\n"
    "        { onConflict:'chiave' }\n"
    "      );\n"
    "    }catch(e){ console.warn('Supabase sync error:', e); }"
)

# 9c: loadFromSupabase — preserve logo + supabase credentials
patch('9c: loadFromSupabase preserve logo+creds',
    "    S = remote;\n"
    "    // Preserva supabasePaused locale (non sincronizzare da Supabase)\n"
    "    const localPaused = (()=>{ try{ const l=JSON.parse(localStorage.getItem('sgas_state')||'{}'); return l.config && l.config.supabasePaused===true; }catch(e){ return false; } })();\n"
    "    if(!S.config) S.config = {};\n"
    "    S.config.supabasePaused = localPaused;\n"
    "    if(!S.cart) S.cart = {raccoltaId:'', items:[]};",
    "    S = remote;\n"
    "    // Preserva dati locali: logo, credenziali Supabase, stato pausa\n"
    "    const _prevConf = (()=>{ try{ return JSON.parse(localStorage.getItem('sgas_state')||'{}').config||{}; }catch(e){ return {}; } })();\n"
    "    if(!S.config) S.config = {};\n"
    "    S.config.supabasePaused = _prevConf.supabasePaused===true;\n"
    "    S.config.supabaseUrl    = _prevConf.supabaseUrl||'';\n"
    "    S.config.supabaseKey    = _prevConf.supabaseKey||'';\n"
    "    if(_prevConf.logoData)   S.config.logoData   = _prevConf.logoData;\n"
    "    if(_prevConf.logoBase64) S.config.logoBase64 = _prevConf.logoBase64;\n"
    "    if(!S.cart) S.cart = {raccoltaId:'', items:[]};\n"
    "    // Deduplicazione dopo caricamento Supabase\n"
    "    if(S.fornitori){ const _seen={}; S.fornitori=S.fornitori.filter(f=>{ const k=(f.nome||'').toLowerCase().trim(); if(_seen[k])return false; _seen[k]=true; return true; }); }\n"
    "    if(S.prodotti){ const _seenP={}; S.prodotti=S.prodotti.filter(p=>{ const k=(p.nome||'').toLowerCase().trim()+'_'+(p.fornitorId||''); if(_seenP[k])return false; _seenP[k]=true; return true; }); }"
)

# 9d: initSupabase — add real-time subscription
old_init_supa = (
    "async function initSupabase(){\n"
    "  const loaded = await loadFromSupabase();\n"
    "  if(loaded){\n"
    "    applyLogo();\n"
    "    applyAppLink();\n"
    "    const ses = localStorage.getItem('sgas_usr_tok');\n"
    "    if(ses){\n"
    "      try{\n"
    "        const s = JSON.parse(ses);\n"
    "        if(s.type==='admin'){\n"
    "          renderAdminHome();\n"
    "        } else if(s.type==='socio'){\n"
    "          const socio = S.soci.find(x=>x.id===s.socioId);\n"
    "          if(socio) renderSocioHome(socio);\n"
    "        } else if(s.type==='guest'){\n"
    "          renderGuestHome();\n"
    "        }\n"
    "      }catch(e){}\n"
    "    }\n"
    "    toast('☁️ Dati sincronizzati');\n"
    "  }\n"
    "}"
)
new_init_supa = (
    "async function initSupabase(){\n"
    "  const loaded = await loadFromSupabase();\n"
    "  if(loaded){\n"
    "    applyLogo();\n"
    "    applyAppLink();\n"
    "    const ses = localStorage.getItem('sgas_usr_tok');\n"
    "    if(ses){\n"
    "      try{\n"
    "        const s = JSON.parse(ses);\n"
    "        if(s.type==='admin'){\n"
    "          renderAdminHome();\n"
    "        } else if(s.type==='socio'){\n"
    "          const socio = S.soci.find(x=>x.id===s.socioId);\n"
    "          if(socio) renderSocioHome(socio);\n"
    "        } else if(s.type==='guest'){\n"
    "          renderGuestHome();\n"
    "        }\n"
    "      }catch(e){}\n"
    "    }\n"
    "    toast('☁️ Dati sincronizzati');\n"
    "  }\n"
    "  // Sottoscrizione real-time per sync istantaneo tra admin\n"
    "  _subscribeSupabaseRealtime();\n"
    "}\n"
    "\n"
    "function _subscribeSupabaseRealtime(){\n"
    "  if(_supaSubscribed) return;\n"
    "  const sb = getSupabase();\n"
    "  if(!sb) return;\n"
    "  try{\n"
    "    sb.channel('sgas_realtime')\n"
    "      .on('postgres_changes', {\n"
    "        event: 'UPDATE', schema: 'public', table: 'config',\n"
    "        filter: \"chiave=eq.sgas_app_state\"\n"
    "      }, (payload)=>{\n"
    "        try{\n"
    "          const remote = JSON.parse(payload.new.valore);\n"
    "          if(!remote||!remote.config) return;\n"
    "          // Ignora se dati locali sono più recenti\n"
    "          if(S._savedAt && remote._savedAt && S._savedAt >= remote._savedAt) return;\n"
    "          const _prev = S.config||{};\n"
    "          S = remote;\n"
    "          S.config.supabasePaused = _prev.supabasePaused===true;\n"
    "          S.config.supabaseUrl    = _prev.supabaseUrl||'';\n"
    "          S.config.supabaseKey    = _prev.supabaseKey||'';\n"
    "          if(_prev.logoData)   S.config.logoData   = _prev.logoData;\n"
    "          if(_prev.logoBase64) S.config.logoBase64 = _prev.logoBase64;\n"
    "          if(!S.cart) S.cart = {raccoltaId:'', items:[]};\n"
    "          localStorage.setItem('sgas_state', JSON.stringify(S));\n"
    "          // Aggiorna UI admin in tempo reale\n"
    "          if(currentUser && currentUser.type==='admin' && window._currentAdminSec){\n"
    "            setTimeout(()=>{ try{ adminNav(window._currentAdminSec); }catch(e){} }, 200);\n"
    "          }\n"
    "          toast('🔄 Dati aggiornati in tempo reale');\n"
    "        }catch(e){ console.warn('Realtime parse error',e); }\n"
    "      })\n"
    "      .subscribe((status)=>{\n"
    "        if(status==='SUBSCRIBED') _supaSubscribed=true;\n"
    "      });\n"
    "  }catch(e){ console.warn('Realtime subscribe error',e); }\n"
    "}"
)
patch('9d: initSupabase + realtime', old_init_supa, new_init_supa)

# 9e: track current admin section for realtime UI refresh
patch('9e: track _currentAdminSec',
    "  if(panels[sec]) panels[sec]();",
    "  window._currentAdminSec = sec;\n"
    "  if(panels[sec]) panels[sec]();"
)

# 9f: renderSettings Supabase card — add URL/Key fields + test button
old_supa_card = (
    '    <div class="card" style="margin-bottom:16px;border-left:4px solid ${supabasePaused?\'#e57373\':\'var(--green-main)\'}">\n'
    '      <h3 style="font-family:var(--font-serif,serif);margin-bottom:8px;">☁️ Sincronizzazione Supabase</h3>\n'
    '      <p style="font-size:.85rem;color:var(--text-mid);margin-bottom:14px;">\n'
    "        Stato attuale: <strong style=\"color:${supabasePaused?'#e57373':'var(--green-main)'}\">${supabasePaused?'⏸ IN STANDBY — sync disattivata':'✅ ATTIVA — sync in corso'}</strong>\n"
    '      </p>\n'
    '      <div style="display:flex;gap:10px;flex-wrap:wrap;">\n'
    "        <button class=\"btn ${supabasePaused?'btn-primary':'btn-secondary'}\" onclick=\"toggleSupabaseSync()\">\n"
    "          ${supabasePaused?'▶️ Riattiva sincronizzazione':'⏸ Metti in standby'}\n"
    '        </button>\n'
    "        ${supabasePaused?'<span style=\"font-size:.78rem;color:#e57373;align-self:center;\">⚠️ I dati non vengono salvati/caricati da Supabase</span>':''}\n"
    '      </div>\n'
    '    </div>'
)
new_supa_card = (
    '    <div class="card" style="margin-bottom:16px;border-left:4px solid ${!S.config.supabaseUrl?\'#bdbdbd\':supabasePaused?\'#e57373\':\'var(--green-main)\'}">\n'
    '      <h3 style="font-family:var(--font-serif,serif);margin-bottom:8px;">☁️ Supabase — Sync Multi-Admin</h3>\n'
    '      <p style="font-size:.82rem;color:var(--text-mid);margin-bottom:12px;">Sincronizzazione in tempo reale dei dati tra più admin. Tutti i dispositivi vedono le stesse modifiche istantaneamente.</p>\n'
    '      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">\n'
    "        <div style=\"width:10px;height:10px;border-radius:50%;background:${!S.config.supabaseUrl?'#bdbdbd':supabasePaused?'#e57373':'var(--green-main)'};\"></div>\n"
    "        <span style=\"font-size:.85rem;font-weight:700;color:${!S.config.supabaseUrl?'#9e9e9e':supabasePaused?'#e57373':'var(--green-main)'}\">\n"
    "          ${!S.config.supabaseUrl?'⚪ Non configurato':supabasePaused?'⏸ In standby':'✅ Attivo e connesso'}\n"
    '        </span>\n'
    '      </div>\n'
    '      <div class="field" style="margin-bottom:10px;">\n'
    '        <label style="font-size:.78rem;">URL Progetto Supabase</label>\n'
    '        <input id="s-supa-url" type="url" value="${S.config.supabaseUrl||\'\'}" placeholder="https://xxxx.supabase.co" style="font-family:monospace;font-size:.82rem;">\n'
    '      </div>\n'
    '      <div class="field" style="margin-bottom:14px;">\n'
    '        <label style="font-size:.78rem;">Anon/Public Key</label>\n'
    '        <input id="s-supa-key" type="password" value="${S.config.supabaseKey||\'\'}" placeholder="eyJ..." style="font-family:monospace;font-size:.82rem;">\n'
    '        <div style="font-size:.72rem;color:var(--text-light);margin-top:3px;">Usa la chiave <strong>anon/public</strong> (non la service_role). Trovala in Project Settings → API.</div>\n'
    '      </div>\n'
    '      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">\n'
    '        <button class="btn btn-primary btn-sm" onclick="saveSupabaseConfig()">💾 Salva e connetti</button>\n'
    '        <button class="btn btn-secondary btn-sm" onclick="testSupabaseConnection()">🔌 Testa connessione</button>\n'
    "        ${S.config.supabaseUrl?`<button class=\"btn btn-sm ${supabasePaused?'btn-primary':'btn-amber'}\" onclick=\"toggleSupabaseSync()\">${supabasePaused?'▶️ Riattiva':'⏸ Standby'}</button>`:''}\n"
    '      </div>\n'
    '      <details style="font-size:.78rem;color:var(--text-light);">\n'
    '        <summary style="cursor:pointer;font-weight:700;color:var(--green-dark);">📋 Setup Supabase (prima volta)</summary>\n'
    '        <div style="margin-top:10px;background:#f9f9f9;border-radius:8px;padding:12px;">\n'
    '          <p style="margin-bottom:8px;">1. Crea un progetto su <strong>supabase.com</strong> (piano Free ok)</p>\n'
    '          <p style="margin-bottom:8px;">2. Vai in <strong>SQL Editor</strong> ed esegui:</p>\n'
    '          <pre style="background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px;overflow-x:auto;font-size:.75rem;white-space:pre-wrap;">CREATE TABLE config (\n'
    '  chiave text PRIMARY KEY,\n'
    '  valore text NOT NULL,\n'
    '  updated_at timestamptz DEFAULT now()\n'
    ');\n'
    'ALTER TABLE config ENABLE ROW LEVEL SECURITY;\n'
    'CREATE POLICY "public_rw" ON config FOR ALL TO anon USING (true) WITH CHECK (true);\n'
    'ALTER PUBLICATION supabase_realtime ADD TABLE config;\n'
    "INSERT INTO config (chiave,valore) VALUES ('sgas_app_state','{}');</pre>\n"
    '          <p style="margin-top:8px;">3. In <strong>Project Settings → API</strong> copia URL e chiave <em>anon/public</em></p>\n'
    '          <p style="margin-top:8px;">4. Incolla i valori sopra e clicca <strong>Salva e connetti</strong></p>\n'
    '        </div>\n'
    '      </details>\n'
    '    </div>'
)
patch('9f: renderSettings supabase card', old_supa_card, new_supa_card)

# 9g: add saveSupabaseConfig + testSupabaseConnection functions
# Add them before toggleSupabaseSync
old_toggle = 'function toggleSupabaseSync(){'
new_toggle_prefix = (
    "async function saveSupabaseConfig(){\n"
    "  const url = (document.getElementById('s-supa-url').value||'').trim();\n"
    "  const key = (document.getElementById('s-supa-key').value||'').trim();\n"
    "  if(!url||!key){ toast('⚠️ Inserisci URL e chiave Supabase'); return; }\n"
    "  S.config.supabaseUrl    = url;\n"
    "  S.config.supabaseKey    = key;\n"
    "  S.config.supabasePaused = false;\n"
    "  _supaClient = null; _supaSubscribed = false; // reset per riconnettere\n"
    "  saveState();\n"
    "  toast('💾 Configurazione salvata — connessione in corso...');\n"
    "  await initSupabase();\n"
    "  renderSettings();\n"
    "}\n"
    "\n"
    "async function testSupabaseConnection(){\n"
    "  const sb = getSupabase();\n"
    "  if(!sb){ toast('⚠️ Configura URL e chiave prima'); return; }\n"
    "  try{\n"
    "    const { data, error } = await sb.from('config').select('chiave').limit(1);\n"
    "    if(error) toast('❌ Errore: '+error.message);\n"
    "    else toast('✅ Connessione a Supabase OK!');\n"
    "  }catch(e){ toast('❌ Connessione fallita: '+e.message); }\n"
    "}\n"
    "\n"
)
patch('9g: saveSupabaseConfig + testSupabaseConnection',
    old_toggle,
    new_toggle_prefix + old_toggle)

# ══════════════════════════════════════════════════════════════════
# PATCH 12b — ICONA MANCANTE ASSISTENZA SOCIO
# ══════════════════════════════════════════════════════════════════
print('Patch 12b: icona assistenza socio...')
patch('12b: icona assistenza socio',
    "          <span class=\"assist-ico\"></span>\n"
    "          <div><div>Assistenza Socio</div>",
    "          <span class=\"assist-ico\">🪪</span>\n"
    "          <div><div>Assistenza Socio</div>"
)

# ══════════════════════════════════════════════════════════════════
# PATCH 12 — CAMPI CONTATTO FORNITORE NEL FORM ADMIN
# ══════════════════════════════════════════════════════════════════
print('Patch 12: campi contatto fornitore nel form admin...')

# 12a: aggiungi campi contatto in fornForm (dopo il campo Vision)
patch('12a: campi contatto in fornForm',
    "    <div class=\"field\"><label>Vision / Frase ispiratrice</label><input id=\"m-fvis\" type=\"text\" value=\"${f.vision||''}\" placeholder=\"La nostra filosofia...\"></div>\n"
    "    `;\n"
    "}",
    "    <div class=\"field\"><label>Vision / Frase ispiratrice</label><input id=\"m-fvis\" type=\"text\" value=\"${f.vision||''}\" placeholder=\"La nostra filosofia...\"></div>\n"
    "    <div class=\"field\" style=\"margin-top:16px;border-top:1px solid var(--green-light);padding-top:14px;\">\n"
    "      <label style=\"display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;\">\n"
    "        <input type=\"checkbox\" id=\"m-fcontatto\" ${f.contattodiretto?'checked':''} onchange=\"document.getElementById('m-fcontatto-fields').style.display=this.checked?'block':'none'\" style=\"width:18px;height:18px;\">\n"
    "        <span>📞 Contatto diretto (fornitore servizi)</span>\n"
    "      </label>\n"
    "    </div>\n"
    "    <div id=\"m-fcontatto-fields\" style=\"display:${f.contattodiretto?'block':'none'}\">\n"
    "      <div class=\"field\"><label>Nome referente</label><input id=\"m-fnome-contatto\" type=\"text\" value=\"${f.nomeContatto||''}\" placeholder=\"es. Mario Rossi\"></div>\n"
    "      <div class=\"field\"><label>Telefono</label><input id=\"m-ftel\" type=\"tel\" value=\"${f.telefono||''}\" placeholder=\"es. 3401234567\"></div>\n"
    "      <div class=\"field\"><label>WhatsApp <span style=\"font-weight:400;font-size:.78rem;\">(lascia vuoto se uguale al tel.)</span></label><input id=\"m-fwa\" type=\"tel\" value=\"${f.whatsapp||''}\" placeholder=\"es. 3401234567\"></div>\n"
    "      <div class=\"field\"><label>Email contatto</label><input id=\"m-femail-contatto\" type=\"email\" value=\"${f.emailContatto||''}\" placeholder=\"es. info@fornitore.it\"></div>\n"
    "      <div class=\"field\"><label>Indirizzo</label><input id=\"m-findirizzo\" type=\"text\" value=\"${f.indirizzoContatto||''}\" placeholder=\"es. Via Roma 1, Milano\"></div>\n"
    "    </div>\n"
    "    `;\n"
    "}"
)

# 12b: salva i campi contatto in saveFornitore
patch('12b: salva campi contatto in saveFornitore',
    "    logo:logoVal||null,\n"
    "    attivo:true\n"
    "  };",
    "    logo:logoVal||null,\n"
    "    attivo:true,\n"
    "    contattodiretto:document.getElementById('m-fcontatto')?.checked||false,\n"
    "    nomeContatto:document.getElementById('m-fnome-contatto')?.value.trim()||null,\n"
    "    telefono:document.getElementById('m-ftel')?.value.trim()||null,\n"
    "    whatsapp:document.getElementById('m-fwa')?.value.trim()||null,\n"
    "    emailContatto:document.getElementById('m-femail-contatto')?.value.trim()||null,\n"
    "    indirizzoContatto:document.getElementById('m-findirizzo')?.value.trim()||null\n"
    "  };"
)

# ══════════════════════════════════════════════════════════════════
# PATCH 13 — DOCUMENTO WORD PER IL SOCIO ALL'INVIO ORDINE
# ══════════════════════════════════════════════════════════════════
print('Patch 13: documento Word per socio...')

# 13a: sostituisce exportOrderExcel con exportOrderWord
old_export_excel = (
    "function exportOrderExcel(ord){\n"
    "  // Simple CSV download as fallback (SheetJS not always available in file mode)\n"
    "  const rows=[\n"
    "    ['ORDINE',ord.id,'','','',''],\n"
    "    ['Data',new Date(ord.data).toLocaleDateString('it-IT'),'','','',''],\n"
    "    ['Nome',ord.socioNome||'','Cognome',ord.socioCognome||'','',''],\n"
    "    ['Cellulare',ord.socioCellulare||'','Telegram',ord.socioTelegram?'@'+ord.socioTelegram:'','',''],\n"
    "    [],\n"
    "    ['Codice','Prodotto','Fornitore','Qty','Prezzo unitario','Totale riga']\n"
    "  ];\n"
    "  ord.items.forEach(i=>{\n"
    "    const p=S.prodotti.find(x=>x.id===i.prodottoId);\n"
    "    const f=p?S.fornitori.find(x=>x.id===p.fornitorId):null;\n"
    "    rows.push([p?(p.codice||''):'',p?p.nome:'?',f?f.nome:'?',i.qty,p?p.prezzo:0,p?p.prezzo*i.qty:0]);\n"
    "  });\n"
    "  rows.push([]);\n"
    "  rows.push(['','TOTALE','','','',ord.totale]);\n"
    "  const csv=rows.map(r=>r.join(';')).join('\\n');\n"
    "  const blob=new Blob(['\\uFEFF'+csv],{type:'text/csv;charset=utf-8'});\n"
    "  const a=document.createElement('a');\n"
    "  a.href=URL.createObjectURL(blob);\n"
    "  a.download=`${ord.id}_${(ord.socioNome||'').replace(/\\s/g,'_')}.csv`;\n"
    "  a.click();\n"
    "}"
)
new_export_word = (
    "function exportOrderExcel(ord){\n"
    "  // mantenuta per compatibilità admin download CSV\n"
    "  const rows=[\n"
    "    ['ORDINE',ord.id,'','','',''],\n"
    "    ['Data',new Date(ord.data).toLocaleDateString('it-IT'),'','','',''],\n"
    "    ['Nome',ord.socioNome||'','Cognome',ord.socioCognome||'','',''],\n"
    "    ['Cellulare',ord.socioCellulare||'','Telegram',ord.socioTelegram?'@'+ord.socioTelegram:'','',''],\n"
    "    [],\n"
    "    ['Codice','Prodotto','Fornitore','Qty','Prezzo unitario','Totale riga']\n"
    "  ];\n"
    "  ord.items.forEach(i=>{\n"
    "    const p=S.prodotti.find(x=>x.id===i.prodottoId);\n"
    "    const f=p?S.fornitori.find(x=>x.id===p.fornitorId):null;\n"
    "    rows.push([p?(p.codice||''):'',p?p.nome:'?',f?f.nome:'?',i.qty,p?p.prezzo:0,p?p.prezzo*i.qty:0]);\n"
    "  });\n"
    "  rows.push([]);\n"
    "  rows.push(['','TOTALE','','','',ord.totale]);\n"
    "  const csv=rows.map(r=>r.join(';')).join('\\n');\n"
    "  const blob=new Blob(['\\uFEFF'+csv],{type:'text/csv;charset=utf-8'});\n"
    "  const a=document.createElement('a');\n"
    "  a.href=URL.createObjectURL(blob);\n"
    "  a.download=`${ord.id}_${(ord.socioNome||'').replace(/\\s/g,'_')}.csv`;\n"
    "  a.click();\n"
    "}\n"
    "\n"
    "function exportOrderWord(ord){\n"
    "  const gasName = S.config.gasName||'S-GAS Freeconomy';\n"
    "  const racc = S.raccolte.find(r=>r.id===ord.raccoltaId);\n"
    "  const socio = S.soci.find(s=>s.id===ord.socioId);\n"
    "  const tessera = socio?socio.tessera:'';\n"
    "  // colonne: Codice | Prodotto | Fornitore | Qty | €/unit | Totale\n"
    "  const colW=[1200,3200,2400,700,900,1100];\n"
    "  const hdr=c=>new TableCell({shading:{fill:'1B5E20'},margins:{top:60,bottom:60,left:80,right:80},\n"
    "    children:[new Paragraph({alignment:AlignmentType.CENTER,\n"
    "      children:[new TextRun({text:c,bold:true,color:'FFFFFF',size:18,font:'Arial'})]})]});\n"
    "  const cel=(c,align=AlignmentType.LEFT)=>new TableCell({margins:{top:50,bottom:50,left:80,right:80},\n"
    "    children:[new Paragraph({alignment:align,\n"
    "      children:[new TextRun({text:String(c),size:18,font:'Arial'})]})]});\n"
    "  const headerRow=new TableRow({children:[\n"
    "    hdr('Codice'),hdr('Prodotto'),hdr('Fornitore'),hdr('Qta'),hdr('€/unit'),hdr('Totale')\n"
    "  ]});\n"
    "  const dataRows=ord.items.map((i,idx)=>{\n"
    "    const p=S.prodotti.find(x=>x.id===i.prodottoId);\n"
    "    const f=p?S.fornitori.find(x=>x.id===p.fornitorId):null;\n"
    "    const bg=idx%2===0?'FFFFFF':'F1F8E9';\n"
    "    const mkCell=(c,align=AlignmentType.LEFT)=>new TableCell({\n"
    "      shading:{fill:bg},margins:{top:50,bottom:50,left:80,right:80},\n"
    "      children:[new Paragraph({alignment:align,children:[new TextRun({text:String(c),size:18,font:'Arial'})]})]});\n"
    "    return new TableRow({children:[\n"
    "      mkCell(p?(p.codice||''):''),\n"
    "      mkCell(p?p.nome:'?'),\n"
    "      mkCell(f?f.nome:'?'),\n"
    "      mkCell(i.qty,AlignmentType.CENTER),\n"
    "      mkCell(p?'€'+p.prezzo.toFixed(2):'',AlignmentType.RIGHT),\n"
    "      mkCell(p?'€'+(p.prezzo*i.qty).toFixed(2):'',AlignmentType.RIGHT)\n"
    "    ]});\n"
    "  });\n"
    "  const totalRow=new TableRow({children:[\n"
    "    new TableCell({columnSpan:5,shading:{fill:'E8F5E9'},margins:{top:60,bottom:60,left:80,right:80},\n"
    "      children:[new Paragraph({alignment:AlignmentType.RIGHT,\n"
    "        children:[new TextRun({text:'TOTALE ORDINE',bold:true,size:20,font:'Arial'})]})]  }),\n"
    "    new TableCell({shading:{fill:'E8F5E9'},margins:{top:60,bottom:60,left:80,right:80},\n"
    "      children:[new Paragraph({alignment:AlignmentType.RIGHT,\n"
    "        children:[new TextRun({text:'€ '+ord.totale.toFixed(2),bold:true,size:20,font:'Arial',color:'1B5E20'})]})]})\n"
    "  ]});\n"
    "  const mainTable=new Table({width:{size:9620,type:WidthType.DXA},columnWidths:colW,\n"
    "    rows:[headerRow,...dataRows,totalRow]});\n"
    "  const children=[];\n"
    "  const logoData=S.config.logoBase64||S.config.logoData;\n"
    "  if(logoData&&logoData.startsWith('data:')){\n"
    "    try{\n"
    "      const b64=logoData.split(',')[1];\n"
    "      const imgType=logoData.includes('png')?'png':'jpg';\n"
    "      const bin=atob(b64);const bytes=new Uint8Array(bin.length);\n"
    "      for(let j=0;j<bin.length;j++) bytes[j]=bin.charCodeAt(j);\n"
    "      children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:120},\n"
    "        children:[new ImageRun({data:bytes,transformation:{width:70,height:70},type:imgType})]}));\n"
    "    }catch(e){}\n"
    "  }\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},\n"
    "    children:[new TextRun({text:gasName,bold:true,size:36,font:'Arial',color:'1B5E20'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},\n"
    "    children:[new TextRun({text:'Conferma Ordine',size:26,font:'Arial',color:'2E7D32'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'N° Ordine: '+ord.id,bold:true,size:22,font:'Arial'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'Data: '+new Date(ord.data).toLocaleDateString('it-IT'),size:22,font:'Arial'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'Raccolta: '+(racc?racc.nome:ord.raccoltaId),size:22,font:'Arial'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},\n"
    "    children:[new TextRun({text:'Socio: '+ord.socioNome+' '+ord.socioCognome+(tessera?' — Tessera: '+tessera:''),size:22,font:'Arial'})]}));\n"
    "  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:280},\n"
    "    children:[new TextRun({text:'Cellulare: '+(ord.socioCellulare||'—'),size:22,font:'Arial'})]}));\n"
    "  children.push(mainTable);\n"
    "  children.push(new Paragraph({spacing:{before:200},\n"
    "    children:[new TextRun({text:'Grazie per il tuo ordine! Riceverai conferma via Telegram.',size:18,font:'Arial',color:'555555',italics:true})]}));\n"
    "  const doc=new Document({sections:[{\n"
    "    properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},\n"
    "    children\n"
    "  }]});\n"
    "  Packer.toBlob(doc).then(blob=>{\n"
    "    const fname=ord.id+'_'+(ord.socioNome||'').replace(/\\s/g,'_')+'.docx';\n"
    "    const url=URL.createObjectURL(blob);\n"
    "    const a=document.createElement('a');\n"
    "    a.href=url;a.download=fname;a.click();\n"
    "    URL.revokeObjectURL(url);\n"
    "  }).catch(e=>{console.error(e);toast('⚠️ Word non generato, riprova');});\n"
    "}"
)
patch('13a: exportOrderWord per socio', old_export_excel, new_export_word)

# 13b: chiama exportOrderWord invece di exportOrderExcel in submitOrder
patch('13b: chiama exportOrderWord in submitOrder',
    "  exportOrderExcel(ord);\n"
    "  sendOrderEmail(ord);",
    "  exportOrderWord(ord);\n"
    "  sendOrderEmail(ord);"
)

# 13c: aggiorna toast da "Excel scaricato" a "Word scaricato"
patch('13c: toast Word in submitOrder',
    "  toast('✅ Ordine inviato! Excel scaricato.');",
    "  toast('✅ Ordine inviato! Documento Word scaricato.');"
)

# 13d: wrap exportOrderWord in try-catch in submitOrder so order always confirms
patch('13d: try-catch exportOrderWord in submitOrder',
    "  exportOrderWord(ord);\n"
    "  sendOrderEmail(ord);",
    "  try{ exportOrderWord(ord); }catch(e){ console.warn('Word gen error:',e); }\n"
    "  sendOrderEmail(ord);"
)

# 13e: fix exportOrderWord — check window.docx and destructure before use
patch('13e: fix exportOrderWord window.docx destructuring',
    "function exportOrderWord(ord){\n"
    "  const gasName = S.config.gasName||'S-GAS Freeconomy';\n",
    "function exportOrderWord(ord){\n"
    "  if(!window.docx||!window.docx.Document){ console.warn('docx library not ready'); return; }\n"
    "  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,\n"
    "         AlignmentType,WidthType,ImageRun} = window.docx;\n"
    "  const gasName = S.config.gasName||'S-GAS Freeconomy';\n"
)

# 14: Ribilancia Banner↔Quadrato nel form fornitore
# 14a: aggiungi pulsante ribilancia nel template fornForm
patch('14a: pulsante ribilancia logo fornForm',
    '<label class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-block;">📷 Carica logo'
    '<input type="file" accept="image/*" style="display:none;" onchange="previewFornLogo(event)"></label>\n'
    '    </div>',
    '<label class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-block;">📷 Carica logo'
    '<input type="file" accept="image/*" style="display:none;" onchange="previewFornLogo(event)"></label>\n'
    '      <div id="m-flogo-rebalance-wrap" style="display:none;margin-top:8px;">\n'
    '        <button type="button" class="btn btn-xs btn-secondary" onclick="ribilanciaFornLogo()">⚖️ Ribilancia Banner↔Quadrato</button>\n'
    '        <span id="m-flogo-mode-label" style="font-size:.75rem;color:var(--text-mid);margin-left:8px;"></span>\n'
    '      </div>\n'
    '    </div>'
)

# 14b: variabili _fornLogoOrig e _fornIsBanner
patch('14b: _fornLogoOrig + _fornIsBanner vars',
    'let _fornLogo = null;\n'
    '\n'
    'function previewFornLogo(ev){',
    'let _fornLogo = null;\n'
    'let _fornLogoOrig = null;\n'
    'let _fornIsBanner = null;\n'
    '\n'
    'function previewFornLogo(ev){'
)

# 14c: refactoring previewFornLogo + nuove funzioni
old_preview_fn = (
    "function previewFornLogo(ev){\n"
    "  const file=ev.target.files[0];\n"
    "  if(!file) return;\n"
    "  if(file.size>5*1024*1024){toast('Immagine troppo grande (max 5 MB)');return;}\n"
    "  const reader=new FileReader();\n"
    "  reader.onload=e=>{\n"
    "    const img=new Image();\n"
    "    img.onload=function(){\n"
    "      // Determina se è un banner panoramico o un logo quadrato\n"
    "      const isBanner = img.width > img.height * 1.8;\n"
    "      const maxW = isBanner ? 1200 : 400;\n"
    "      const maxH = isBanner ? 400  : 400;\n"
    "      let w=img.width, h=img.height;\n"
    "      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}\n"
    "      if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}\n"
    "      const cvs=document.createElement('canvas');\n"
    "      cvs.width=w; cvs.height=h;\n"
    "      cvs.getContext('2d').drawImage(img,0,0,w,h);\n"
    "      const optimized=cvs.toDataURL('image/jpeg',0.82);\n"
    "      _fornLogo=optimized;\n"
    "      const prev=document.getElementById('m-flogo-preview');\n"
    "      if(prev){prev.src=optimized;prev.style.display='block';}\n"
    "      const kb=Math.round(optimized.length*0.75/1024);\n"
    "      toast('✅ Immagine ottimizzata: '+w+'×'+h+'px — '+kb+'KB');\n"
    "    };\n"
    "    img.src=e.target.result;\n"
    "  };\n"
    "  reader.readAsDataURL(file);\n"
    "}"
)
new_preview_fn = (
    "function previewFornLogo(ev){\n"
    "  const file=ev.target.files[0];\n"
    "  if(!file) return;\n"
    "  if(file.size>5*1024*1024){toast('Immagine troppo grande (max 5 MB)');return;}\n"
    "  const reader=new FileReader();\n"
    "  reader.onload=e=>{\n"
    "    _fornLogoOrig = e.target.result;\n"
    "    const img=new Image();\n"
    "    img.onload=function(){\n"
    "      _fornIsBanner = img.width > img.height * 1.8;\n"
    "      _applyFornLogoResize(img, _fornIsBanner);\n"
    "    };\n"
    "    img.src=e.target.result;\n"
    "  };\n"
    "  reader.readAsDataURL(file);\n"
    "}\n"
    "\n"
    "function _applyFornLogoResize(img, isBanner){\n"
    "  const maxW = isBanner ? 1200 : 400;\n"
    "  const maxH = isBanner ? 400  : 400;\n"
    "  let w=img.width, h=img.height;\n"
    "  if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}\n"
    "  if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}\n"
    "  const cvs=document.createElement('canvas');\n"
    "  cvs.width=w; cvs.height=h;\n"
    "  cvs.getContext('2d').drawImage(img,0,0,w,h);\n"
    "  const optimized=cvs.toDataURL('image/jpeg',0.82);\n"
    "  _fornLogo=optimized;\n"
    "  const prev=document.getElementById('m-flogo-preview');\n"
    "  const previewW = isBanner ? '160px' : '80px';\n"
    "  const previewH = isBanner ? '60px'  : '80px';\n"
    "  if(prev){prev.src=optimized;prev.style.display='block';prev.style.width=previewW;prev.style.height=previewH;}\n"
    "  const wrap=document.getElementById('m-flogo-rebalance-wrap');\n"
    "  if(wrap) wrap.style.display='block';\n"
    "  const lbl=document.getElementById('m-flogo-mode-label');\n"
    "  if(lbl) lbl.textContent = isBanner ? '📐 Modalità: Banner panoramico (1200×400)' : '📐 Modalità: Logo quadrato (400×400)';\n"
    "  const kb=Math.round(optimized.length*0.75/1024);\n"
    "  toast('✅ '+(isBanner?'Banner':'Logo')+': '+w+'×'+h+'px — '+kb+'KB');\n"
    "}\n"
    "\n"
    "function ribilanciaFornLogo(){\n"
    "  if(!_fornLogoOrig){ toast('⚠️ Ricarica prima una nuova immagine'); return; }\n"
    "  const img=new Image();\n"
    "  img.onload=function(){\n"
    "    _fornIsBanner = !_fornIsBanner;\n"
    "    _applyFornLogoResize(img, _fornIsBanner);\n"
    "  };\n"
    "  img.src=_fornLogoOrig;\n"
    "}"
)
patch('14c: previewFornLogo refactor + ribilanciaFornLogo', old_preview_fn, new_preview_fn)

# ══════════════════════════════════════════════════════════════════
# WRITE
# ══════════════════════════════════════════════════════════════════
print('\nWriting output...')
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'\n✅ {OUT}  ({len(html):,} bytes)\n')
print('Patches applied:')
for p in ok: print(f'  ✅ {p}')
