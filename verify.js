/* Verificador estático del cliente Aethelgard (sin navegador). */
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
let failures = 0;
const say = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) failures++; };

/* ---------- 1. extraer bloques <script> sin src ---------- */
const blocks = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const startLine = html.slice(0, m.index).split('\n').length + (m[0].slice(0, m[0].indexOf('>') + 1).split('\n').length - 1);
  blocks.push({ code: m[2], startLine, index: m.index });
}
say(blocks.length > 0, 'bloques <script> inline encontrados: ' + blocks.length);

/* ---------- 2. sintaxis ---------- */
blocks.forEach((b, i) => {
  try {
    new Function(b.code);
    say(true, 'sintaxis bloque #' + (i + 1) + ' (' + b.code.split('\n').length + ' líneas, empieza en línea ' + b.startLine + ')');
  } catch (e) {
    say(false, 'sintaxis bloque #' + (i + 1) + ' [' + e.name + '] ' + e.message);
    const mm = /(\d+)/.exec(e.stack || '');
    if (mm) {
      const ln = parseInt(mm[1], 10) - 2;
      const lines = b.code.split('\n');
      for (let k = Math.max(0, ln - 3); k < Math.min(lines.length, ln + 3); k++) console.log('      ' + (k + 1) + ' | ' + lines[k]);
    }
  }
});

/* ---------- 3. ids duplicados ---------- */
const ids = {};
const idRe = /\sid="([^"]+)"/g;
while ((m = idRe.exec(html))) { const id = m[1]; ids[id] = (ids[id] || 0) + 1; }
const dup = Object.keys(ids).filter(k => ids[k] > 1);
say(dup.length === 0, 'ids duplicados: ' + (dup.length ? dup.join(', ') : 'ninguno'));

/* ---------- 4. ids referenciados que no existen ---------- */
const used = new Set();
const gRe = /getElementById\(\s*'([^']+)'\s*\)/g;
while ((m = gRe.exec(html))) used.add(m[1]);
const missing = Array.from(used).filter(id => !ids[id]);
say(missing.length === 0, 'getElementById a ids inexistentes: ' + (missing.length ? missing.join(', ') : 'ninguno'));

/* ---------- 5. módulos y símbolos internos ---------- */
const main = blocks.map(b => b.code).join('\n');
const required = ['World3D', 'Entities', 'FX', 'Projectiles', 'Float3D', 'Minimap', 'UI', 'Windows', 'Game', 'Net', 'LocalWorld', 'Audio', 'Settings'];
required.forEach(name => {
  const declared = new RegExp('const\\s+' + name + '\\s*=').test(main) || new RegExp('function\\s+' + name).test(main) || new RegExp('let\\s+' + name + '\\s*=').test(main);
  say(declared, 'símbolo declarado: ' + name);
});
const exported = /window\.Aethelgard\s*=\s*Aethelgard/.test(main);
say(exported, 'exporta window.Aethelgard');

/* ---------- 6. llamadas a funciones no definidas (heurística) ---------- */
const definedFns = new Set();
let fm;
const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
while ((fm = fnRe.exec(main))) definedFns.add(fm[1]);
const callRe = /(?:^|[^.\w$])([A-Za-z_$][\w$]{2,})\s*\(/g;
const knownMissing = [];
const builtins = new Set(['function', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'Promise', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'requestAnimationFrame', 'fetch', 'decodeURIComponent', 'encodeURIComponent', 'console', 'alert', 'require', 'Function', 'Boolean', 'Error', 'Set', 'Map', 'Float32Array', 'localStorage', 'performance', 'RegExp', 'for', 'do', 'else', 'try', 'void', 'delete', 'instanceof', 'in', 'of', 'await']);
while ((fm = callRe.exec(main))) {
  const name = fm[1];
  if (definedFns.has(name) || builtins.has(name)) continue;
  knownMissing.push(name);
}
const uniqueMissing = Array.from(new Set(knownMissing));
console.log('INFO llamadas a identificadores no declarados como function (revisar manualmente):');
console.log('     ' + (uniqueMissing.slice(0, 120).join(', ') || 'ninguna'));

/* ---------- 7. balance de llaves / paréntesis global ---------- */
function balance(src, open, close) {
  let depth = 0, inStr = null, inLineComment = false, inBlockComment = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) depth--;
    if (depth < 0) return depth;
  }
  return depth;
}
const balBrace = balance(main, '{', '}');
const balParen = balance(main, '(', ')');
console.log('INFO balance heurístico (ignorar: no interpreta regex literales): llaves=' + balBrace + ' paréntesis=' + balParen);
console.log('INFO la validez real la da el chequeo de sintaxis de arriba (new Function)');

/* ---------- 8. CSS: llaves balanceadas ---------- */
const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
let css = '';
while ((m = styleRe.exec(html))) css += m[1] + '\n';
say(balance(css, '{', '}') === 0, 'balance de llaves en CSS (' + css.split('\n').length + ' líneas)');

/* ---------- 9. tamaño ---------- */
const lines = html.split('\n').length;
console.log('INFO html: ' + lines + ' líneas, ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');

console.log('');
console.log(failures === 0 ? 'RESULTADO: sin fallos críticos' : 'RESULTADO: ' + failures + ' fallo(s)');
process.exit(failures === 0 ? 0 : 1);
