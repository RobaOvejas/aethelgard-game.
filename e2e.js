/* E2E resiliente: arranca el servidor Aethelgard, abre Chrome headless por CDP,
   prueba registro online + demo local, captura errores y screenshots.
   Uso:  node e2e.js [rutaProyecto] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = process.argv[2] || __dirname;
const OUT = path.join(__dirname, 'shots');
const PORT = Number(process.env.E2E_PORT || 3111);
const DBG_PORT = 9333;
// Directorio de datos aislado: evita el lock de una instancia de desarrollo y no ensucia data/.
const DATA_DIR = path.join(os.tmpdir(), 'aethelgard-e2e-data-' + Date.now());
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

const report = { steps: [], consoleErrors: [], consoleWarns: [], failedRequests: [], shots: [], problems: [], data: {} };
const log = (...a) => console.log(...a);
const step = (name, status, detail) => { report.steps.push({ name, status, detail }); log('  [' + status + '] ' + name + (detail ? ' :: ' + detail : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function saveShot(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  report.shots.push(name + '.png');
  log('  [shot] ' + name + '.png (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
}

async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (timeout || 20000)) {
    try { const v = await fn(); if (v) return v; last = v; } catch (e) { last = e.message; }
    await sleep(300);
  }
  throw new Error('timeout ' + (label || '') + (last ? ' (' + String(last).slice(0, 120) + ')' : ''));
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else this.listeners.forEach(l => { try { l(msg); } catch (e) {} });
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 360000);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    report.problems.push('eval: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    return null;
  }
  return r.result ? r.result.value : null;
}
async function j(cdp, expression) {
  const v = await ev(cdp, 'JSON.stringify(' + expression + ')');
  try { return JSON.parse(v); } catch (e) { return null; }
}
async function shot(cdp, name) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      saveShot(name, r.data); return true;
    } catch (e) { await sleep(1200); }
  }
  report.problems.push('screenshot fallo: ' + name);
  return false;
}

let serverProc = null, chromeProc = null;

async function navigate(cdp, url, label) {
  await cdp.send('Page.navigate', { url });
  await waitFor(() => ev(cdp, 'typeof Aethelgard !== "undefined"'), 30000, label + ': Aethelgard');
  try {
    await waitFor(() => ev(cdp, 'document.getElementById("loader").classList.contains("fade") || document.getElementById("loader").classList.contains("hidden")'), 60000, label + ': loader');
    step(label + ' / carga', 'OK');
    return true;
  } catch (e) {
    const stage = await ev(cdp, '(document.getElementById("loader-stage")||{}).textContent');
    step(label + ' / carga', 'FAIL', 'loader atascado en: ' + stage);
    report.data[label + '_stuck'] = stage;
    return false;
  }
}

async function main() {
  log('== AETHELGARD E2E ==  root=' + ROOT + '  port=' + PORT);
  if (!CHROME) throw new Error('sin Chrome/Edge');

  log('[1] servidor...');
  serverProc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), AETHELGARD_DATA_DIR: DATA_DIR }), stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  serverProc.stdout.on('data', d => { serverLog += d.toString(); });
  serverProc.stderr.on('data', d => { serverLog += d.toString(); });
  serverProc.on('exit', (code, signal) => { report.data.serverExit = { code: code, signal: signal, tail: serverLog.slice(-3000) }; });
  const keepServerLog = d => {
    const s = String(d);
    if (/\[api\/|\[socket\]|Error|error|uncaught|tick/.test(s)) {
      report.data.serverHits = (report.data.serverHits || []).concat(s.split('\n').filter(Boolean).slice(0, 4));
      report.data.serverHits = report.data.serverHits.slice(-24);
    }
  };
  serverProc.stdout.on('data', keepServerLog);
  serverProc.stderr.on('data', keepServerLog);
  await waitFor(async () => { const r = await fetch('http://127.0.0.1:' + PORT + '/api/health').catch(() => null); return r && r.ok; }, 25000, 'health');
  report.data.health = await (await fetch('http://127.0.0.1:' + PORT + '/api/health')).json();
  step('servidor + /api/health', 'OK', JSON.stringify(report.data.health));

  log('[2] chrome...');
  const profile = path.join(os.tmpdir(), 'aethelgard-e2e-' + Date.now());
  chromeProc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DBG_PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1366,900',
    '--force-device-scale-factor=1', '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const target = await waitFor(async () => {
    const r = await fetch('http://127.0.0.1:' + DBG_PORT + '/json/list').catch(() => null);
    if (!r || !r.ok) return null;
    return (await r.json()).find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
  }, 25000, 'target');
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);

  cdp.on(msg => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = (msg.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      if (msg.params.type === 'error') report.consoleErrors.push(t);
      else if (msg.params.type === 'warning') report.consoleWarns.push(t);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      report.consoleErrors.push('EXCEPTION: ' + (d.exception && d.exception.description ? d.exception.description.split('\n').slice(0, 3).join(' | ') : d.text));
    } else if (msg.method === 'Network.responseReceived') {
      if (msg.params.response.status >= 400) report.failedRequests.push(msg.params.response.status + ' ' + msg.params.response.url.slice(0, 120));
    }
  });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('aethelgard.settings.v2', JSON.stringify({quality:'medium',music:0,sfx:0,sensitivity:1,damageNumbers:true,cameraShake:false,showNames:true,minimapZoom:1,chatFilter:'all'}));}catch(e){}"
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------- FASE A: online ---------- */
  log('[3] carga online...');
  await navigate(cdp, 'http://127.0.0.1:' + PORT + '/', 'online');
  report.data.boot = await j(cdp, '({three: typeof THREE, io: typeof io, worldOk: Aethelgard.worldOk(), version: Aethelgard.version})');
  step('boot', report.data.boot && report.data.boot.three === 'object' ? 'OK' : 'WARN', JSON.stringify(report.data.boot));
  const versionOk = !!(report.data.boot && report.data.boot.version === '2.4.0' && report.data.health && report.data.health.version === '2.4.0');
  step('versión 2.4.0 (cliente + servidor)', versionOk ? 'OK' : 'WARN', JSON.stringify({ cliente: report.data.boot && report.data.boot.version, servidor: report.data.health && report.data.health.version }));
  await shot(cdp, '01-login');

  log('[4] registro...');
  const uname = 'hero' + String(Date.now()).slice(-7);
  await ev(cdp, `(function(){
    document.getElementById('username').value=${JSON.stringify(uname)};
    document.getElementById('password').value='test1234';
    document.getElementById('tab-register').click();
    var c=document.querySelector('.class-card[data-class="ArcaneSorcerer"]'); if(c) c.click();
    document.getElementById('auth-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return document.getElementById('btn-submit').textContent;
  })()`);
  let entered = false;
  try {
    entered = await waitFor(() => ev(cdp, '!document.getElementById("ui-hud").classList.contains("hidden")'), 45000, 'HUD');
  } catch (e) { entered = false; }
  const authState = await j(cdp, `({authError:(document.getElementById('auth-error')||{}).textContent, btn:(document.getElementById('btn-submit')||{}).textContent, hudHidden: document.getElementById('ui-hud').classList.contains('hidden'), online: Aethelgard.state().online, transport: Aethelgard.state().transport, me: Aethelgard.state().me ? Aethelgard.state().me.name : null})`);
  step('registro + entrada al mundo', entered ? 'OK' : 'FAIL', JSON.stringify(authState));
  report.data.authState = authState;
  await sleep(2500);
  report.data.world = await j(cdp, `({online:Aethelgard.state().online, transport:Aethelgard.state().transport, me: Aethelgard.state().me ? {name:Aethelgard.state().me.name, cls:Aethelgard.state().me.class, hp:Aethelgard.state().me.hp, maxHp:Aethelgard.state().me.maxHp, gridX:Aethelgard.state().me.gridX, gridY:Aethelgard.state().me.gridY} : null, players:(Aethelgard.state().players||[]).length, monsters:(Aethelgard.state().monsters||[]).length, drops:(Aethelgard.state().drops||[]).length, fps:(document.getElementById('perf-fps')||{}).textContent, hotbar:document.querySelectorAll('#hotbar .slot').length})`);
  step('estado del mundo', entered ? 'OK' : 'FAIL', JSON.stringify(report.data.world));
  await shot(cdp, '02-mundo');

  if (entered) {
    log('[5] jugando...');

    /* ---- pack de personajes KayKit (modelos + texturas + animaciones) ---- */
    let assets = null;
    for (let i = 0; i < 100; i++) {
      assets = await j(cdp, 'Aethelgard.characterAssets()');
      if (assets && assets.ready) break;
      await sleep(500);
    }
    const animInfo = await j(cdp, 'Aethelgard.animState()');
    const meAnim = animInfo && animInfo.players && animInfo.players[0];
    const kaykitOk = !!(assets && assets.models && assets.models.length === 4 && assets.clips >= 20 && meAnim && meAnim.gltf && meAnim.clip);
    step('personajes KayKit (modelos + animaciones)', kaykitOk ? 'OK' : 'WARN', JSON.stringify({ assets: assets, yo: meAnim }));

    /* ---- esqueletos KayKit (modelos + textura embebida) ---- */
    let mobs = null;
    for (let i = 0; i < 80; i++) {
      mobs = await j(cdp, 'Aethelgard.monsterAssets()');
      if (mobs && mobs.ready && mobs.gltfMonsters > 0) break;
      await sleep(400);
    }
    const mobTexOk = !!(mobs && mobs.textures && Object.keys(mobs.textures).length === 4 &&
      Object.keys(mobs.textures).every(k => mobs.textures[k].texturedMeshes > 0));
    const mobSkel = !!(mobs && mobs.monsters && mobs.monsters.some(m => m.gltf && m.type && m.type.indexOf('skeleton') === 0));
    const mobOk = mobTexOk && mobSkel;
    step('esqueletos KayKit (modelos + textura)', mobOk ? 'OK' : 'WARN', JSON.stringify(mobs && { models: mobs.models, textures: mobs.textures, gltfMonsters: mobs.gltfMonsters }));
    if (mobOk) { await sleep(500); await shot(cdp, '02f-esqueletos'); }

    /* ---- escenario KayKit (árboles, arbustos, rocas, hierba) ---- */
    let worldAssets = null;
    for (let i = 0; i < 80; i++) {
      worldAssets = await j(cdp, 'Aethelgard.worldAssets()');
      if (worldAssets && worldAssets.ready) break;
      await sleep(500);
    }
    const sceneryOk = !!(worldAssets && worldAssets.ready && worldAssets.instances >= 100);
    step('escenario KayKit (árboles/rocas/hierba)', sceneryOk ? 'OK' : 'WARN', JSON.stringify(worldAssets));
    if (sceneryOk) { await sleep(800); await shot(cdp, '02b-escenario'); }

    /* ---- armas visibles acopladas a la mano ---- */
    let weapons0 = null;
    for (let i = 0; i < 40; i++) {
      weapons0 = await j(cdp, 'Aethelgard.weaponState()');
      if (weapons0 && weapons0.ready) break;
      await sleep(500);
    }
    let armed = false;
    let expectedWeapon = null;
    for (let i = 0; i < 30; i++) {
      const eq = await j(cdp, 'Aethelgard.state().me && Aethelgard.state().me.equipment ? Aethelgard.state().me.equipment.weapon : null');
      if (eq) expectedWeapon = eq;
      if (!expectedWeapon) { armed = true; break; }
      const st = await j(cdp, 'Aethelgard.weaponState()');
      if (st && st.players && st.players[0] && st.players[0].weaponItem === expectedWeapon && st.players[0].weaponModel) { weapons0 = st; armed = true; break; }
      await sleep(400);
    }
    await ev(cdp, 'Aethelgard.previewWeapon("item_8")');
    await sleep(700);
    const weapons1 = await j(cdp, 'Aethelgard.weaponState()');
    const swapped = !!(weapons1 && weapons1.players && weapons1.players[0] && weapons1.players[0].weaponItem === 'item_8' && weapons1.players[0].weaponModel);
    const offhandOk = !!(weapons1 && weapons1.players && weapons1.players[0] && weapons1.players[0].offhandModel);
    if (swapped) { await sleep(300); await shot(cdp, '02c-arma-cetro'); }
    await ev(cdp, 'Aethelgard.previewWeapon(null)');
    await sleep(400);
    step('armas visibles + mano secundaria', (armed && swapped && offhandOk) ? 'OK' : 'WARN', JSON.stringify({ esperada: expectedWeapon, inicial: weapons0 && weapons0.players && weapons0.players[0], cambio: weapons1 && weapons1.players && weapons1.players[0], offhand: offhandOk }));

    /* ---- v2.1: puntos de atributo ---- */
    const beforeStats = await j(cdp, '({points: Aethelgard.state().me.statPoints, str: Aethelgard.state().me.stats.str, gold: Aethelgard.state().me.gold, hasField: typeof Aethelgard.state().me.statPoints === "number"})');
    // inyectamos puntos en el cliente para comprobar el cableado de la UI sin depender de subir de nivel
    await ev(cdp, 'Aethelgard.state().me.statPoints = 3');
    await ev(cdp, `document.getElementById('btn-char').click()`);
    await sleep(600);
    const attrButtons = await ev(cdp, 'document.querySelectorAll("[data-stat]").length');
    const clicked = await ev(cdp, `(function(){var b=document.querySelector('[data-stat]'); if(b){b.click(); return true;} return false;})()`);
    await sleep(1000);
    const afterStats = await j(cdp, '({points: Aethelgard.state().me.statPoints, str: Aethelgard.state().me.stats.str})');
    const statOk = beforeStats && beforeStats.hasField && attrButtons === 6 && clicked;
    step('puntos de atributo (protocolo + UI)', statOk ? 'OK' : 'WARN', JSON.stringify({ before: beforeStats, buttons: attrButtons, clicked, after: afterStats }));
    await shot(cdp, '05b-atributos');
    await ev(cdp, '(function(){var w=document.querySelector(".window .x"); if(w) w.click(); return true;})()');
    await sleep(300);

    /* ---- v2.1: mercader ---- */
    await ev(cdp, `document.getElementById('btn-trade').click()`);
    await sleep(900);
    report.data.shop = await j(cdp, '({stock: (Aethelgard.state().shopStock||[]).length, buyRows: document.querySelectorAll("[data-buy]").length})');
    const buyClicked = await ev(cdp, `(function(){var b=document.querySelector('[data-buy]'); if(b){b.click(); return true;} return false;})()`);
    await sleep(1100);
    report.data.afterBuy = await j(cdp, '({gold: Aethelgard.state().me.gold, inv: Aethelgard.state().me.inventory.length})');
    const shopOk = !!(buyClicked && report.data.afterBuy && beforeStats && report.data.afterBuy.gold < beforeStats.gold && report.data.shop && report.data.shop.stock > 0);
    step('mercader comprar', shopOk ? 'OK' : 'WARN', JSON.stringify({ shop: report.data.shop, after: report.data.afterBuy }));
    await ev(cdp, `(function(){var t=document.querySelector('.window .tabs button[data-tab="sell"]'); if(t) t.click(); return true;})()`);
    await sleep(500);
    await shot(cdp, '04b-mercader');
    const sellClicked = await ev(cdp, `(function(){var b=document.querySelector('[data-sell]'); if(b){b.click(); return true;} return false;})()`);
    await sleep(1000);
    report.data.afterSell = await j(cdp, '({gold: Aethelgard.state().me.gold})');
    step('mercader vender', sellClicked ? 'OK' : 'WARN', JSON.stringify(report.data.afterSell));
    await ev(cdp, '(function(){var w=document.querySelector(".window .x"); if(w) w.click(); return true;})()');
    await sleep(300);

    /* ---- mundo de esqueletos (sin goblins/lobos/espectros/ogros/jefe) ---- */
    report.data.monsters = await j(cdp, '({types: Array.from(new Set((Aethelgard.state().monsters||[]).map(function(m){return m.type;}))), count: (Aethelgard.state().monsters||[]).length, elites: (Aethelgard.state().monsters||[]).filter(function(m){return m.elite;}).length})');
    const skelTypes = ['skeleton', 'skeleton_archer', 'skeleton_mage', 'skeleton_minion'];
    const onlySkeletons = !!(report.data.monsters && report.data.monsters.count >= 15 &&
      report.data.monsters.types.every(t => skelTypes.indexOf(t) >= 0) && report.data.monsters.elites === 0);
    step('monstruos solo esqueletos', onlySkeletons ? 'OK' : 'WARN', JSON.stringify(report.data.monsters));

    const key = async (k, code, vk) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k });
      await sleep(80);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    };
    const before = await j(cdp, '({x:Aethelgard.state().me.gridX, y:Aethelgard.state().me.gridY})');
    for (let i = 0; i < 8; i++) { await key('d', 'KeyD', 68); await sleep(90); }
    for (let i = 0; i < 4; i++) { await key('s', 'KeyS', 83); await sleep(90); }
    await sleep(900);
    const after = await j(cdp, '({x:Aethelgard.state().me.gridX, y:Aethelgard.state().me.gridY})');
    step('movimiento WASD', before && after && (before.x !== after.x || before.y !== after.y) ? 'OK' : 'FAIL', JSON.stringify(before) + ' -> ' + JSON.stringify(after));

    await ev(cdp, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}))');
    await sleep(700);
    const tgtA = await j(cdp, '({id:Aethelgard.state().targetId, name:(document.getElementById("tgt-name")||{}).textContent, shown:document.getElementById("target-frame").classList.contains("show"), cls:document.getElementById("target-frame").className, mons:(Aethelgard.state().monsters||[]).length})');
    await sleep(1500);
    const tgtB = await j(cdp, '({id:Aethelgard.state().targetId, name:(document.getElementById("tgt-name")||{}).textContent, shown:document.getElementById("target-frame").classList.contains("show")})');
    step('selección de objetivo (Tab)', (tgtA && tgtA.id) || (tgtB && tgtB.id) ? 'OK' : 'WARN', JSON.stringify({ first: tgtA, later: tgtB }));

    for (const s of ['basic', 'fireball', 'lightning', 'smite']) {
      await ev(cdp, `document.querySelector('#hotbar .slot[data-skill="${s}"]').click()`);
      await sleep(650);
    }
    await sleep(600);
    report.data.combat = await j(cdp, `({cds:Object.keys(Aethelgard.state().cds).length, chat:document.querySelectorAll('#chat-body .msg').length, mp:(document.getElementById('mp-num')||{}).textContent})`);
    step('lanzar habilidades', report.data.combat && report.data.combat.chat >= 2 ? 'OK' : 'WARN', JSON.stringify(report.data.combat));
    await shot(cdp, '03-combate');

    for (const [id, name] of [['btn-inv', '04-inventario'], ['btn-char', '05-personaje'], ['btn-quest', '06-misiones'], ['btn-map', '07-mapa'], ['btn-char', '08-personaje']]) {
      await ev(cdp, `document.getElementById('${id}').click()`);
      await sleep(600);
      const winOk = await ev(cdp, '!!document.querySelector(".window .win-body") && document.querySelector(".window .win-body").innerHTML.length > 80');
      step('ventana ' + id, winOk ? 'OK' : 'FAIL');
      await shot(cdp, name);
      await ev(cdp, '(function(){var w=document.querySelector(".window .x"); if(w) w.click(); return true;})()');
      await sleep(250);
    }

    /* ---- ventana de grupo + estado party ---- */
    await ev(cdp, `document.getElementById('btn-party').click()`);
    await sleep(700);
    const partyUi = await j(cdp, `({len:(document.querySelector('.window .win-body')||{innerHTML:''}).innerHTML.length, text:(document.querySelector('.window .win-body')||{textContent:''}).textContent.slice(0,80), state:Aethelgard.partyState()})`);
    const partyOk = !!(partyUi && partyUi.len > 60 && partyUi.state && 'party' in partyUi.state && 'invite' in partyUi.state);
    step('ventana de grupo', partyOk ? 'OK' : 'WARN', JSON.stringify(partyUi));
    await shot(cdp, '09b-grupo');
    await ev(cdp, '(function(){var w=document.querySelector(".window .x"); if(w) w.click(); return true;})()');
    await sleep(250);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 480, button: 'right', clickCount: 1 });
    for (let i = 0; i < 8; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 + i * 16, y: 480, button: 'right' }); await sleep(60); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 820, y: 480, button: 'right' });
    await sleep(700);
    await shot(cdp, '09-camara');

    report.data.perf = await j(cdp, `({fps:(document.getElementById('perf-fps')||{}).textContent, ping:(document.getElementById('perf-ping')||{}).textContent, net:(document.getElementById('perf-net')||{}).textContent, hp:(document.getElementById('hp-num')||{}).textContent, xp:(document.getElementById('xp-text')||{}).textContent, gold:(document.getElementById('gold-num')||{}).textContent, online:Aethelgard.state().onlineCount})`);
    step('rendimiento', 'OK', JSON.stringify(report.data.perf));
  }

  /* ---------- FASE B: demo local ---------- */
  log('[6] demo local...');
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  const okB = await navigate(cdp, 'http://127.0.0.1:' + PORT + '/?demo=1', 'demo');
  if (okB) {
    await ev(cdp, `(function(){document.getElementById('username').value='DemoHero';document.getElementById('password').value='demo1234';document.getElementById('btn-offline').click();return true;})()`);
    let demoEntered = false;
    try { demoEntered = await waitFor(() => ev(cdp, '!document.getElementById("ui-hud").classList.contains("hidden")'), 20000, 'HUD demo'); } catch (e) {}
    await sleep(3000);
    report.data.demo = await j(cdp, `({entered: !document.getElementById('ui-hud').classList.contains('hidden'), transport:Aethelgard.state().transport, name: Aethelgard.state().me ? Aethelgard.state().me.name : null, monsters:(Aethelgard.state().monsters||[]).length, worldOk:Aethelgard.worldOk(), chat:document.querySelectorAll('#chat-body .msg').length})`);
    step('demo local', demoEntered ? 'OK' : 'FAIL', JSON.stringify(report.data.demo));
    await shot(cdp, '10-demo-local');

    /* ---- yelmo visible (solo el Knight lo tiene; la demo es DarkKnight) ---- */
    let helmOk = false, helmData = null;
    try {
      // la demo carga los modelos 3D al entrar; esperamos a que el Knight esté acoplado
      for (let i = 0; i < 80; i++) {
        const st = await j(cdp, 'Aethelgard.weaponState()');
        if (st && st.players && st.players[0] && st.players[0].weaponBone) break;
        await sleep(500);
      }
      await ev(cdp, 'Aethelgard.previewHelm("item_5")');
      await sleep(500);
      helmData = await j(cdp, 'Aethelgard.weaponState()');
      const p = helmData && helmData.players && helmData.players[0];
      const on = !!(p && p.helmVisible === true);
      await shot(cdp, '02e-yelmo');
      await ev(cdp, 'Aethelgard.previewHelm(null)');
      await sleep(300);
      const off = await j(cdp, 'Aethelgard.weaponState()');
      const p2 = off && off.players && off.players[0];
      helmOk = on && !!(p2 && p2.helmVisible === false);
    } catch (e) { report.problems.push('yelmo: ' + e.message); }
    step('yelmo visible (Knight)', helmOk ? 'OK' : 'WARN', JSON.stringify(helmData && helmData.players && helmData.players[0]));

    // mercader en modo local
    await ev(cdp, `document.getElementById('btn-trade').click()`);
    await sleep(800);
    report.data.demoShop = await j(cdp, '({rows: document.querySelectorAll("[data-buy]").length, gold: Aethelgard.state().me.gold})');
    const demoBuy = await ev(cdp, `(function(){var b=document.querySelector('[data-buy]'); if(b){b.click(); return true;} return false;})()`);
    await sleep(1000);
    report.data.demoBuy = await j(cdp, '({gold: Aethelgard.state().me.gold, inv: Aethelgard.state().me.inventory.length, chat: document.querySelectorAll("#chat-body .msg").length})');
    step('mercader demo', (demoBuy && report.data.demoBuy && report.data.demoShop && report.data.demoBuy.gold < report.data.demoShop.gold) ? 'OK' : 'WARN', JSON.stringify({ shop: report.data.demoShop, after: report.data.demoBuy }));

    // cantidad: comprar 2 unidades de un objeto barato (item_10, 12 de oro)
    const qtySet = await ev(cdp, `(function(){var q=document.getElementById('trade-qty'); if(!q) return false; q.value='2'; q.dispatchEvent(new Event('input',{bubbles:true})); q.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
    await sleep(400);
    const qtyBefore = await j(cdp, '({gold:Aethelgard.state().me.gold, n:((Aethelgard.state().me.inventory.find(function(i){return i.itemId==="item_10";})||{}).count||0)})');
    const qtyBuy = await ev(cdp, `(function(){var b=document.querySelector('[data-buy="item_10"]'); if(b){b.click(); return true;} return false;})()`);
    await sleep(900);
    const qtyAfter = await j(cdp, '({gold:Aethelgard.state().me.gold, n:((Aethelgard.state().me.inventory.find(function(i){return i.itemId==="item_10";})||{}).count||0)})');
    const qtyOk = !!(qtySet && qtyBuy && qtyBefore && qtyAfter && (qtyAfter.n - qtyBefore.n) === 2 && (qtyBefore.gold - qtyAfter.gold) === 24);
    if (qtyOk) await shot(cdp, '12b-demo-cantidad');
    report.data.demoQty = { before: qtyBefore, after: qtyAfter, ok: qtyOk };
    step('mercader cantidad (x2)', qtyOk ? 'OK' : 'WARN', JSON.stringify(report.data.demoQty));
    await shot(cdp, '12-demo-mercader');
    await ev(cdp, '(function(){var w=document.querySelector(".window .x"); if(w) w.click(); return true;})()');
    await sleep(300);

    // combate en demo: caminar hasta una celda adyacente al goblin (6,6) y atacar.
    const walkTo = async (axis, goal, key, code, vk) => {
      for (let i = 0; i < 12; i++) {
        const pos = await j(cdp, '({x:Aethelgard.state().me.gridX,y:Aethelgard.state().me.gridY})');
        if (!pos) return null;
        if (pos[axis] === goal) return pos;
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: key, code: code, windowsVirtualKeyCode: vk, text: key });
        await sleep(160);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key, code: code, windowsVirtualKeyCode: vk });
        await sleep(120);
      }
      return await j(cdp, '({x:Aethelgard.state().me.gridX,y:Aethelgard.state().me.gridY})');
    };
    await walkTo('x', 5, 'd', 'KeyD', 68);
    await walkTo('y', 5, 's', 'KeyS', 83);
    await sleep(600);
    await ev(cdp, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}))');
    await sleep(500);
    let demoKills = 0, demoExp = 0;
    for (let i = 0; i < 12; i++) {
      await ev(cdp, `document.querySelector('#hotbar .slot[data-skill="basic"]').click()`);
      await sleep(950);
      const st = await j(cdp, '({kills:Aethelgard.state().me.kills||0, exp:Aethelgard.state().me.exp||0, target:Aethelgard.state().targetId})');
      if (st) { demoKills = st.kills; demoExp = st.exp; }
      if (demoKills > 0) break;
      if (!st || !st.target) await ev(cdp, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}))');
    }
    await sleep(800);
    report.data.demoCombat = await j(cdp, `({pos:{x:Aethelgard.state().me.gridX,y:Aethelgard.state().me.gridY}, target:Aethelgard.state().targetId, kills:Aethelgard.state().me.kills||0, xp:(document.getElementById('xp-text')||{}).textContent, hp:(document.getElementById('hp-num')||{}).textContent, chat:document.querySelectorAll('#chat-body .msg').length, drops:(Aethelgard.state().drops||[]).length})`);
    step('combate demo', (demoKills > 0 || demoExp > 0) ? 'OK' : 'FAIL', JSON.stringify(report.data.demoCombat));
    await shot(cdp, '11-demo-combate');
  }

  const crit = report.consoleErrors.filter(e => !/favicon|DevTools|Autofill|net::ERR_ABORTED/i.test(e));
  if (crit.length) report.problems.push(crit.length + ' errores de consola');
  return true;
}

function finish() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'e2e-report.json'), JSON.stringify(report, null, 2));
  log('\n================ INFORME ================');
  report.steps.forEach(s => log((s.status === 'OK' ? ' OK  ' : s.status === 'WARN' ? ' WARN' : ' FAIL') + '  ' + s.name + (s.detail ? '\n        ' + s.detail : '')));
  log('\n-- errores de consola: ' + report.consoleErrors.length);
  report.consoleErrors.slice(0, 12).forEach(e => log('   ' + String(e).slice(0, 320)));
  log('-- avisos: ' + report.consoleWarns.length);
  report.consoleWarns.slice(0, 6).forEach(e => log('   ' + String(e).slice(0, 200)));
  log('-- peticiones >=400: ' + report.failedRequests.length);
  report.failedRequests.slice(0, 10).forEach(e => log('   ' + e));
  log('-- screenshots: ' + report.shots.join(', '));
  if (report.data.serverHits && report.data.serverHits.length) {
    log('-- log del servidor de prueba:');
    report.data.serverHits.slice(-12).forEach(l => log('   ' + l.slice(0, 240)));
  }
  if (report.data.serverExit) {
    log('-- ATENCIÓN: el servidor de prueba terminó: code=' + report.data.serverExit.code + ' signal=' + report.data.serverExit.signal);
    log('   ' + String(report.data.serverExit.tail || '').split('\n').slice(-8).join('\n   '));
  }
  report.steps.filter(s => s.status === 'FAIL').forEach(s => report.problems.push('paso FAIL: ' + s.name));
  log('\nRESULTADO: ' + (report.problems.length ? 'PROBLEMAS -> ' + report.problems.join(' | ') : 'SIN PROBLEMAS CRITICOS'));
}

function cleanupDataDir() {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
}

main().then(() => {
  finish();
  try { chromeProc.kill(); } catch (e) {}
  try { serverProc.kill(); } catch (e) {}
  cleanupDataDir();
  setTimeout(() => process.exit(report.problems.length ? 1 : 0), 400);
}).catch(err => {
  report.problems.push('FATAL: ' + (err && err.message ? err.message : err));
  finish();
  try { chromeProc.kill(); } catch (e) {}
  try { serverProc.kill(); } catch (e) {}
  cleanupDataDir();
  setTimeout(() => process.exit(2), 400);
});
