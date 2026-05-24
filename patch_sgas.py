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
    html = html[:idx_os] + html[idx_end+len('}\n\n'):]
    ok.append('4: OneSignal block')
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
    "    if(!S.cart) S.cart = {raccoltaId:'', items:[]};"
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
# WRITE
# ══════════════════════════════════════════════════════════════════
print('\nWriting output...')
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'\n✅ {OUT}  ({len(html):,} bytes)\n')
print('Patches applied:')
for p in ok: print(f'  ✅ {p}')
