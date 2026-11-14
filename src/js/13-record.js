// ---------- 計測 ----------
const rec = {
  on: false,
  session: null,
  det: null,
  wake: null,
  wakeHeld: false,
  wakeReq: false,
  lastSave: 0,
  startedAt: 0,
  releasing: new Set()
};
const LOCKP = 'lap-logger-rec' + NS_SUFFIX + ':';
function holdRecLock(id) {
  if (!navigator.locks) return;
  // 取れたときに、もう記録が終わっていたら、すぐ手放す
  navigator.locks
    .request(
      LOCKP + id,
      () =>
        new Promise(r => {
          if (rec.on && rec.session && rec.session.id === id) rec.unlock = r;
          else r();
        })
    )
    .catch(() => {});
}
async function heldRecLocks() {
  if (!navigator.locks) return null;
  try {
    const q = await navigator.locks.query();
    return new Set((q.held || []).map(l => l.name));
  } catch (e) {
    return null;
  }
}
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('lap-logger' + NS_SUFFIX) : null;
function bcast(msg) {
  try {
    if (bc) bc.postMessage(msg);
  } catch (e) {}
}
// 別のタブで記録が始まった・終わったら、その記録を読み直して画面を合わせる
const refreshGen = new Map();
let renderPending = false;
async function refreshSession(id) {
  if (!ready || (rec.on && rec.session && rec.session.id === id)) return;
  const gen = (refreshGen.get(id) || 0) + 1;
  refreshGen.set(id, gen);
  let s;
  try {
    s = await DB.serial(() => DB.loadOne(id));
  } catch (e) {
    return;
  }
  if (refreshGen.get(id) !== gen) return; // もっと新しい読み直しがある
  if (!s) {
    sessions = sessions.filter(x => x.id !== id);
    anaCache.delete(id);
  } else {
    if (s.active) {
      const held = await heldRecLocks();
      if (held && !held.has(LOCKP + id)) s.active = false;
    }
    if (refreshGen.get(id) !== gen) return;
    sessions = sessions.filter(x => x.id !== id);
    sessions.push(s);
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    anaCache.delete(id);
  }
  if (curTab === 'v-rec') {
    if (recState.view === 'lap' && lv.playing) renderPending = true;
    else renderRec();
  } else if (curTab === 'v-run' && !rec.on) renderHome();
}
if (bc)
  bc.onmessage = e => {
    const m = e.data || {};
    if ((m.type === 'rec-start' || m.type === 'rec-stop') && typeof m.id === 'string') refreshSession(m.id);
  };
// 画面に戻ってきたときにも、終わっている記録がないか確かめる（連絡を受け取れなかった場合に備えて）
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const others = sessions.filter(s => s.active && !(rec.on && rec.session === s));
  if (!others.length) return;
  const held = await heldRecLocks();
  if (!held) return;
  for (const s of others) if (!held.has(LOCKP + s.id)) refreshSession(s.id);
});
function setNote(msg, warn) {
  const el = $('#runNote');
  el.textContent = msg || '';
  el.className = 'note' + (warn ? ' warnText' : '');
}
const flashTm = new Map();
// 結果の色で数秒光らせる（cls：good・bad・bestc、または空）
function flash(sel, cls) {
  const el = $(sel),
    FL = ['flash', 'good', 'bad', 'bestc'];
  clearTimeout(flashTm.get(sel));
  el.classList.remove(...FL);
  void el.offsetWidth;
  el.classList.add('flash');
  if (cls) el.classList.add(cls);
  flashTm.set(
    sel,
    setTimeout(() => el.classList.remove(...FL), 3000)
  );
}
let lapFlashTm = null;
// ラップ完了：数秒だけ、画面全体に結果を大きく出す
function lapFlash(last, loop) {
  const el = $('#lapFlash');
  $('#lfN').textContent = loop ? tx('lapN', last.n) : tx('lastRun');
  if (last.diff == null) {
    $('#lfD').textContent = fmtLap(last.time);
    $('#lfT').textContent = '';
  } else {
    $('#lfD').textContent = fmtDiff(last.diff);
    $('#lfT').textContent = (last.best ? tx('newBest') + '  ' : '') + fmtLap(last.time) + (last.warn ? '⚠' : '');
  }
  el.className = last.cls || '';
  el.hidden = false;
  clearTimeout(lapFlashTm);
  lapFlashTm = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}
