// ---------- Google に保存（自分で用意した Apps Script に送る） ----------
// 送り先と合言葉はバックアップに入れない。送信待ちは記録のIDだけを覚え、送るときに端末内の記録から作る。
// 他のタブと共有するので、毎回 localStorage から読み直す。送り直しても、スクリプト側でその記録の行を置き換える
const GS_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]{20,}\/exec$/;
const GS_MAX = 45 * 1024 * 1024;
const gsConf = () => Object.assign({ url: '', token: '', name: '', auto: true }, LS.get('gsync', {}));
const gsReady = (c = gsConf()) => GS_URL_RE.test(c.url) && !!c.token;
const gsQueue = () => LS.get('gsQueue', []);   // [{ id, tries, next, err }]
const gsSentMap = () => LS.get('gsSent', {});  // id -> { at, rev, url }
let gsBusy = false;
function gsEnqueue(id){
  LS.set('gsQueue', gsQueue().filter(q => q.id !== id).concat({ id, tries: 0, next: 0, err: '' }));
  gsFlush();
}
// 送ったことのある記録を直したら、自動送信がオンなら送り直す
function gsResend(id){ if (gsSentMap()[id] && gsReady() && gsConf().auto) gsEnqueue(id); }
function gsAutoAfterStop(id){ if (gsReady() && gsConf().auto) gsEnqueue(id); }
function gsCell(v){ return v == null || (typeof v === 'number' && !num(v)) ? '' : v; }
async function gzip64(text){
  if (typeof CompressionStream === 'undefined') return null;
  const buf = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gsPayload(s, c){
  const A = analyze(s), drag = s.mode === 'drag', ja = settings.lang === 'ja', pts = s.points;
  const course = drag ? '' : (s.course ? s.course.name : ''), veh = s.vehicle ? s.vehicle.name : '';
  const mode = tx(modeKey(s.mode));
  const kmh = pc => { const st = lapStats(s, A, pc); return Math.round(st.vmax / spdK() * KMH * 10) / 10; };
  const sec = ms => num(ms) ? Math.round(ms) / 1000 : '';
  let dist = 0;
  if (A.ride) dist = A.ride.dist; // フリー走行：途切れと停車中の揺れを除いた距離
  else for (let i = 1; i < pts.length; i++){ const a = A.proj(pts[i - 1]), b = A.proj(pts[i]); dist += Math.hypot(b.x - a.x, b.y - a.y); }
  const vmax = pts.reduce((m, p) => Math.max(m, p.v), 0), best = bestPiece(A);
  const end = s.endedAt || (pts.length ? pts[pts.length - 1].t : s.startedAt);
  const nSec = Math.min(10, A.laps.reduce((m, l) => Math.max(m, (l.splits || []).length), 0));
  const lapHead = (ja ? ['記録ID', '開始', '名前', '車両', 'モード', 'コース', '周', 'タイム(秒)', 'タイム', '最高速(km/h)', '除外', '警告', 'メモ']
    : ['Recording ID', 'Start', 'Name', 'Vehicle', 'Mode', 'Track', 'Lap', 'Time (s)', 'Time', 'Top speed (km/h)', 'Excluded', 'Warning', 'Note'])
    .concat(Array.from({ length: nSec }, (_, i) => ja ? `セクター${i + 1}(秒)` : `Sector ${i + 1} (s)`));
  const laps = A.laps.map(l => [s.id, { t: l.start }, c.name, veh, mode, course, l.n, sec(l.time), fmtLap(l.time, 3), kmh(l), !!l.excl, !!l.warn,
    drag ? Object.keys(l.times || {}).map(k => `${distLabel(k)} ${fmtS(l.times[k])}s`).concat(Object.keys(l.spd || {}).map(k => `0-${k}${l.spdUnit || 'km/h'} ${fmtS(l.spd[k])}s`)).join(' / ') : '']
    .concat(Array.from({ length: nSec }, (_, i) => sec((l.splits || [])[i]))));
  const sessHead = ja ? ['記録ID', '開始', '終了', '名前', '車両', 'モード', 'コース', '周回数', 'ベスト(秒)', 'ベスト', '走行時間(分)', '距離(km)', '最高速(km/h)', 'GPS点数', 'ファイル', '送信日時', 'アプリ版']
    : ['Recording ID', 'Start', 'End', 'Name', 'Vehicle', 'Mode', 'Track', 'Laps', 'Best (s)', 'Best', 'Duration (min)', 'Distance (km)', 'Top speed (km/h)', 'GPS points', 'File', 'Sent at', 'App version'];
  const sess = [s.id, { t: s.startedAt }, { t: end }, c.name, veh, mode, course, A.laps.length, best ? sec(best.time) : '', best ? fmtLap(best.time, 3) : '',
    Math.round((end - s.startedAt) / 6000) / 10, Math.round(dist / 10) / 100, Math.round(vmax * KMH * 10) / 10, pts.length, '', { t: Date.now() }, APP_VERSION];
  const json = JSON.stringify(exportSess(s)), gz = await gzip64(json).catch(() => null);
  const file = { name: `lap_${fileStamp(s.startedAt)}_${s.id}.json` };
  if (gz) file.gz = gz; else file.json = json;
  return { app: 'lap-logger', v: 1, kind: 'session', token: c.token, id: s.id, file,
    tables: [{ sheet: ja ? '走行' : 'Sessions', head: sessHead, rows: [sess.map(gsCell)], fileCol: 14 }, { sheet: ja ? 'ラップ' : 'Laps', head: lapHead, rows: laps.map(r => r.map(gsCell)) }] };
}
async function gsPost(c, body){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 120000);
  try {
    // text/plain にすると、ブラウザの事前確認（Apps Script は受けられない）が起きない
    const r = await fetch(c.url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, credentials: 'omit', redirect: 'follow', signal: ctl.signal });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e){ return { ok: false, error: 'reply', status: r.status }; }
  } catch (e){ return { ok: false, error: 'net' }; }
  finally { clearTimeout(tm); }
}
const gsFatal = e => e === 'token' || e === 'notoken' || e === 'bad' || e === 'big' || e === 'reply';
async function gsFlushNow(force){
  const c = gsConf();
  if (!gsReady(c) || rec.on || !DB.opened || navigator.onLine === false) return;
  for (;;){
    const q = gsQueue(), it = q.find(x => force || (Date.now() >= x.next && !gsFatal(x.err)));
    if (!it) break;
    const s = sessById(it.id);
    let res;
    if (!s){ LS.set('gsQueue', gsQueue().filter(x => x.id !== it.id)); continue; }
    if (s.active) break;
    const body = await gsPayload(s, c);
    res = JSON.stringify(body).length > GS_MAX ? { ok: false, error: 'big' } : await gsPost(c, body);
    const now = gsQueue();
    if (res && res.ok){
      LS.set('gsQueue', now.filter(x => x.id !== it.id));
      LS.set('gsSent', Object.assign(gsSentMap(), { [it.id]: { at: Date.now(), rev: s.rev || 0, url: String(res.fileUrl || '') } }));
    } else {
      const e0 = (res && res.error) || 'net', err = ['net', 'server', 'token', 'notoken', 'reply', 'bad', 'big'].includes(e0) ? e0 : 'bad', tries = it.tries + 1;
      LS.set('gsQueue', now.map(x => x.id === it.id ? Object.assign(x, { tries, err, next: Date.now() + Math.min(1800000, 15000 * 2 ** Math.min(tries, 7)) }) : x));
      if (err === 'net' || err === 'server') break; // 電波や混雑のときは、全部まとめて後でやり直す
    }
    force = false;
    if (curTab === 'v-set') renderGs();
  }
}
async function gsFlush(force){
  if (gsBusy) return; gsBusy = true;
  try {
    if (navigator.locks) await navigator.locks.request('lap-logger-gsync' + NS_SUFFIX, { ifAvailable: true }, l => l ? gsFlushNow(force) : null);
    else await gsFlushNow(force);
  } catch (e) {}
  finally { gsBusy = false; if (curTab === 'v-set') renderGs(); if (curTab === 'v-rec' && recState.view === 'sess') renderGsSess(); }
}
window.addEventListener('online', () => gsFlush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') gsFlush(); });
setInterval(() => { if (gsQueue().length) gsFlush(); }, 60000);
function gsStateOf(s){
  const q = gsQueue().find(x => x.id === s.id), sent = gsSentMap()[s.id];
  if (q) return q.err ? tx('gsQErr', tx('gsErr_' + q.err)) : tx('gsQWait');
  if (sent) return tx('gsSentAt', fmtDate(sent.at)) + ((s.rev || 0) !== sent.rev ? tx('gsChanged') : '');
  return '';
}
function renderGsSess(){
  const s = sessById(recState.sid), el = $('#gsSessNote');
  if (el && s) el.textContent = gsReady() ? gsStateOf(s) : tx('gsNotSet');
}
function renderGs(){
  const c = gsConf(), q = gsQueue();
  $('#gsUrl').value = c.url; $('#gsToken').value = c.token; $('#gsName').value = c.name; $('#gsAuto').checked = !!c.auto;
  const last = Object.values(gsSentMap()).reduce((m, x) => Math.max(m, x.at || 0), 0), errs = q.filter(x => x.err);
  $('#gsStatus').textContent = !c.url && !c.token ? tx('gsNotSet') : !gsReady(c) ? tx('gsBadUrl')
    : [tx('gsQueueN', q.length), last ? tx('gsLast', fmtDate(last)) : '', errs.length ? tx('gsErr_' + errs[errs.length - 1].err) : ''].filter(Boolean).join(' ');
  $('#gsStatus').className = 'note' + (gsReady(c) && !errs.length ? '' : ' warnText');
}
function gsSetConf(patch){
  const c = Object.assign(gsConf(), patch);
  LS.set('gsync', c);
  // 設定を直したら、止まっていた送信をやり直す
  LS.set('gsQueue', gsQueue().map(x => Object.assign(x, { tries: 0, next: 0, err: '' })));
  renderGs();
}
$('#gsUrl').addEventListener('change', e => gsSetConf({ url: e.target.value.trim() }));
$('#gsToken').addEventListener('change', e => gsSetConf({ token: e.target.value.trim() }));
$('#gsName').addEventListener('change', e => gsSetConf({ name: e.target.value.trim().slice(0, 40) }));
$('#gsAuto').addEventListener('change', e => gsSetConf({ auto: e.target.checked }));
$('#gsTest').addEventListener('click', async () => {
  const c = gsConf();
  if (!gsReady(c)){ alert(tx('gsBadUrl')); return; }
  const b = $('#gsTest'); b.disabled = true;
  const r = await gsPost(c, { app: 'lap-logger', v: 1, kind: 'ping', token: c.token });
  b.disabled = false;
  alert(r && r.ok ? tx('gsTestOk', String(r.sheet || '')) : tx('gsErr_' + ((r && r.error) || 'net')));
});
$('#gsSendAll').addEventListener('click', () => {
  if (!gsReady()){ alert(tx('gsBadUrl')); return; }
  const sent = gsSentMap(), have = new Set(gsQueue().map(x => x.id));
  const add = sessions.filter(s => !s.active && !have.has(s.id) && (!sent[s.id] || (s.rev || 0) !== sent[s.id].rev)).map(s => ({ id: s.id, tries: 0, next: 0, err: '' }));
  LS.set('gsQueue', gsQueue().map(x => Object.assign(x, { tries: 0, next: 0, err: '' })).concat(add));
  gsFlush(); renderGs();
});
$('#gsGuide').addEventListener('click', () => { window.open('https://github.com/kiha81-png/lap-logger/blob/main/docs/GOOGLE_SYNC.md', '_blank', 'noopener'); });

