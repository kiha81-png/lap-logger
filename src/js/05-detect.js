// ---------- 判定 ----------
// サーキット：lines[0] がコントロールライン。セクターk はライン k-1 からライン k（最後はコントロールライン）まで。
// セグメント：lines[0] がスタート、最後がゴール。
class LapDetector {
  constructor(course, opt) {
    this.opt = opt;
    this.loop = course.type !== 'segment';
    const c0 = course.lines[0].c;
    this.proj = makeProj(c0.lat, c0.lon);
    this.lines = course.lines.map(l => lineSeg(l, this.proj));
    this.n = this.lines.length;
    this.nSec = this.loop ? this.n : this.n - 1;
    // 通過の向き：ラインの向き（進行方向）が決まっていれば、その向きに越えたときだけ数える（-1 が進行方向）。
    // 決まっていなければ、最初に越えた向きにそろえる
    this.dir = course.lines.map(l => (num(l.hdg) ? -1 : 0));
    this.prev = null;
    this.lapStart = null;
    this.lastSplit = 0;
    this.next = 1;
    this.splits = [];
    this.warn = false;
    this.laps = [];
    // 0周のときに理由を説明するための記録：コントロールラインの通過（向き・遅すぎ・短すぎ）と、いちばん近づいた距離
    this.diag = {
      fwd: 0,
      rev: 0,
      slow: 0,
      short: 0,
      near: Infinity,
      w: course.lines[0].w,
      gNear: Infinity,
      gw: course.lines[course.lines.length - 1].w
    };
  }
  push(p) {
    const ev = [],
      xy = this.proj(p),
      cur = { t: p.t, x: xy.x, y: xy.y, v: p.v };
    const pr = this.prev;
    this.prev = cur;
    const L0 = this.lines[0],
      dg = this.diag,
      dn = Math.hypot(cur.x - L0.c.x, cur.y - L0.c.y);
    if (dn < dg.near) dg.near = dn;
    if (!this.loop && this.lapStart) {
      const G = this.lines[this.n - 1],
        gn = Math.hypot(cur.x - G.c.x, cur.y - G.c.y);
      if (gn < dg.gNear) dg.gNear = gn;
    }
    if (!pr || cur.t <= pr.t) return ev;
    const gap = cur.t - pr.t > 3000;
    if (gap && this.lapStart) this.warn = true;
    const hits = [];
    for (let i = 0; i < this.n; i++) {
      if (i > 0 && (!this.lapStart || i < this.next)) continue;
      const L = this.lines[i],
        h = segCross(pr, cur, L.a, L.b);
      if (!h) continue;
      const v = pr.v + h.t * (cur.v - pr.v);
      if (this.dir[i] && h.sign !== this.dir[i]) {
        if (i === 0 && v >= MIN_CROSS_V) {
          dg.rev++;
          if (this.loop) ev.push({ type: 'rev' });
        }
        continue;
      }
      if (v < MIN_CROSS_V) {
        if (i === 0) dg.slow++;
        continue;
      }
      if (i === 0) dg.fwd++;
      const x = pr.x + h.t * (cur.x - pr.x),
        y = pr.y + h.t * (cur.y - pr.y);
      hits.push({ i, sign: h.sign, v, t: pr.t + h.t * (cur.t - pr.t), ll: this.proj.inv({ x, y }) });
    }
    hits.sort((a, b) => a.t - b.t);
    for (const h of hits) this._hit(h, gap, ev);
    return ev;
  }
  _hit(h, gap, ev) {
    if (h.i === 0) {
      if (this.loop && this.lapStart) {
        if (h.t - this.lapStart.t < this.opt.minLap * 1000) {
          this.diag.short++;
          return;
        }
        this._split(this.n, h, ev);
        this._finish(h, ev);
      }
      if (!this.dir[0]) this.dir[0] = h.sign;
      this.lapStart = h;
      this.lastSplit = h.t;
      this.next = 1;
      this.splits = new Array(this.nSec).fill(null);
      this.warn = gap;
      ev.push({ type: 'start', t: h.t, n: this.laps.length + 1 });
      return;
    }
    if (!this.dir[h.i]) this.dir[h.i] = h.sign;
    this._split(h.i, h, ev);
    if (!this.loop && h.i === this.n - 1) this._finish(h, ev);
  }
  _split(k, h, ev) {
    if (k === this.next) this.splits[k - 1] = h.t - this.lastSplit;
    else for (let j = this.next; j <= k; j++) this.splits[j - 1] = null;
    this.lastSplit = h.t;
    this.next = k + 1;
    if (this.nSec > 1) ev.push({ type: 'sector', k, time: this.splits[k - 1], warn: this.warn });
  }
  _finish(h, ev) {
    const s = this.lapStart;
    const lap = {
      kind: 'lap',
      n: this.laps.length + 1,
      start: s.t,
      end: h.t,
      time: h.t - s.t,
      splits: this.splits.slice(),
      warn: this.warn,
      sll: s.ll,
      sv: s.v,
      ell: h.ll,
      ev: h.v
    };
    this.laps.push(lap);
    ev.push({ type: 'lap', lap });
    this.lapStart = null;
  }
}
// ドラッグ：2秒止まると準備完了。動き出した時刻は、等加速度とみなして最初のGPS点から逆算する
class DragDetector {
  constructor(opt) {
    this.dists = (opt && opt.dragDist && opt.dragDist.length ? opt.dragDist : [200, 400]).slice().sort((a, b) => a - b);
    this.unit = opt && opt.unit === 'mph' ? 'mph' : 'km/h';
    this.spds = spdTargets(this.unit);
    this.k = this.unit === 'mph' ? MPH : KMH;
    this.state = 'wait';
    this.still = null;
    this.rest = null;
    this.cur = null;
    this.laps = [];
    this.stillPts = null;
    this.prev = null;
  }
  push(p) {
    const ev = [],
      prev = this.prev;
    this.prev = p;
    if (this.state === 'run') {
      this._run(p, ev);
      return ev;
    }
    if (p.v < 1) {
      if (this.still == null) {
        this.still = p.t;
        this.stillPts = [];
      }
      this.stillPts.push(p);
      if (this.stillPts.length > 30) this.stillPts.shift();
      this.rest = p;
      if (this.state === 'wait' && p.t - this.still >= 2000) {
        this.state = 'armed';
        ev.push({ type: 'armed' });
      }
      return ev;
    }
    if (this.state !== 'armed') {
      this.still = null;
      return ev;
    }
    if (p.v < 2 || !this.rest) return ev;
    // 発進地点：止まっていた点の平均。動き出した直後（約2.5秒以内）の点は混ぜない
    const r = this.rest,
      early = (this.stillPts || []).filter(q => q.t < p.t - 2500),
      base = early.length ? early : this.stillPts || [r];
    const A = { lat: base.reduce((a, q) => a + q.lat, 0) / base.length, lon: base.reduce((a, q) => a + q.lon, 0) / base.length };
    this.still = null;
    const waited = p.t - r.t;
    if (waited > 5000) {
      this.state = 'wait';
      return ev;
    } // 測位が途切れた
    // 発進地点からの距離 d は (t - t0)² に比例する。発進後の2点が取れていれば、速度の値を使わずに t0 を求める
    const d2 = distM(A, p),
      d1 = prev ? distM(A, prev) : 0;
    let t0,
      rough = false;
    if (prev && d1 > 2 && d2 > d1 * 1.2) {
      const s1 = Math.sqrt(d1),
        s2 = Math.sqrt(d2);
      t0 = Math.min(prev.t, (prev.t * s2 - p.t * s1) / (s2 - s1));
    } else if (p.sp)
      t0 = Math.min(p.t, p.t - ((2 * d2) / p.v) * 1000); // 端末の速度があれば、それで逆算する
    else if (waited <= 3000)
      return ev; // 位置だけでは近すぎて誤差が大きい。次の点を待つ
    else {
      t0 = r.t;
      rough = true;
    } // 待っても求まらない：最後に止まっていた時刻を発進とし、目安の記録（⚠）にする
    // 発進は、止まっていた点（平均に使った点）の最後より前にはならない
    t0 = Math.max(base[base.length - 1].t, p.t - 8000, t0);
    this.cur = {
      n: this.laps.length + 1,
      start: t0,
      sll: { lat: A.lat, lon: A.lon },
      times: {},
      vAt: {},
      spd: {},
      maxV: 0,
      dist: 0,
      last: { t: t0, v: 0, lat: A.lat, lon: A.lon },
      warn: rough,
      fromRest: true
    };
    this.state = 'run';
    ev.push({ type: 'start', t: t0 });
    this._run(p, ev);
    return ev;
  }
  _run(p, ev) {
    const c = this.cur,
      a = c.last,
      dt = p.t - a.t;
    if (dt <= 0) return;
    if (!c.fromRest && dt > 3000) c.warn = true;
    const seg = distM(a, p),
      d0 = c.dist,
      d1 = d0 + seg;
    for (const D of this.dists) {
      if (c.times[D] != null || d1 < D) continue;
      const fr = (D - d0) / (seg || 1),
        f = c.fromRest ? Math.sqrt(fr) : fr,
        t = a.t + f * dt;
      c.times[D] = t - c.start;
      c.vAt[D] = a.v + f * (p.v - a.v);
      ev.push({ type: 'mark', d: D, time: c.times[D], v: c.vAt[D] });
    }
    for (const S of this.spds) {
      const sv = S / this.k;
      if (c.spd[S] != null || p.v < sv || a.v >= sv) continue;
      c.spd[S] = a.t + ((sv - a.v) / (p.v - a.v || 1)) * dt - c.start;
      ev.push({ type: 'spd', s: S, time: c.spd[S] });
    }
    c.dist = d1;
    c.maxV = Math.max(c.maxV, p.v);
    c.last = p;
    c.fromRest = false;
    const done = c.times[this.dists[this.dists.length - 1]] != null;
    if (done || p.v < 1 || (c.maxV > 5 && p.v < c.maxV * 0.5)) this._finish(ev);
  }
  _finish(ev) {
    const c = this.cur,
      l = c.last;
    const run = {
      kind: 'run',
      n: c.n,
      start: c.start,
      end: l.t,
      time: l.t - c.start,
      sll: c.sll,
      sv: 0,
      ell: { lat: l.lat, lon: l.lon },
      ev: l.v,
      times: c.times,
      vAt: c.vAt,
      spd: c.spd,
      spdUnit: this.unit,
      maxV: c.maxV,
      dist: c.dist,
      warn: c.warn,
      splits: []
    };
    this.laps.push(run);
    this.cur = null;
    this.state = 'wait';
    this.still = null;
    ev.push({ type: 'finish', run });
  }
}
const stripLap = l => ({
  n: l.n,
  time: l.time,
  splits: l.splits || [],
  warn: !!l.warn,
  excl: !!l.excl,
  times: l.times,
  spd: l.spd,
  spdUnit: l.spdUnit,
  maxV: l.maxV
});
// 除外は開始時刻で覚える（再計算で時刻が少しずれても、3秒以内なら同じラップとみなす）
const isExcl = (s, l) => (s.excluded || []).some(t => Math.abs(t - l.start) < 3000);
function bestFor(vehId, course) {
  const key = courseKey(course),
    sp = new Array(nSecOf(course)).fill(null);
  let lap = null;
  for (const s of sessions) {
    if (s.mode === 'drag' || !s.vehicle || s.vehicle.id !== vehId || !s.course || courseKey(s.course) !== key) continue;
    for (const l of s.laps || []) {
      if (l.warn || l.excl) continue;
      if (lap == null || l.time < lap) lap = l.time;
      (l.splits || []).forEach((v, k) => {
        if (v != null && (sp[k] == null || v < sp[k])) sp[k] = v;
      });
    }
  }
  return { lap, sp };
}
function dragBest(vehId) {
  const times = {},
    spd = {};
  for (const s of sessions) {
    if (s.mode !== 'drag' || !s.vehicle || s.vehicle.id !== vehId) continue;
    for (const r of s.laps || []) {
      if (r.warn || r.excl) continue;
      for (const [k, v] of Object.entries(r.times || {})) if (times[k] == null || v < times[k]) times[k] = v;
      for (const [k, v] of Object.entries(r.spd || {})) {
        const key = (r.spdUnit || 'km/h') + ':' + k;
        if (spd[key] == null || v < spd[key]) spd[key] = v;
      }
    }
  }
  return { times, spd };
}
