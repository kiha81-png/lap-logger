// ---------- QRコード（バイトモード、誤り訂正 M。入らなければ L） ----------
const QR = (() => {
  const ECC = { // 1ブロックの誤り訂正の語数と、ブロック数（型番 1〜40）
    L: { per: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         n:   [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], fmt: 1 },
    M: { per: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
         n:   [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], fmt: 0 },
  };
  const rawModules = v => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2){ const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataWords = (v, e) => Math.floor(rawModules(v) / 8) - ECC[e].per[v] * ECC[e].n[v];
  const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; };
  function rsDivisor(deg){
    const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++){
      for (let j = 0; j < deg; j++){ r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = gmul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div){
    const r = new Array(div.length).fill(0);
    for (const b of data){
      const f = b ^ r.shift(); r.push(0);
      div.forEach((d, i) => { r[i] ^= gmul(d, f); });
    }
    return r;
  }
  function alignPos(v){
    if (v === 1) return [];
    const na = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + na * 3 + 5) / (na * 4 - 4)) * 2, r = [6];
    for (let i = na - 1, pos = v * 4 + 10; i >= 1; i--, pos -= step) r[i] = pos;
    return r;
  }
  function encode(text){
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 0, e = null;
    for (const ec of ['M', 'L']){
      for (let t = 1; t <= 40; t++){ if (4 + (t < 10 ? 8 : 16) + 8 * bytes.length <= dataWords(t, ec) * 8){ v = t; break; } }
      if (v){ e = ec; break; }
    }
    if (!v) return null; // 長すぎる
    // データのビット列
    const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataWords(v, e) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8){ let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // ブロックに分けて誤り訂正を付け、交互に並べる
    const nb = ECC[e].n[v], el = ECC[e].per[v], raw = Math.floor(rawModules(v) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++){
      const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += d.length;
      const ecc = rsRemainder(d, div);
      if (i < nShort) d.push(0);
      blocks.push(d.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) words.push(b[i]); });
    // 模様を描く
    const size = v * 4 + 17, mod = [], fn = [];
    for (let y = 0; y < size; y++){ mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++){
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    const ap = alignPos(v), na = ap.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++){
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = mask => {
      const d = (ECC[e].fmt << 3) | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, g(i));
      set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7){
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++){ const dark = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2){
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++){
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < words.length * 8){ mod[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
      }
    }
    // マスクは、読み取りにくさの点数が一番低いものを選ぶ
    const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASK[m](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = get => { // 同じ色の5個以上の並びと、ファインダーに似た並び
        let run = 0, prev = null, s = '';
        for (let i = 0; i < size; i++){
          const c = get(i); s += c ? '1' : '0';
          if (c === prev){ run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = c; }
        }
        s = '0000' + s + '0000';
        for (let i = s.indexOf('1011101'); i >= 0; i = s.indexOf('1011101', i + 1))
          if (s.slice(i - 4, i) === '0000' || s.slice(i + 7, i + 11) === '0000') p += 40;
      };
      for (let y = 0; y < size; y++) line(x => mod[y][x]);
      for (let x = 0; x < size; x++) line(y => mod[y][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++){
        const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
      const tot = size * size; p += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++){
      applyMask(m); drawFormat(m);
      const pp = penalty(); if (pp < bestP){ bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size, mod, version: v, ecl: e, mask: best };
  }
  // 白地に黒で、周りに4マスの余白
  function draw(cv, q, px){
    const dpr = window.devicePixelRatio || 1, n = q.size + 8, sc = Math.max(1, Math.floor(px * dpr / n)), w = n * sc; // 1マスを画面の画素にそろえて、にじませない
    cv.width = w; cv.height = w; cv.style.width = cv.style.height = w / dpr + 'px';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, w); ctx.fillStyle = '#000';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.mod[y][x]) ctx.fillRect((x + 4) * sc, (y + 4) * sc, sc, sc);
  }
  return { encode, draw };
})();
// コースを短い文字列にする：LL1. + base64url(JSON)。リンクでは # の後ろに入れるので、サーバーには送られない
const r6 = x => Math.round(x * 1e6) / 1e6;
function courseCode(c){
  const o = { n: c.name, t: c.type === 'segment' ? 's' : 'c',
    l: c.lines.map(l => [ptOk(l.c) ? r6(l.c.lat) : null, ptOk(l.c) ? r6(l.c.lon) : null, num(l.hdg) ? Math.round(l.hdg * 10) / 10 : null, Math.round(l.w)]) };
  let bin = ''; new TextEncoder().encode(JSON.stringify(o)).forEach(b => { bin += String.fromCharCode(b); });
  return 'LL1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function parseCourseCode(text){
  const m = /LL1\.([A-Za-z0-9_-]{4,8000})/.exec(String(text || ''));
  if (!m) return null;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    if (!o || !Array.isArray(o.l) || !o.l.length || o.l.length > 50) return null;
    const ll = a => num(a[0]) && num(a[1]) && Math.abs(a[0]) <= 90 && Math.abs(a[1]) <= 180 ? { lat: a[0], lon: a[1] } : null;
    return migrateCourse({ id: 'c' + Date.now(), name: String(o.n || tx('untitled')).slice(0, 80), type: o.t === 's' ? 'segment' : 'circuit',
      lines: o.l.map(a => Array.isArray(a) ? { c: ll(a), hdg: num(a[2]) ? ((a[2] % 360) + 360) % 360 : null, w: a[3] } : null) });
  } catch (err){ return null; }
}
const courseUrl = c => location.origin + location.pathname + '#c=' + courseCode(c);
function addCourse(c){
  const same = courses.find(x => x.name === c.name && courseCode(x) === courseCode(c));
  if (same){ cv.id = same.id; cv.sel = 0; alert(tx('courseSame', same.name)); showTab('v-course'); return; }
  courses.push(c); saveCourses(); cv.id = c.id; cv.sel = 0; cv.trace = null; cv.z = 1; cv.ox = cv.oy = 0;
  alert(tx('courseImported', c.name));
  showTab('v-course');
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); alert(tx('copied')); }
  catch (e){ prompt(tx('copyManual'), t); }
}
let shareUrl = '';
$('#cShare').addEventListener('click', () => {
  const c = editCourse(), q = QR.encode(shareUrl = courseUrl(c)), el = $('#qrCv');
  $('#shareName').textContent = c.name;
  el.hidden = !q; $('#qrMsg').textContent = tx(q ? 'qrNote' : 'qrTooLong');
  $('#shareBox').hidden = false;
  if (q) QR.draw(el, q, Math.min(300, ($('#shareBox .box').clientWidth || 300) - 36));
});
$('#qrCopy').addEventListener('click', () => copyText(shareUrl));
$('#qrFile').addEventListener('click', () => {
  const c = editCourse();
  const data = { app: 'lap-logger', kind: 'course', version: APP_VERSION, course: { name: c.name, type: c.type, lines: c.lines } };
  shareOrDownload(`lap-logger-course_${c.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`, JSON.stringify(data), 'application/json');
});
$('#qrClose').addEventListener('click', () => { $('#shareBox').hidden = true; });
$('#cPaste').addEventListener('click', async () => {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (e){}
  let c = parseCourseCode(t);
  if (!c){ t = prompt(tx('pastePrompt')) || ''; if (!t.trim()) return; c = parseCourseCode(t); }
  if (!c){ alert(tx('codeBad')); return; }
  addCourse(c);
});
// 共有されたリンク（#c=...）で開かれたとき
let impC = null, impCode = '';
function checkHashImport(){
  if (!/^#c=/.test(location.hash)) return;
  const code = location.hash.slice(3); // base64url なので、% の変換は要らない
  history.replaceState(null, '', location.pathname + location.search);
  const c = parseCourseCode(code);
  if (!c){ if (consented()) alert(tx('codeBad')); return; }
  impC = c; impCode = courseCode(c);
  showImport();
}
// 記録中は出さず、止めたあとに出す
function showImport(){
  if (!impC || rec.on) return;
  $('#impInfo').textContent = tx('impInfo', impC.name, tx(impC.type === 'segment' ? 'modeSegment' : 'modeCircuit'), impC.lines.length);
  $('#impBox').hidden = false;
}
window.addEventListener('hashchange', () => { if (ready) try { checkHashImport(); } catch (err){} });
$('#impAdd').addEventListener('click', () => { $('#impBox').hidden = true; if (impC){ const c = impC; impC = null; c.id = 'c' + Date.now(); addCourse(c); } });
$('#impCopy').addEventListener('click', () => copyText(impCode));
$('#impCancel').addEventListener('click', () => { $('#impBox').hidden = true; impC = null; });
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ $('#shareBox').hidden = true; if (!$('#impBox').hidden){ $('#impBox').hidden = true; impC = null; } } });
$('#cImport').addEventListener('click', () => $('#impFile').click());
$('#cDel').addEventListener('click', () => {
  if (courses.length < 2){ alert(tx('oneCourse')); return; }
  const c = editCourse();
  if (!confirm(tx('delCourseConfirm', c.name))) return;
  courses = courses.filter(x => x !== c); cv.id = courses[0].id; cv.sel = 0; cv.trace = null; cv.z = 1; cv.ox = cv.oy = 0; saveCourses(); renderCourseTab();
});
$('#cAuto').addEventListener('click', () => {
  const c = editCourse(), arr = traceSessions(c);
  if (!arr.length) return;
  if (autoHeadings(c, arr)) offerRecalc(c, arr);
});