const setText = (el, t) => {
  if (el.textContent !== t) el.textContent = t;
};
// 画面中央の大きな表示。設定に合わせて「前ラップとベストの差」か「ベストとの今の差」。出せるものがなければ経過時間
function renderMain() {
  if (!rec.on) return;
  const s = rec.session,
    mv = $('#mainVal');
  let lbl = '',
    val = null,
    sub = '',
    cls = '';
  if (s.mode !== 'drag' && rec.det) {
    if (settings.liveMain === 'delta') {
      if (live.delta != null) {
        lbl = tx('lblDeltaNow');
        val = fmtDiff(live.delta);
        cls = diffCls(live.delta);
        sub = tx('predLap', fmtLap(live.pred));
      } else if (!live.ref) sub = tx('noRefYet');
    } else if (live.last) {
      const lt = fmtLap(live.last.time) + (live.last.warn ? '⚠' : '');
      if (live.last.diff != null) {
        lbl = tx('lblVsBest');
        val = fmtDiff(live.last.diff);
        cls = live.last.cls;
        sub = `${$('#lblLast').textContent} ${lt}`;
      } else {
        lbl = $('#lblLast').textContent;
        val = lt;
      }
    }
  }
  if (s.mode === 'free') {
    // フリー走行：経過時間と、走行／停車の内訳
    const el = Date.now() - rec.startedAt;
    lbl = tx('freeTimes', fmtDur(live.free.mov), fmtDur(Math.max(0, el - live.free.mov)));
    val = fmtDur(el);
  }
  if (val == null) {
    lbl = $('#lapNo').textContent;
    val = $('#curLap').textContent;
    if (lbl === tx('outLap')) lbl = tx('outLapWait');
  }
  setText($('#mainLbl'), lbl);
  setText($('#mainSub'), sub);
  setText(mv, val);
  const c = 'big' + (val.length <= 5 ? ' short' : '') + (cls ? ' ' + cls : '');
  if (mv.className !== c) mv.className = c;
}
// ベストラップの同じ地点と比べた、今のタイム差。pts は {t（ラップ開始からのミリ秒）, lat, lon}
class LiveDelta {
  constructor(pts) {
    this.proj = makeProj(pts[0].lat, pts[0].lon);
    this.p = pts.map(q => {
      const xy = this.proj(q);
      return { x: xy.x, y: xy.y, t: q.t };
    });
    this.total = pts[pts.length - 1].t;
    this.i = 0;
  }
  reset() {
    this.i = 0;
  }
  _near(P, lo, hi, ok) {
    let best = null;
    for (let i = lo; i < hi; i++) {
      const a = this.p[i],
        b = this.p[i + 1],
        dx = b.x - a.x,
        dy = b.y - a.y,
        L2 = dx * dx + dy * dy;
      const k = L2 ? clamp01(((P.x - a.x) * dx + (P.y - a.y) * dy) / L2) : 0,
        d = Math.hypot(a.x + k * dx - P.x, a.y + k * dy - P.y);
      if ((!best || d < best.d) && (!ok || ok(a.t + k * (b.t - a.t)))) best = { d, i, k };
    }
    return best;
  }
  // p：今の点、lapStart：このラップの開始時刻。ベストの走行ラインから 40m 以上離れていれば null
  at(p, lapStart) {
    const n = this.p.length,
      el = p.t - lapStart,
      P = this.proj(p);
    if (n < 2) return null;
    // ふだんは前回の位置の近くだけを探す。見失ったら全体から探す（ただし経過時間が大きく違う所は除く：周回はスタートとゴールが重なるため）
    const near = t => Math.abs(t - el) < this.total * 0.3;
    let b = this._near(P, Math.max(0, this.i - 2), Math.min(n - 1, this.i + 30), near);
    if (!b || b.d > 40) b = this._near(P, 0, n - 1, near);
    if (!b || b.d > 40) return null;
    this.i = b.i;
    const a = this.p[b.i],
      c = this.p[b.i + 1],
      ref = a.t + b.k * (c.t - a.t);
    return { delta: el - ref, pred: this.total + el - ref };
  }
}
// 1周（lap：start・end・sll・ell）の走行ラインから、比べる相手を作る
function makeRef(points, lap) {
  const pts = [{ t: 0, lat: lap.sll.lat, lon: lap.sll.lon }];
  for (const q of points) if (q.t > lap.start && q.t < lap.end) pts.push({ t: q.t - lap.start, lat: q.lat, lon: q.lon });
  pts.push({ t: lap.end - lap.start, lat: lap.ell.lat, lon: lap.ell.lon });
  return pts.length >= 3 ? new LiveDelta(pts) : null;
}
// この車両・コースのベストラップ（記録とラップ）
function bestRef(vehId, course) {
  const key = courseKey(course);
  let best = null;
  for (const s of sessions) {
    if (s.active || s.mode === 'drag' || !s.vehicle || s.vehicle.id !== vehId || !s.course || courseKey(s.course) !== key) continue;
    const A = analyze(s);
    for (const l of A.laps) if (!l.warn && !l.excl && (!best || l.time < best.l.time)) best = { s, l };
  }
  return best;
}
// 見えているセルが奇数なら、最後のセルを横いっぱいにする
function layoutCells() {
  const vis = $$('.cells .cell').filter(c => {
    c.classList.remove('span');
    return !c.hidden;
  });
  if (vis.length % 2) vis[vis.length - 1].classList.add('span');
}
function handleEvents(evs) {
  const loop = rec.session.course.type !== 'segment';
  for (const e of evs) {
    if (e.type === 'rev') {
      setNote(tx('revCross'), true);
      continue;
    }
    if (e.type === 'start') {
      live.lapStart = e.t;
      live.delta = null;
      if (live.ref) live.ref.reset();
      if ($('#runNote').textContent === tx('revCross')) setNote(tx('recNote'));
      $('#lapNo').textContent = loop ? tx('lapN', e.n) : tx('segRun');
    } else if (e.type === 'lap') {
      const t = e.lap.time,
        pb = live.pbLap,
        d = $('#lastDiff'),
        best = !e.lap.warn && pb != null && t < pb;
      let cls = '';
      $('#lastLap').textContent = fmtLap(t) + (e.lap.warn ? '⚠' : '');
      if (pb == null) d.textContent = '';
      else if (best) {
        d.textContent = tx('bestBadge') + ' ' + fmtDiff(t - pb);
        cls = 'bestc';
      } else {
        d.textContent = fmtDiff(t - pb);
        cls = diffCls(t - pb);
      }
      d.className = 'diff ' + cls;
      live.last = { n: e.lap.n, time: t, warn: e.lap.warn, diff: pb == null ? null : t - pb, cls, best };
      live.delta = null;
      if (!e.lap.warn && (pb == null || t < pb)) {
        live.pbLap = t;
        $('#bestLap').textContent = fmtLap(t);
        live.ref = makeRef(rec.session.points, e.lap);
      }
      if (!loop) {
        live.lapStart = null;
        $('#curLap').textContent = fmtLap(t);
        $('#lapNo').textContent = tx('segWait');
      }
      flash('#cellLast', cls);
      lapFlash(live.last, loop);
    } else if (e.type === 'sector') {
      const b = live.pbSp[e.k - 1],
        d = $('#secDiff');
      $('#secLbl').textContent = tx('sectorN', e.k);
      let cls = '';
      if (e.time == null) {
        $('#secTime').textContent = '--';
        d.textContent = tx('missed');
        d.className = 'diff';
      } else {
        $('#secTime').textContent = fmtSec(e.time);
        if (b == null) d.textContent = '';
        else {
          cls = diffCls(e.time - b);
          d.textContent = fmtDiff(e.time - b);
          d.className = 'diff ' + cls;
        }
        if (!e.warn && (b == null || e.time < b)) live.pbSp[e.k - 1] = e.time;
      }
      flash('#cellSec', cls);
    }
  }
}
function handleDrag(evs) {
  const D = live.dragMain,
    pb = live.dragPb;
  for (const e of evs) {
    if (e.type === 'armed') $('#lapNo').textContent = tx('dragReady');
    else if (e.type === 'start') {
      live.lapStart = e.t;
      $('#lapNo').textContent = tx('dragRun');
      $('#dragList').innerHTML = '';
      $('#secTime').textContent = '--';
    } else if (e.type === 'mark') {
      const b = pb.times[e.d],
        diff = b != null ? ` <span class="${diffCls(e.time - b)}">${fmtDiff(e.time - b)}</span>` : '';
      $('#dragList').insertAdjacentHTML(
        'beforeend',
        `<div>${esc(tx('dragRunLine', e.d, fmtS(e.time), Math.round(e.v * spdK())))}${diff}</div>`
      );
    } else if (e.type === 'spd') {
      if (e.s === spdTargets(rec.session.settings.unit === 'mph' ? 'mph' : 'km/h')[0]) $('#secTime').textContent = fmtS(e.time);
      $('#dragList').insertAdjacentHTML('beforeend', `<div>${esc(tx('spdTime', e.s, fmtS(e.time), U()))}</div>`);
    } else if (e.type === 'finish') {
      const r = e.run,
        tm = r.times[D],
        d = $('#lastDiff'),
        b = pb.times[D];
      live.lapStart = null;
      $('#curLap').textContent = tm != null ? fmtS(tm) : fmtS(r.time);
      $('#lastLap').textContent = (tm != null ? fmtS(tm) : '--') + (r.warn ? '⚠' : '');
      if (tm == null || b == null) d.textContent = '';
      else {
        d.textContent = (tm < b && !r.warn ? tx('bestBadge') + ' ' : '') + fmtDiff(tm - b);
        d.className = 'diff ' + (tm < b ? 'bestc' : diffCls(tm - b));
      }
      if (!r.warn) {
        for (const [k, v] of Object.entries(r.times)) if (pb.times[k] == null || v < pb.times[k]) pb.times[k] = v;
        for (const [k, v] of Object.entries(r.spd)) {
          const key = r.spdUnit + ':' + k;
          if (pb.spd[key] == null || v < pb.spd[key]) pb.spd[key] = v;
        }
      }
      $('#bestLap').textContent = pb.times[D] != null ? fmtS(pb.times[D]) : '--';
      $('#lapNo').textContent = tx('dragDone');
      flash('#cellLast', tm != null && b != null ? (tm < b && !r.warn ? 'bestc' : diffCls(tm - b)) : '');
    }
  }
  renderMain();
}
async function wakeOn() {
  const w = $('#wakeText');
  if (!('wakeLock' in navigator)) {
    w.textContent = tx('wakeNo');
    w.className = 'warnText';
    return;
  }
  if (rec.wakeReq) return;
  rec.wakeReq = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    rec.wakeReq = false;
    if (!rec.on) {
      lock.release().catch(() => {});
      return;
    }
    rec.wake = lock;
    rec.wakeHeld = true;
    w.textContent = tx('wakeOk');
    w.className = 'sub';
    lock.addEventListener('release', () => {
      if (rec.wake !== lock) return;
      rec.wakeHeld = false;
      if (rec.on && document.visibilityState === 'visible') wakeOn();
    });
  } catch (e) {
    rec.wakeReq = false;
    w.textContent = tx('wakeFail');
    w.className = 'warnText';
  }
}
async function startRec() {
  if (rec.on || !ready) return;
  if (!consented()) {
    $('#consent').hidden = false;
    return;
  }
  const heldNow = await heldRecLocks();
  if (heldNow && [...heldNow].some(n => n.startsWith(LOCKP) && !rec.releasing.has(n))) {
    alert(tx('otherTab'));
    return;
  }
  if (!('geolocation' in navigator)) {
    alert(tx('noGeo'));
    return;
  }
  if (!window.isSecureContext) {
    alert(tx('needHttps'));
    return;
  }
  if (geo.denied) {
    // 設定で許可し直された場合に備えて、位置の取得をやり直す
    if (geo.watchId != null) navigator.geolocation.clearWatch(geo.watchId);
    geo.watchId = null;
    geo.denied = false;
    startGeo();
  }
  const mode = settings.mode,
    veh = curVehicle();
  let course = null;
  if (hasCourse(mode)) {
    course = selCourse(mode);
    if (!course) {
      alert(tx('noCourse'));
      return;
    }
  }
  let basis = null;
  if (veh.type === 'car' && veh.cal) {
    if (await motionPermission()) basis = makeBasis(veh.cal);
    else alert(tx('motionNo'));
  }
  if (course) {
    const p = courseProblem(course);
    if (p && !confirm(tx('courseIncomplete', p))) return;
  }
  if (course && !courseProblem(course) && ptOk(live.pos) && Date.now() - live.lastFixAt < 30000) {
    // 別の場所のコースを選んだままになっていないか
    const d = distM(live.pos, course.lines[0].c);
    if (d > 5000 && !confirm(tx('farStart', fmtDist(d)))) return;
  }
  if (veh.type === 'car' && !veh.cal && !confirm(tx('calNeededConfirm'))) return;
  if (rec.on) return;
  const s = {
    id: 's' + Date.now(),
    startedAt: Date.now(),
    mode,
    vehicle: vehSnap(veh),
    course: course ? clone(course) : null,
    settings: { minLap: settings.minLap, maxAcc: settings.maxAcc, dragDist: settings.dragDist.slice(), unit: settings.unit },
    points: [],
    laps: [],
    active: true
  };
  if (veh.type === 'car') s.gs = [];
  rec.session = s;
  rec.on = true;
  rec.lastSave = rec.startedAt = Date.now();
  rec.det =
    mode === 'drag' ? new DragDetector(s.settings) : !course || courseProblem(s.course) ? null : new LapDetector(s.course, s.settings);
  sessions.unshift(s);
  holdRecLock(s.id);
  Object.assign(live, {
    lapStart: null,
    err: false,
    gEma: null,
    last: null,
    delta: null,
    pred: null,
    ref: null,
    free: { dist: 0, mov: 0, vmax: 0 }
  });
  $('#lapFlash').hidden = true;
  Object.assign(gm, { trail: [], cur: null, max: veh.type === 'car' ? 30 : 6 });
  Object.assign(mo, { basis, f: 0, l: 0, lastT: 0, lastStore: 0, count: 0 });
  if (basis) motionListen(true);
  ['#lastLap', '#bestLap', '#secTime', '#gLat', '#gLon'].forEach(k => ($(k).textContent = '--'));
  $('#lastDiff').textContent = '';
  $('#secDiff').textContent = '';
  $('#dragList').innerHTML = '';
  $('#lblBest').textContent = tx('pb');
  if (mode === 'free') {
    // 大きな表示は経過時間（renderMain）。下の4つは、今の速度・距離・最高速・平均（走行中）
    $('#curLap').textContent = '--';
    $('#lapNo').textContent = tx('freeSpeed');
    $('#lblLast').textContent = tx('freeDist');
    $('#lblBest').textContent = tx('freeMax');
    $('#secLbl').textContent = tx('freeAvg');
    $('#lastLap').textContent = fmtDist(0);
    $('#cellSec').hidden = false;
    $('#cellCur').hidden = false;
    $('#runLabel').textContent = `${s.vehicle.name}・${tx('modeFree')}`;
  } else if (mode === 'drag') {
    live.dragMain = Math.max(...s.settings.dragDist);
    live.dragPb = dragBest(veh.id);
    $('#curLap').textContent = '0.00';
    $('#lapNo').textContent = tx('dragStop');
    $('#lblLast').textContent = `${tx('lastRun')}  ${distLabel(live.dragMain)}`;
    $('#secLbl').textContent = `0-${spdTargets()[0]}${U()}`;
    $('#cellSec').hidden = false;
    $('#cellCur').hidden = true;
    if (live.dragPb.times[live.dragMain] != null) $('#bestLap').textContent = fmtS(live.dragPb.times[live.dragMain]);
    $('#runLabel').textContent = `${s.vehicle.name}・${tx('modeDrag')} ${s.settings.dragDist.map(distLabel).join('/')}`;
  } else {
    const pb = bestFor(veh.id, course);
    live.pbLap = pb.lap;
    live.pbSp = pb.sp.slice();
    $('#bestLap').textContent = fmtLap(pb.lap);
    $('#curLap').textContent = '-:--.-';
    $('#lapNo').textContent = !rec.det ? tx('recordOnly') : course.type === 'segment' ? tx('segWait') : tx('outLap'); // 小さな枠には短い名前。大きい表示では説明つきにする
    $('#lblLast').textContent = course.type === 'segment' ? tx('lastRun') : tx('lastLap');
    $('#secLbl').textContent = tx('sector');
    $('#cellSec').hidden = nSecOf(course) < 2;
    $('#cellCur').hidden = false;
    const br = rec.det ? bestRef(veh.id, course) : null;
    live.ref = br ? makeRef(br.s.points, br.l) : null;
    $('#runLabel').textContent = `${s.vehicle.name}・${course.name}`;
  }
  $('#gbox').hidden = !settings.liveG;
  layoutCells();
  document.body.classList.add('recording');
  $('#updBar').hidden = true;
  $('#home').hidden = true;
  $('#live').hidden = false;
  if (curTab !== 'v-run') showTab('v-run');
  startGeo();
  wakeOn();
  setNote(tx('recNote'));
  if (veh.type === 'car' && !basis) {
    $('#gLat').textContent = tx('noG');
    $('#gLon').textContent = '';
  }
  drawGMeter(true);
  renderMain();
  DB.append(s).then(ok => {
    if (ok) bcast({ type: 'rec-start', id: s.id });
  });
}
function stopRec() {
  if (!rec.on) return;
  rec.on = false;
  motionListen(false);
  mo.basis = null;
  if (rec.wake) {
    const w = rec.wake;
    rec.wake = null;
    rec.wakeHeld = false;
    w.release().catch(() => {});
  }
  const s = rec.session;
  s.active = false;
  s.endedAt = Date.now();
  const unlock = rec.unlock;
  rec.unlock = null;
  rec.releasing.add(LOCKP + s.id);
  anaCache.delete(s.id);
  analyze(s);
  const cleanup = () => {
    if (unlock) unlock();
    setTimeout(() => rec.releasing.delete(LOCKP + s.id), 1000);
  };
  DB.append(s)
    .catch(() => false)
    .then(ok => {
      cleanup();
      if (ok) {
        bcast({ type: 'rec-stop', id: s.id });
        gsAutoAfterStop(s.id);
      }
      if (impC) setTimeout(showImport, 500);
      homeNote();
      const el = $('#homeNote');
      el.textContent = (ok ? tx('saved', 1) : tx('saveFail')) + (el.textContent ? ' ' + el.textContent : '');
      el.className = 'note' + (ok ? '' : ' warnText');
    });
  document.body.classList.remove('recording');
  showUpdate();
  $('#lapFlash').hidden = true;
  $('#home').hidden = false;
  $('#live').hidden = true;
  $('#wakeText').textContent = '';
  renderHome();
}
$('#startBtn').addEventListener('click', startRec);
function applyDim() {
  document.body.classList.toggle('dim', !!settings.dim);
  $('#dimBtn').textContent = tx(settings.dim ? 'dimOff' : 'dimOn');
  if (!settings.dim && rec.on) drawGMeter(true);
}
$('#dimBtn').addEventListener('click', () => {
  settings.dim = !settings.dim;
  saveSettings();
  applyDim();
});
(() => {
  const b = $('#stopBtn');
  let tm = null;
  const cancel = () => {
    clearTimeout(tm);
    tm = null;
    b.classList.remove('pressing');
  };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    b.classList.add('pressing');
    tm = setTimeout(() => {
      cancel();
      stopRec();
    }, 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, cancel));
  b.addEventListener('contextmenu', e => e.preventDefault());
})();
setInterval(() => {
  updateGps();
  if (!rec.on) return;
  const s = rec.session;
  if (live.lapStart != null) {
    const el = Date.now() - live.clockOff - live.lapStart;
    setText($('#curLap'), s.mode === 'drag' ? (el / 1000).toFixed(1) : fmtLap(el, 1));
  } else if (!rec.det && s.mode !== 'drag' && s.mode !== 'free') setText($('#curLap'), fmtLap(Date.now() - rec.startedAt, 1));
  renderMain();
  // 画面ON固定が外れていたら、5秒おきに取り直す
  if (
    !rec.wakeHeld &&
    !rec.wakeReq &&
    'wakeLock' in navigator &&
    document.visibilityState === 'visible' &&
    Date.now() - (rec.wakeTry || 0) > 5000
  ) {
    rec.wakeTry = Date.now();
    wakeOn();
  }
  if (!settings.dim) drawGMeter();
  if (mo.basis && !mo.count && Date.now() - rec.startedAt > 3000) setNote(tx('motionSilent'), true);
}, 100);
document.addEventListener('visibilitychange', () => {
  if (!rec.on) return;
  if (document.visibilityState === 'visible') {
    if (!rec.wakeHeld) wakeOn();
  } else {
    rec.session.laps = rec.det ? rec.det.laps.map(stripLap) : [];
    DB.append(rec.session);
  }
});
window.addEventListener('beforeunload', e => {
  if (!rec.on) return;
  rec.session.laps = rec.det ? rec.det.laps.map(stripLap) : [];
  DB.append(rec.session);
  e.preventDefault();
  e.returnValue = '';
});
