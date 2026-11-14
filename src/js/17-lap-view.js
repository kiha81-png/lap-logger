// ---------- 1周の詳しい画面 ----------
const MAX_DRAW = 6000; // 1つのグラフに描く点の上限
const LV_RATES = s => (isFree(s) ? [1, 10, 60, 300] : [1, 2, 4]); // 再生の速さ。フリー走行は長いので速く送れるように
const lv = {
  s: null,
  A: null,
  pc: null,
  tr: null,
  cmp: null,
  ctr: null,
  cmpKey: null,
  t: 0,
  playing: false,
  rate: 1,
  raf: 0,
  L: {},
  mode: 'v',
  ci: 0,
  cmpCi: 1
};
function atT(tr, T) {
  let lo = 0,
    hi = tr.length - 1;
  if (T <= tr[lo].t) return Object.assign({}, tr[lo], { i: 0 });
  if (T >= tr[hi].t) return Object.assign({}, tr[hi], { i: hi });
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (tr[m].t <= T) lo = m;
    else hi = m;
  }
  const a = tr[lo],
    b = tr[hi],
    f = (T - a.t) / (b.t - a.t || 1),
    mix = k => (a[k] == null || b[k] == null ? (a[k] ?? b[k]) : a[k] + (b[k] - a[k]) * f);
  return {
    t: T,
    x: mix('x'),
    y: mix('y'),
    v: mix('v'),
    d: mix('d'),
    lat: mix('lat'),
    lon: mix('lon'),
    glat: mix('glat'),
    glon: mix('glon'),
    i: lo
  };
}
function timeAtD(tr, d) {
  let lo = 0,
    hi = tr.length - 1;
  if (d <= tr[lo].d) return tr[lo].t;
  if (d >= tr[hi].d) return tr[hi].t;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (tr[m].d <= d) lo = m;
    else hi = m;
  }
  return tr[lo].t + ((tr[hi].t - tr[lo].t) * (d - tr[lo].d)) / (tr[hi].d - tr[lo].d || 1);
}
function tToD(tr, t) {
  return atT(tr, t).d;
}
function renderLapView() {
  const s = sessById(recState.sid);
  if (!s) {
    recState.view = 'list';
    return renderRec();
  }
  const A = analyze(s),
    pc = A.pieces[recState.pi];
  if (!pc) {
    recState.view = 'sess';
    return renderRec();
  }
  Object.assign(lv, { s, A, pc, tr: getTrace(s, A, pc), ci: recState.pi });
  const free = isFree(s);
  if (free) lv.cmpKey = ''; // 別の道どうしは比べられないので、比較はしない
  $('#cmpRow').style.display = free ? 'none' : '';
  if (!LV_RATES(s).includes(lv.rate)) {
    lv.rate = 1;
  }
  $('#rateBtn').textContent = '×' + lv.rate;
  const others = A.pieces.map((p, i) => ({ p, i })).filter(o => o.i !== recState.pi);
  if (lv.cmpKey == null) {
    const b = bestPiece(A);
    const o = others.find(x => x.p === b);
    lv.cmpKey = o ? String(o.i) : '';
  }
  $('#cmpSel').innerHTML =
    `<option value="">${esc(tx('compareNone'))}</option>` +
    others
      .map(
        ({ p, i }) =>
          `<option value="${i}"${String(i) === lv.cmpKey ? ' selected' : ''}>${esc(tx('compareWith', `${pieceLabel(p)} ${s.mode === 'drag' ? fmtS(p.time) : fmtLap(p.time)}`))}</option>`
      )
      .join('');
  lv.cmp = lv.cmpKey !== '' ? A.pieces[+lv.cmpKey] : null;
  lv.cmpCi = lv.cmp ? +lv.cmpKey : 0;
  lv.ctr = lv.cmp ? getTrace(s, A, lv.cmp) : null;
  $('#lTitle').textContent =
    `${sessName(s)} | ${pieceLabel(pc)}  ${s.mode === 'drag' ? fmtS(pc.time) : free ? fmtDur(pc.time) : fmtLap(pc.time)}`;
  $('#mapMode').value = lv.mode;
  $('#seek').max = Math.round(pc.time);
  lv.t = Math.min(lv.t, pc.time);
  $('#deltaBox').hidden = !lv.cmp;
  buildLapLayers();
  if (free)
    $('#lStats').innerHTML = rideLines(pieceRide(s, pc)).map(esc).join('<br>') + `<br><span class="sub">${esc(tx('rideDef'))}</span>`;
  else {
    const st = lapStats(s, A, pc);
    $('#lStats').innerHTML =
      esc(tx('lapStat1', st.vmin.toFixed(1), st.vmax.toFixed(1), st.vavg.toFixed(1))) +
      (st.hasG ? '<br>' + esc(tx('lapStat2', st.brake.toFixed(1), st.coast.toFixed(1))) : '') +
      `<br><span class="sub">${esc(tx('statDef'))}</span>`;
  }
  lvUpdate();
}
function mapVal(p, mode) {
  if (mode === 'v') return p.v * spdK();
  if (p.glat == null || p.glon == null) return null;
  return mode === 'lat' ? Math.abs(p.glat) : mode === 'lon' ? p.glon : Math.hypot(p.glat, p.glon);
}
function buildLapLayers() {
  const { s, A, pc, ctr, cmp } = lv,
    mode = lv.mode,
    colA = PAL[0],
    colB = PAL[1];
  const g = hasG(s),
    tr = thin(lv.tr, MAX_DRAW); // 長い記録は、描く点だけ間引く
  // 地図
  const mapCv = $('#lMap');
  lv.L.map = makeLayer(mapCv, Math.min(460, Math.max(260, mapCv.clientWidth * 0.95)), (ctx, w, h) => {
    const all = isFree(s) ? [] : thin(s.points, MAX_DRAW).map(A.proj),
      f = fitter(tr.concat(ctr || []), w, h, 26);
    ctx.strokeStyle = '#2a313b';
    ctx.lineWidth = 1;
    strokePath(ctx, all, f);
    if (ctr) {
      ctx.strokeStyle = colB;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      strokePath(ctx, ctr, f);
      ctx.globalAlpha = 1;
    }
    const vals = tr.map(p => mapVal(p, mode)),
      finite = vals.filter(v => v != null);
    const lo = mode === 'lon' ? -amax(finite.map(Math.abs), 0.3) : amin(finite),
      hi = mode === 'lon' ? -lo : amax(finite);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      if (tr[i].gap) continue; // GPSが途切れたところはつながない
      const a = vals[i - 1],
        b = vals[i];
      if (a == null || b == null) {
        ctx.strokeStyle = '#555';
      } else if (mode === 'lon') {
        const v = (a + b) / 2,
          r = Math.min(1, Math.abs(v) / hi);
        ctx.strokeStyle = `hsl(${lonHue(v)},100%,${Math.round(90 - 40 * r)}%)`;
      } else ctx.strokeStyle = seqColor(hi > lo ? ((a + b) / 2 - lo) / (hi - lo) : 0.5);
      ctx.beginPath();
      ctx.moveTo(...f(tr[i - 1]));
      ctx.lineTo(...f(tr[i]));
      ctx.stroke();
    }
    if (s.course) drawCourseLines(ctx, f, s.course, A.proj, -1);
    // ラベル
    const prom = mode === 'v' ? 8 : 0.2;
    const ext = finite.length ? zigzag(vals, prom) : [];
    const placed = [];
    ctx.font = 'bold 12px system-ui';
    for (const e of ext) {
      if (mode === 'lat' || mode === 'sum') {
        if (e.type !== 'max') continue;
      }
      const v = vals[e.i];
      if (v == null) continue;
      const [x, y] = f(tr[e.i]);
      const txt = mode === 'v' ? v.toFixed(0) : (mode === 'lon' && v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
      const tw = ctx.measureText(txt).width + 8,
        bx = Math.min(w - tw - 2, x + 6),
        by = Math.max(2, y - 20);
      if (placed.some(q => Math.abs(q[0] - bx) < tw && Math.abs(q[1] - by) < 18)) continue;
      placed.push([bx, by]);
      const isMin = e.type === 'min';
      ctx.fillStyle = mode === 'v' ? labelCol(isMin) : mode === 'lon' ? labelCol(v < 0) : '#7b2cbf';
      ctx.fillRect(bx, by, tw, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, bx + 4, by + 13);
    }
    return { f, lo, hi };
  });
  const lg = $('#lMapLegend'),
    info = lv.L.map ? lv.L.map.info : null;
  if (!info) lg.textContent = '';
  else if (mode !== 'v' && !g) lg.textContent = tx('noGData');
  else if (mode === 'v')
    lg.innerHTML = `${Math.round(info.lo)} ${U()}<span class="grad" style="background:${SEQ_GRAD()}"></span>${Math.round(info.hi)} ${U()}`;
  else if (mode === 'lon')
    lg.innerHTML = `${esc(tx('brake'))} ${info.hi.toFixed(2)}G<span class="grad" style="background:linear-gradient(90deg,hsl(${lonHue(-1)},100%,50%),hsl(${lonHue(-1)},100%,90%) 50%,hsl(${lonHue(1)},100%,90%) 50%,hsl(${lonHue(1)},100%,50%))"></span>${esc(tx('accel'))} ${info.hi.toFixed(2)}G`;
  else lg.innerHTML = `${info.lo.toFixed(2)}G<span class="grad" style="background:${SEQ_GRAD()}"></span>${info.hi.toFixed(2)}G`;
  if (ctr) lg.insertAdjacentHTML('beforeend', ` <span><span class="sw" style="background:${colB}"></span>${esc(pieceLabel(cmp))}</span>`);
  // 速度
  const LA = tr[tr.length - 1].d || 1,
    LB = ctr ? ctr[ctr.length - 1].d || 1 : 1;
  const box = { L: 36, B: 22, T: 8, Rr: 8 };
  lv.L.spd = makeLayer($('#lSpd'), 220, (ctx, w, h) => {
    const maxV =
        Math.ceil(
          amax(
            tr.concat(ctr || []).map(p => p.v * spdK()),
            0
          ) / 50
        ) * 50 || 50,
      pw = w - box.L - box.Rr,
      ph = h - box.T - box.B;
    const X = d => box.L + (d / LA) * pw,
      Y = v => box.T + ph - (v / maxV) * ph,
      ticks = [];
    for (let v = 0; v <= maxV; v += 50) ticks.push([v, Y(v)]);
    drawAxes(ctx, w, h, box, LA, ticks, v => v);
    if (ctr) {
      ctx.strokeStyle = colB;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctr.forEach((p, i) => {
        const x = X((p.d * LA) / LB),
          y = Y(p.v * spdK());
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = colA;
    ctx.lineWidth = isFree(s) ? 1.5 : 2.5;
    ctx.beginPath();
    tr.forEach((p, i) => (i && !p.gap ? ctx.lineTo(X(p.d), Y(p.v * spdK())) : ctx.moveTo(X(p.d), Y(p.v * spdK()))));
    ctx.stroke();
    return { X, pw };
  });
  $('#lSpdLegend').innerHTML =
    `<span><span class="sw" style="background:${colA}"></span>${esc(pieceLabel(pc))}</span>` +
    (cmp ? `<span><span class="sw" style="background:${colB}"></span>${esc(pieceLabel(cmp))}</span>` : '');
  // タイム差
  lv.L.delta = null;
  if (ctr) {
    const N = 300,
      ser = [];
    for (let i = 0; i <= N; i++) {
      const d = (LA * i) / N;
      ser.push([d, timeAtD(tr, d) - pc.start - (timeAtD(ctr, (d * LB) / LA) - cmp.start)]);
    }
    lv.deltaSer = ser;
    lv.L.delta = makeLayer($('#lDelta'), 180, (ctx, w, h) => {
      const m = Math.max(0.5, ...ser.map(x => Math.abs(x[1]) / 1000)),
        maxS = Math.ceil(m * 2) / 2,
        pw = w - box.L - box.Rr,
        ph = h - box.T - box.B;
      const X = d => box.L + (d / LA) * pw,
        Y = v => box.T + ph / 2 - ((v / maxS) * ph) / 2,
        ticks = [];
      const st = maxS > 2 ? 1 : 0.5;
      for (let v = -maxS; v <= maxS + 1e-9; v += st) ticks.push([v, Y(v)]);
      drawAxes(ctx, w, h, box, LA, ticks, v => (v > 0 ? '+' : '') + v.toFixed(1));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ser.forEach(([d, v], i) => (i ? ctx.lineTo(X(d), Y(v / 1000)) : ctx.moveTo(X(d), Y(v / 1000))));
      ctx.stroke();
      return { X };
    });
  }
  // G（距離）
  lv.L.g = makeLayer($('#lG'), 200, (ctx, w, h) => {
    if (!g) {
      canvasMsg(ctx, tx('noGData'));
      return {};
    }
    const pts = thin(lapGPoints(s, A, pc), MAX_DRAW),
      mx = amax(
        pts.map(p => Math.max(Math.abs(p.lat), Math.abs(p.lon))),
        0
      );
    const maxG = Math.max(0.5, Math.ceil(mx * 2) / 2),
      pw = w - box.L - box.Rr,
      ph = h - box.T - box.B;
    const X = d => box.L + (d / LA) * pw,
      Y = v => box.T + ph / 2 - ((v / maxG) * ph) / 2,
      ticks = [];
    for (let v = -maxG; v <= maxG + 1e-9; v += 0.5) ticks.push([v, Y(v)]);
    drawAxes(ctx, w, h, box, LA, ticks, v => v.toFixed(1));
    const line = (k, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = X(tToD(tr, p.t)),
          y = Y(p[k]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    line('lat', '#64d2ff');
    line('lon', '#ff9f0a');
    return { X };
  });
  $('#lGLegend').innerHTML = g
    ? `<span><span class="sw" style="background:#64d2ff"></span>${esc(tx('latPlus'))}</span><span><span class="sw" style="background:#ff9f0a"></span>${esc(tx('lonPlus'))}</span>`
    : '';
  // G-G
  const ggCv = $('#lGG');
  lv.L.gg = makeLayer(ggCv, Math.min(360, ggCv.clientWidth || 300), (ctx, w, h) => {
    if (!g) {
      canvasMsg(ctx, tx('noGData'));
      return {};
    }
    const pa = thin(lapGPoints(s, A, pc), MAX_DRAW),
      pb = cmp ? thin(lapGPoints(s, A, cmp), MAX_DRAW) : [];
    const mx = amax(
      pa.concat(pb).map(p => Math.max(Math.abs(p.lat), Math.abs(p.lon))),
      0
    );
    const maxG = Math.max(1, Math.ceil(mx * 2) / 2),
      cx = w / 2,
      cy = h / 2,
      r = Math.min(w, h) / 2 - 10;
    drawGRings(ctx, cx, cy, r, maxG);
    const dots = (ps, col, a) => {
      ctx.fillStyle = col;
      ctx.globalAlpha = a;
      for (const p of ps) {
        ctx.beginPath();
        ctx.arc(cx + (p.lat / maxG) * r, cy - (p.lon / maxG) * r, 2.2, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    dots(pb, colB, 0.45);
    dots(pa, colA, 0.8);
    return { cx, cy, r, maxG };
  });
}
function lvUpdate() {
  const { pc, tr, ctr, cmp, s } = lv;
  if (!pc) return;
  const T = pc.start + lv.t,
    P = atT(tr, T),
    Q = ctr ? atT(ctr, cmp.start + lv.t) : null;
  $('#seek').value = Math.round(lv.t);
  const i = P.i,
    a = tr[Math.max(0, i)],
    b = tr[Math.min(tr.length - 1, i + 1)],
    hdg = (bearing(a, b) / D2R + 360) % 360;
  let sec = '-';
  if (pc.splits && pc.splits.length > 1) {
    let acc = 0;
    sec = String(pc.splits.length);
    for (let k = 0; k < pc.splits.length; k++) {
      if (pc.splits[k] == null) {
        sec = '-';
        break;
      }
      acc += pc.splits[k];
      if (lv.t <= acc) {
        sec = String(k + 1);
        break;
      }
    }
  }
  const cells = [
    [tx('rdTime'), s.mode === 'drag' ? fmtS(lv.t) : isFree(s) ? `${fmtDur(lv.t)}（${fmtClock(T)}）` : fmtLap(lv.t)],
    [tx('rdSpeed'), `${(P.v * spdK()).toFixed(1)} ${U()}`]
  ];
  if (ctr) {
    const LA = tr[tr.length - 1].d || 1,
      LB = ctr[ctr.length - 1].d || 1;
    const dl = timeAtD(tr, P.d) - pc.start - (timeAtD(ctr, (P.d * LB) / LA) - cmp.start);
    cells.push([tx('rdDelta'), `<span class="${dl <= 0 ? 'good' : 'bad'}">${fmtDiff(dl)}</span>`]);
  }
  cells.push([tx('gLat'), fmtGLat(P.glat)], [tx('gLon'), fmtGLon(P.glon)]);
  if (pc.splits && pc.splits.length > 1) cells.push([tx('rdSector'), sec]);
  cells.push([tx('rdLat'), P.lat.toFixed(7)], [tx('rdLon'), P.lon.toFixed(7)], [tx('rdHdg'), hdg.toFixed(1) + '°']);
  $('#readout').innerHTML = cells.map(([k, v]) => `<div><i>${esc(k)}</i><b>${v.startsWith('<span') ? v : esc(v)}</b></div>`).join('');
  const L = lv.L;
  if (L.map)
    L.map.frame((c, info) => {
      if (Q) {
        const [qx, qy] = info.f(Q);
        c.fillStyle = PAL[1];
        c.beginPath();
        c.arc(qx, qy, 6, 0, 2 * Math.PI);
        c.fill();
      }
      const [x, y] = info.f(P);
      c.fillStyle = '#fff';
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, 8, 0, 2 * Math.PI);
      c.fill();
      c.stroke();
      const label = `${(P.v * spdK()).toFixed(1)} ${U()}`;
      c.font = 'bold 13px system-ui';
      const tw = c.measureText(label).width + 10,
        bx = Math.min(L.map.w - tw - 2, Math.max(2, x - tw / 2)),
        by = Math.max(2, y - 34);
      c.fillStyle = 'rgba(0,0,0,.75)';
      c.fillRect(bx, by, tw, 20);
      c.fillStyle = '#fff';
      c.fillText(label, bx + 5, by + 14);
    });
  const head = Lr => {
    if (Lr && Lr.info.X)
      Lr.frame((c, info) => {
        const x = info.X(P.d);
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x, 4);
        c.lineTo(x, Lr.h - 20);
        c.stroke();
      });
  };
  head(L.spd);
  head(L.delta);
  head(L.g);
  if (L.gg && L.gg.info.r)
    L.gg.frame((c, info) => {
      if (P.glat == null) return;
      c.fillStyle = '#ffd60a';
      c.beginPath();
      c.arc(info.cx + (P.glat / info.maxG) * info.r, info.cy - (P.glon / info.maxG) * info.r, 7, 0, 2 * Math.PI);
      c.fill();
    });
}
function stopPlay() {
  const was = lv.playing;
  lv.playing = false;
  cancelAnimationFrame(lv.raf);
  $('#playBtn').textContent = '▶';
  if (was && renderPending) {
    renderPending = false;
    if (curTab === 'v-rec') renderRec();
  }
}
function play() {
  if (!lv.pc) return;
  if (lv.t >= lv.pc.time) lv.t = 0;
  lv.playing = true;
  $('#playBtn').textContent = '❚❚';
  let last = performance.now();
  const step = now => {
    if (!lv.playing) return;
    lv.t = Math.min(lv.pc.time, lv.t + (now - last) * lv.rate);
    last = now;
    lvUpdate();
    if (lv.t >= lv.pc.time) stopPlay();
    else lv.raf = requestAnimationFrame(step);
  };
  lv.raf = requestAnimationFrame(step);
}
$('#playBtn').addEventListener('click', () => (lv.playing ? stopPlay() : play()));
$('#rateBtn').addEventListener('click', () => {
  const r = LV_RATES(lv.s);
  lv.rate = r[(r.indexOf(lv.rate) + 1) % r.length];
  $('#rateBtn').textContent = '×' + lv.rate;
});
$('#seek').addEventListener('input', e => {
  stopPlay();
  lv.t = +e.target.value;
  lvUpdate();
});
$('#cmpSel').addEventListener('change', e => {
  lv.cmpKey = e.target.value;
  renderLapView();
});
$('#mapMode').addEventListener('change', e => {
  lv.mode = e.target.value;
  buildLapLayers();
  lvUpdate();
});
function seekToD(d) {
  stopPlay();
  lv.t = Math.max(0, Math.min(lv.pc.time, timeAtD(lv.tr, d) - lv.pc.start));
  lvUpdate();
}
$('#lMap').addEventListener('click', e => {
  const L = lv.L.map;
  if (!L) return;
  const r = e.currentTarget.getBoundingClientRect(),
    x = e.clientX - r.left,
    y = e.clientY - r.top;
  let bi = 0,
    bd = Infinity;
  lv.tr.forEach((p, i) => {
    const [px, py] = L.info.f(p),
      d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  stopPlay();
  lv.t = lv.tr[bi].t - lv.pc.start;
  lvUpdate();
});
['#lSpd', '#lDelta', '#lG'].forEach(sel =>
  $(sel).addEventListener('click', e => {
    const L = sel === '#lSpd' ? lv.L.spd : sel === '#lDelta' ? lv.L.delta : lv.L.g;
    if (!L || !L.info.X) return;
    const r = e.currentTarget.getBoundingClientRect(),
      x = e.clientX - r.left,
      LA = lv.tr[lv.tr.length - 1].d || 1;
    seekToD(Math.max(0, Math.min(LA, ((x - 36) / (L.w - 44)) * LA)));
  })
);
