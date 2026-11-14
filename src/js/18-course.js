// ---------- コースタブ ----------
const cv = { id: null, sel: 0, trace: null, z: 1, ox: 0, oy: 0, hit: null };
const editCourse = () => courseById(cv.id) || courses[0];
function courseSessions(c) {
  return sessions.filter(s => s.mode !== 'drag' && s.course && s.course.id === c.id && s.points.length > 2);
}
// 軌跡に使える記録：このコースのものを先に、ほかのコースの記録も選べる
function traceCands(c) {
  const own = courseSessions(c),
    other = sessions.filter(s => s.mode !== 'drag' && s.points.length > 2 && !own.includes(s));
  return own.concat(other).filter(s => !s.active);
}
function traceSessions(c) {
  if (cv.trace === '*') return courseSessions(c).filter(s => !s.active);
  const s = sessById(cv.trace);
  return s && !s.active && s.mode !== 'drag' && s.points.length > 2 ? [s] : [];
}
function renderCourseTab() {
  const c = editCourse();
  cv.id = c.id;
  if (cv.sel >= c.lines.length) cv.sel = 0;
  $('#cSel').innerHTML = courses
    .map(
      x =>
        `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${esc(x.name)}（${esc(tx(x.type === 'segment' ? 'modeSegment' : 'modeCircuit'))}）</option>`
    )
    .join('');
  $('#cName').value = c.name;
  $$('#cType button').forEach(b => b.classList.toggle('on', b.dataset.t === c.type));
  const own = courseSessions(c).filter(s => !s.active),
    cands = traceCands(c);
  if (!(cv.trace === '*' && own.length) && !cands.some(s => s.id === cv.trace))
    cv.trace = own.length ? '*' : cands.length ? cands[0].id : null;
  $('#cSessSel').innerHTML = cands.length
    ? (own.length ? `<option value="*">${esc(tx('allSess'))}</option>` : '') +
      cands
        .map(
          s =>
            `<option value="${esc(s.id)}">${fmtDate(s.startedAt)}・${esc(s.vehicle ? s.vehicle.name : '')}${isFree(s) ? '・' + esc(tx('modeFree')) : s.course && s.course.id !== c.id ? '・' + esc(s.course.name) : ''}</option>`
        )
        .join('')
    : `<option value="">${esc(tx('noSessForCourse'))}</option>`;
  if (cv.trace) $('#cSessSel').value = cv.trace;
  $('#cAuto').disabled = $('#cBuild').disabled = !cands.length;
  $('#cTapHint').textContent = tx('tapPlace', lineName(c, cv.sel));
  $('#cLines').innerHTML = c.lines.map((l, i) => lineCardHtml(c, l, i)).join('');
  $('#cRound').hidden = c.type !== 'segment';
  renderCourseStatus();
  drawCoursePreview();
  drawLineZoom();
}
// コースが完成しているか。完成していれば、走った記録で実際に計測できるかも試して見せる
function courseTry(c, s) {
  const det = new LapDetector(c, Object.assign({}, DEFAULT_OPT, { minLap: settings.minLap, maxAcc: settings.maxAcc }));
  for (const p of s.points) det.push(p);
  return det;
}
function renderCourseStatus() {
  const el = $('#cStatus'),
    c = editCourse(),
    prob = courseProblem(c);
  if (prob) {
    el.innerHTML = `<b class="warnText">${esc(tx('csNg'))}</b><br>${esc(prob)}`;
    return;
  }
  let h = `<b class="good">${esc(tx('csOk'))}</b>`;
  // 近く（2km以内）を走った記録だけで試す。新しいものから3件まで
  const P0 = c.lines[0].c,
    tried = [];
  for (const s of traceCands(c)) {
    if (tried.length >= 3) break;
    if (isFree(s) || s.points.length > 20000 || !s.points.some((p, i) => i % 5 === 0 && distM(p, P0) < 2000)) continue;
    tried.push(s);
  }
  if (!tried.length) h += `<br>${esc(tx('csNoTrace'))}`;
  for (const s of tried) {
    const det = courseTry(c, s),
      ok = det.laps.filter(l => !l.warn),
      best = ok.length ? fmtLap(Math.min(...ok.map(l => l.time))) : det.laps.length ? fmtLap(det.laps[0].time) : '';
    const r = det.laps.length
      ? tx(c.type === 'segment' ? 'csTryRuns' : 'csTryLaps', det.laps.length, best)
      : tx('csTry0') + why0(det, settings.minLap).lines.join(' ');
    h += `<br>${esc(tx('csTry', fmtDate(s.startedAt), r))}`;
  }
  el.innerHTML = h;
}
// セグメント：スタートと同じ地点に、逆向きのゴールを置く。スタートの向きは、走った記録で最初にそこを通った向きにそろえる
$('#cRound').addEventListener('click', () => {
  const c = editCourse(),
    st = c.lines[0],
    gl = c.lines[c.lines.length - 1];
  if (c.type !== 'segment' || !ptOk(st.c)) {
    alert(tx('roundNeed'));
    return;
  }
  let first = null;
  for (const s of traceCands(c).filter(x => !x.active && !isFree(x))) {
    const { out } = nearSegs(st.c, [s], 25);
    if (out.length) {
      first = out[0].dir;
      break;
    }
  }
  if (first != null) st.hdg = (((first / D2R) % 360) + 360) % 360;
  else if (!num(st.hdg)) {
    alert(tx('probHdg', lineName(c, 0)));
    return;
  }
  gl.c = { lat: st.c.lat, lon: st.c.lon };
  gl.hdg = (st.hdg + 180) % 360;
  gl.w = st.w;
  saveCourses();
  renderCourseTab();
  alert(tx('roundDone'));
});
function lineSummary(l) {
  if (!ptOk(l.c)) return tx('ptUnset');
  return num(l.hdg) ? tx('lineSummary', Math.round(l.hdg), Math.round(l.w)) : `${tx('hdgUnset')}・${Math.round(l.w)}m`;
}
function lineCardHtml(c, l, i) {
  const sel = i === cv.sel;
  return `<div class="lineCard${sel ? ' sel' : ''}" data-i="${i}">
    <div class="lineHead" data-act="pick"><b>${esc(lineName(c, i))}</b><span class="sub" data-sum>${esc(lineSummary(l))}</span></div>
    ${
      sel
        ? `<div class="lineBody">
      <div class="row"><input class="pt" data-f="pt" placeholder="${esc(tx('ptPh'))}" value="${ptOk(l.c) ? l.c.lat.toFixed(6) + ', ' + l.c.lon.toFixed(6) : ''}"><button data-act="paste">${esc(tx('paste'))}</button><button data-act="here">${esc(tx('here'))}</button></div>
      <canvas class="zoom" data-zoom></canvas>
      <div class="pad">
        <button data-act="mv" data-v="5">${esc(tx('fwd', 5))}</button><button data-act="mv" data-v="1">${esc(tx('fwd', 1))}</button>
        <button data-act="mv" data-v="-1">${esc(tx('bwd', 1))}</button><button data-act="mv" data-v="-5">${esc(tx('bwd', 5))}</button>
        <button class="w2" data-act="sd" data-v="-1">${esc(tx('leftM', 1))}</button><button class="w2" data-act="sd" data-v="1">${esc(tx('rightM', 1))}</button>
        <button data-act="rot" data-v="-5">${esc(tx('rotL', 5))}</button><button data-act="rot" data-v="-1">${esc(tx('rotL', 1))}</button>
        <button data-act="rot" data-v="1">${esc(tx('rotR', 1))}</button><button data-act="rot" data-v="5">${esc(tx('rotR', 5))}</button>
        <button class="w2" data-act="wd" data-v="-2">${esc(tx('wMinus'))}</button><button class="w2" data-act="wd" data-v="2">${esc(tx('wPlus'))}</button>
        <button class="w2" data-act="snap">${esc(tx('snap'))}</button><button class="w2" data-act="hdg1">${esc(tx('hdgThis'))}</button>
        ${i === 0 || (c.type === 'segment' && i === c.lines.length - 1) ? '' : `<button class="w4 danger" data-act="del">${esc(tx('delLine'))}</button>`}
      </div></div>`
        : ''
    }
  </div>`;
}
function previewData(c) {
  return traceSessions(c)
    .slice(0, 5)
    .map(s => s.points);
}
function drawCoursePreview() {
  const g = setupCanvas($('#cPreview'), 320);
  cv.hit = null;
  if (!g) return;
  const c = editCourse(),
    { ctx, w, h } = g,
    ready = c.lines.filter(l => ptOk(l.c)),
    raw = previewData(c);
  // 走行の記録があれば、それを基準に表示する（線を置いても図が動かない）
  const o = raw.length ? raw[0][0] : ready.length ? ready[0].c : null;
  if (!o) return canvasMsg(ctx, tx('noLinesYet'));
  const key =
    o.lat +
    ',' +
    o.lon +
    '|' +
    traceSessions(c)
      .slice(0, 5)
      .map(s => s.id + ':' + (s.rev || 0) + ':' + s.points.length)
      .join(',');
  if (!cv.cache || cv.cache.key !== key) {
    const pj = makeProj(o.lat, o.lon);
    cv.cache = {
      key,
      proj: pj,
      traces: raw.map(ps =>
        ps.map(p => {
          const q = pj(p);
          q.t = p.t;
          return q;
        })
      )
    };
  }
  const { proj, traces } = cv.cache;
  const pts = traces.length
    ? [].concat(...traces)
    : [].concat(...ready.map(l => (num(l.hdg) ? [lineSeg(l, proj).a, lineSeg(l, proj).b] : [proj(l.c)])));
  const base = fitter(
    pts.length > 1
      ? pts
      : pts.concat([
          { x: 60, y: 60 },
          { x: -60, y: -60 }
        ]),
    w,
    h,
    22
  );
  // 拡大・移動：画面上の座標を、中央を基準に z 倍して (ox, oy) ずらす
  const f = p => {
    const [X, Y] = base(p);
    return [(X - w / 2) * cv.z + w / 2 + cv.ox, (Y - h / 2) * cv.z + h / 2 + cv.oy];
  };
  f.sc = base.sc * cv.z;
  f.inv = (X, Y) => base.inv((X - w / 2 - cv.ox) / cv.z + w / 2, (Y - h / 2 - cv.oy) / cv.z + h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.strokeStyle = '#6b7480';
  ctx.lineWidth = 2;
  for (const tr of traces) {
    // 測位が途切れたところは線をつながない
    ctx.beginPath();
    let lx = 0,
      ly = 0;
    tr.forEach((p, i) => {
      const [X, Y] = f(p);
      if (!i || p.t - tr[i - 1].t > 3000) {
        ctx.moveTo(X, Y);
        lx = X;
        ly = Y;
      } else if (Math.abs(X - lx) + Math.abs(Y - ly) >= 1 || i === tr.length - 1) {
        ctx.lineTo(X, Y);
        lx = X;
        ly = Y;
      }
    });
    ctx.stroke();
  }
  drawCourseLines(ctx, f, c, proj, cv.sel);
  ctx.restore();
  cv.hit = { f, proj, traces, w, h };
}
// 画面の (X, Y) に一番近い走行区間。maxPx より遠ければ null
function nearestTrace(X, Y, maxPx) {
  const H = cv.hit;
  if (!H) return null;
  const P = H.f.inv(X, Y),
    lim = maxPx / H.f.sc;
  let best = null;
  for (const tr of H.traces) {
    for (let i = 1; i < tr.length; i++) {
      if (tr[i].t - tr[i - 1].t > 3000) continue;
      const a = tr[i - 1],
        b = tr[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        L2 = dx * dx + dy * dy;
      if (L2 < 0.25) continue;
      const k = Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / L2)),
        q = { x: a.x + k * dx, y: a.y + k * dy };
      const d = Math.hypot(q.x - P.x, q.y - P.y);
      if (d <= lim && (!best || d < best.d)) best = { d, q, dir: Math.atan2(dx, dy) };
    }
  }
  return best && { c: H.proj.inv(best.q), dir: best.dir };
}
// 走行区間の上に線を置く。同じ向きで通った周の平均の位置・向きにそろえる
function placeLine(l, c0, dir, arr) {
  l.c = c0;
  l.hdg = (((dir / D2R) % 360) + 360) % 360;
  snapLine(l, arr);
  const { out } = nearSegs(l.c, arr, 15),
    ref = l.hdg * D2R,
    use = out.filter(o => Math.cos(o.dir - ref) > 0.7);
  if (use.length) {
    const sx = use.reduce((a, o) => a + Math.sin(o.dir), 0),
      sy = use.reduce((a, o) => a + Math.cos(o.dir), 0);
    l.hdg = (Math.atan2(sx, sy) / D2R + 360) % 360;
  }
}
// 周回を見つけて、スタート/ゴールの位置と向きを決める（見つからなければ null）
function findStartLine(arr) {
  let best = null;
  for (const s of arr) {
    const ps = s.points;
    if (ps.length < 20) continue;
    const pr = makeProj(ps[0].lat, ps[0].lon),
      q = [],
      CELL = 20;
    // 更新間隔が短いと点の揺れが距離や向きを乱すので、4m 以上離れた点だけを使う
    let dist = 0,
      lastT = -Infinity;
    for (let i = 0; i < ps.length; i++) {
      const x = pr(ps[i]),
        pv = q[q.length - 1],
        gap = ps[i].t - lastT > 3000;
      lastT = ps[i].t;
      if (pv && !gap) {
        const d = Math.hypot(x.x - pv.x, x.y - pv.y);
        if (d < 4) continue;
        dist += d;
      }
      if (pv && gap) x.gap = true;
      x.s = dist;
      x.v = ps[i].v || 0;
      q.push(x);
    }
    for (let i = 0; i < q.length; i++) {
      // 向き：前後2点から
      const a = q[Math.max(0, i - 2)],
        b = q[Math.min(q.length - 1, i + 2)];
      q[i].dir = Math.atan2(b.x - a.x, b.y - a.y);
    }
    const grid = new Map(),
      key = (gx, gy) => gx + ',' + gy;
    q.forEach((p, i) => {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    let lastS = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const p = q[i];
      if (p.s - lastS < 5 || p.v < MIN_CROSS_V * 2) continue;
      lastS = p.s;
      // まっすぐか：前後 80m の向きが ±12° 以内
      let ok = true,
        sumV = 0,
        nV = 0;
      for (let j = i; j >= 0 && p.s - q[j].s <= 80 && ok; j--) {
        if (q[j].gap && j !== i) {
          ok = false;
          break;
        }
        if (Math.cos(q[j].dir - p.dir) < Math.cos(12 * D2R)) ok = false;
        sumV += q[j].v;
        nV++;
      }
      for (let j = i + 1; j < q.length && q[j].s - p.s <= 80 && ok; j++) {
        if (q[j].gap) {
          ok = false;
          break;
        }
        if (Math.cos(q[j].dir - p.dir) < Math.cos(12 * D2R)) ok = false;
        sumV += q[j].v;
        nV++;
      }
      if (!ok || !nV) continue;
      // 同じ場所を同じ向きで通った回数（200m 以上走ってから戻ってきたら、別の周）
      const near = [],
        gx = Math.floor(p.x / CELL),
        gy = Math.floor(p.y / CELL);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(key(gx + dx, gy + dy)) || []) {
            const o = q[j];
            if (Math.hypot(o.x - p.x, o.y - p.y) < 12 && Math.cos(o.dir - p.dir) > 0.9) near.push(o.s);
          }
      near.sort((a, b) => a - b);
      let passes = 0,
        prevS = -Infinity;
      for (const v of near) {
        if (v - prevS > 200) passes++;
        prevS = v;
      }
      if (passes < 2) continue;
      const score = passes * 1000 + sumV / nV;
      if (!best || score > best.score) best = { score, passes, c: pr.inv(p), dir: p.dir };
    }
  }
  return best;
}
let pz = null,
  pzRaf = 0; // 図の上の指（pointerId → 位置）
const redrawSoon = () => {
  if (!pzRaf)
    pzRaf = requestAnimationFrame(() => {
      pzRaf = 0;
      drawCoursePreview();
    });
};
function zoomAt(X, Y, k) {
  const z = Math.max(1, Math.min(60, cv.z * k)),
    H = cv.hit;
  if (!H) return;
  // (X, Y) の下にある点が動かないように、ずらし量を直す
  cv.ox = X - H.w / 2 - ((X - H.w / 2 - cv.ox) / cv.z) * z;
  cv.oy = Y - H.h / 2 - ((Y - H.h / 2 - cv.oy) / cv.z) * z;
  cv.z = z;
  if (z === 1) {
    cv.ox = 0;
    cv.oy = 0;
  }
  if (pz) redrawSoon();
  else drawCoursePreview();
}
function tapPreview(X, Y) {
  const c = editCourse(),
    l = c.lines[cv.sel],
    hit = nearestTrace(X, Y, 28);
  if (!l) return;
  if (!hit) {
    alert(tx('tapFar'));
    return;
  }
  placeLine(l, hit.c, hit.dir, traceSessions(c));
  refreshLine();
}
{
  const el = $('#cPreview'),
    pos = e => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
  el.addEventListener('pointerdown', e => {
    if (!pz) pz = { pts: new Map(), moved: 0, multi: false, start: pos(e) };
    pz.pts.set(e.pointerId, pos(e));
    if (pz.pts.size > 1) pz.multi = true;
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {}
  });
  el.addEventListener('pointermove', e => {
    if (!pz || !pz.pts.has(e.pointerId)) return;
    const before = [...pz.pts.values()],
      p = pos(e);
    pz.pts.set(e.pointerId, p);
    const after = [...pz.pts.values()];
    if (after.length >= 2) {
      const [a0, b0] = before,
        [a1, b1] = after,
        d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]),
        d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
      const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2],
        m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
      if (cv.z > 1 || d1 > d0) {
        cv.ox += m1[0] - m0[0];
        cv.oy += m1[1] - m0[1];
      }
      if (d0 > 0) zoomAt(m1[0], m1[1], d1 / d0);
      else redrawSoon();
    } else {
      pz.moved = Math.max(pz.moved, Math.hypot(p[0] - pz.start[0], p[1] - pz.start[1]));
      if (cv.z > 1 && pz.moved > 8) {
        cv.ox += p[0] - before[0][0];
        cv.oy += p[1] - before[0][1];
        redrawSoon();
      }
    }
  });
  const end = e => {
    if (!pz || !pz.pts.has(e.pointerId)) return;
    pz.pts.delete(e.pointerId);
    if (pz.pts.size) return;
    const tap = e.type === 'pointerup' && !pz.multi && pz.moved <= 8,
      p = pos(e);
    pz = null;
    drawCoursePreview();
    if (tap) tapPreview(p[0], p[1]);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}
$('#cZin').addEventListener('click', () => {
  if (cv.hit) zoomAt(cv.hit.w / 2, cv.hit.h / 2, 2);
});
$('#cZout').addEventListener('click', () => {
  if (cv.hit) zoomAt(cv.hit.w / 2, cv.hit.h / 2, 0.5);
});
$('#cZfit').addEventListener('click', () => {
  cv.z = 1;
  cv.ox = cv.oy = 0;
  drawCoursePreview();
});
$('#cSessSel').addEventListener('change', e => {
  cv.trace = e.target.value || null;
  cv.z = 1;
  cv.ox = cv.oy = 0;
  drawCoursePreview();
  drawLineZoom();
});
function offerRecalc(c, arr) {
  const done = arr.filter(s => !s.active && !isFree(s)),
    prob = courseProblem(c);
  if (!done.length) return;
  if (prob) {
    alert(prob);
    return;
  } // まだ使えないコース：何が足りないかを伝える
  if (!confirm(tx('recalcInto', done.length, c.name, done.filter(s => !s.course || s.course.id !== c.id).length))) return;
  done.forEach(s => recalcSession(s, false, c));
  if (curTab === 'v-course') renderCourseTab();
}
$('#cBuild').addEventListener('click', () => {
  const c = editCourse(),
    arr = traceSessions(c);
  if (c.type === 'segment') {
    alert(tx('autoBuildSeg'));
    return;
  }
  if (!arr.length) return;
  const r = findStartLine(arr);
  if (!r) {
    alert(tx('autoBuildNone'));
    return;
  }
  const l = c.lines[0];
  if (ptOk(l.c) && !confirm(tx('autoBuildOver'))) return;
  placeLine(l, r.c, r.dir, arr);
  cv.sel = 0;
  saveCourses();
  renderCourseTab();
  alert(tx('autoBuildDone', r.passes));
  offerRecalc(c, arr);
});
function drawLineZoom() {
  const el = $('[data-zoom]');
  if (!el) return;
  const g = setupCanvas(el, 240);
  if (!g) return;
  const c = editCourse(),
    l = c.lines[cv.sel],
    { ctx, w, h } = g;
  if (!ptOk(l.c)) return canvasMsg(ctx, tx('needPoint'));
  const proj = makeProj(l.c.lat, l.c.lon),
    Rm = Math.max(35, l.w * 0.9);
  const sc = Math.min(w, h) / (2 * Rm),
    f = p => [w / 2 + p.x * sc, h / 2 - p.y * sc];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.strokeStyle = '#5b6470';
  ctx.lineWidth = 1.5;
  for (const ps of previewData(c)) {
    ctx.beginPath();
    let pen = false;
    for (const p of ps) {
      const q = proj(p);
      if (Math.abs(q.x) > Rm * 3 || Math.abs(q.y) > Rm * 3) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(...f(q));
      else {
        ctx.moveTo(...f(q));
        pen = true;
      }
    }
    ctx.stroke();
  }
  c.lines.forEach((o, i) => {
    if (i !== cv.sel && ptOk(o.c) && num(o.hdg)) {
      const s = lineSeg(o, proj);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...f(s.a));
      ctx.lineTo(...f(s.b));
      ctx.stroke();
    }
  });
  if (num(l.hdg)) {
    const s = lineSeg(l, proj);
    ctx.strokeStyle = '#2f7bff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(...f(s.a));
    ctx.lineTo(...f(s.b));
    ctx.stroke();
    const tip = { x: Math.sin(l.hdg * D2R) * 14, y: Math.cos(l.hdg * D2R) * 14 };
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(...f({ x: 0, y: 0 }));
    ctx.lineTo(...f(tip));
    ctx.stroke();
    const back = a => ({ x: tip.x - Math.sin((l.hdg + a) * D2R) * 5, y: tip.y - Math.cos((l.hdg + a) * D2R) * 5 });
    ctx.beginPath();
    ctx.moveTo(...f(back(30)));
    ctx.lineTo(...f(tip));
    ctx.lineTo(...f(back(-30)));
    ctx.stroke();
  }
  ctx.fillStyle = '#2f7bff';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, h - 12);
  ctx.lineTo(12 + 10 * sc, h - 12);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui';
  ctx.fillText('10 m', 12, h - 18);
}
// ライン中心から radius 以内を通った走行区間（向きと、中心に一番近い点）
function nearSegs(c, sessArr, radius) {
  const pr = makeProj(c.lat, c.lon),
    out = [];
  for (const s of sessArr) {
    const ps = s.points;
    for (let i = 1; i < ps.length; i++) {
      if (ps[i].t - ps[i - 1].t > 3000) continue;
      const a = pr(ps[i - 1]),
        b = pr(ps[i]),
        dx = b.x - a.x,
        dy = b.y - a.y,
        L2 = dx * dx + dy * dy;
      if (L2 < 1) continue;
      const k = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / L2)),
        q = { x: a.x + k * dx, y: a.y + k * dy },
        d = Math.hypot(q.x, q.y);
      if (d <= radius) out.push({ q, dir: Math.atan2(dx, dy), d });
    }
  }
  return { out, pr };
}
function autoHeadingLine(l, sessArr) {
  const { out } = nearSegs(l.c, sessArr, 25);
  if (!out.length) return 'none';
  let sx = 0,
    sy = 0;
  for (const o of out) {
    sx += Math.sin(o.dir);
    sy += Math.cos(o.dir);
  }
  if (Math.hypot(sx, sy) / out.length < 0.5) return 'mixed';
  l.hdg = (Math.atan2(sx, sy) / D2R + 360) % 360;
  return 'ok';
}
function autoHeadings(c, sessArr) {
  const msgs = [];
  let n = 0;
  c.lines.forEach((l, i) => {
    if (!ptOk(l.c)) return;
    const r = autoHeadingLine(l, sessArr);
    if (r === 'ok') n++;
    else msgs.push(tx(r === 'none' ? 'autoNoNear' : 'autoMixed', lineName(c, i)));
  });
  saveCourses();
  alert([tx('autoDone', n)].concat(msgs).join('\n'));
  if (curTab === 'v-course') renderCourseTab();
  return n > 0;
}
function snapLine(l, sessArr) {
  const { out, pr } = nearSegs(l.c, sessArr, 25);
  const ref = num(l.hdg) ? l.hdg * D2R : null;
  const use = out.filter(o => ref == null || Math.cos(o.dir - ref) > 0.7);
  if (!use.length) return false;
  const mx = use.reduce((a, o) => a + o.q.x, 0) / use.length,
    my = use.reduce((a, o) => a + o.q.y, 0) / use.length;
  l.c = pr.inv({ x: mx, y: my });
  return true;
}
function refreshLine() {
  const c = editCourse(),
    l = c.lines[cv.sel],
    card = $(`.lineCard[data-i="${cv.sel}"]`);
  saveCourses();
  if (card) {
    card.querySelector('[data-sum]').textContent = lineSummary(l);
    const inp = card.querySelector('[data-f=pt]');
    if (inp) inp.value = ptOk(l.c) ? l.c.lat.toFixed(6) + ', ' + l.c.lon.toFixed(6) : '';
  }
  renderCourseStatus();
  drawCoursePreview();
  drawLineZoom();
}
function sampleHere(btn) {
  return new Promise(resolve => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      alert(tx('needHttps'));
      return resolve(null);
    }
    const fixes = [],
      label = btn.textContent;
    let done = false,
      winTimer = null,
      id = null;
    btn.disabled = true;
    btn.textContent = tx('measuring', '');
    const finish = () => {
      if (done) return;
      done = true;
      if (id != null) navigator.geolocation.clearWatch(id);
      clearTimeout(winTimer);
      clearTimeout(maxTimer);
      btn.disabled = false;
      btn.textContent = label;
      if (!fixes.length) {
        alert(tx('noHere'));
        return resolve(null);
      }
      const bestAcc = Math.min(...fixes.map(f => f.accuracy)),
        use = fixes.filter(f => f.accuracy <= bestAcc * 1.5);
      const avg = k => use.reduce((a, f) => a + f[k], 0) / use.length;
      resolve({ lat: avg('latitude'), lon: avg('longitude') });
    };
    const maxTimer = setTimeout(finish, 20000);
    id = navigator.geolocation.watchPosition(
      p => {
        fixes.push(p.coords);
        btn.textContent = tx('measuring', fixes.length);
        if (!winTimer) winTimer = setTimeout(finish, 6000);
      },
      e => {
        if (e.code === 1) {
          alert(tx('geoDeniedShort'));
          finish();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  });
}
$('#cLines').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const card = el.closest('.lineCard'),
    i = +card.dataset.i,
    c = editCourse(),
    l = c.lines[i],
    act = el.dataset.act;
  if (act === 'pick') {
    cv.sel = i;
    renderCourseTab();
    return;
  }
  const v = +el.dataset.v,
    needPt = ['mv', 'sd', 'rot', 'wd', 'snap', 'hdg1'];
  if (needPt.includes(act) && !ptOk(l.c)) {
    alert(tx('needPoint'));
    return;
  }
  if (act === 'mv' || act === 'sd') {
    const h = num(l.hdg) ? l.hdg : 0;
    l.c = offsetLL(l.c, act === 'mv' ? h : h + 90, v);
  } else if (act === 'rot') l.hdg = ((((num(l.hdg) ? l.hdg : 0) + v) % 360) + 360) % 360;
  else if (act === 'wd') l.w = Math.max(4, Math.min(200, l.w + v));
  else if (act === 'snap') {
    if (!snapLine(l, traceSessions(c))) {
      alert(tx('snapNo'));
      return;
    }
  } else if (act === 'hdg1') {
    const r = autoHeadingLine(l, traceSessions(c));
    if (r !== 'ok') {
      alert(tx(r === 'none' ? 'autoNoNear' : 'autoMixed', lineName(c, i)));
      return;
    }
  } else if (act === 'paste') {
    try {
      const p = parseLatLon(await navigator.clipboard.readText());
      if (!p) {
        alert(tx('badPoint'));
        return;
      }
      l.c = p;
    } catch (err) {
      alert(tx('pasteFail'));
      return;
    }
  } else if (act === 'here') {
    const r = await sampleHere(el);
    if (!r) return;
    if (c.lines.includes(l)) l.c = r;
    else if (c.lines[i])
      c.lines[i].c = r; // 測定中に種別を切り替えて、線が作り直された
    else return;
  } else if (act === 'del') {
    const fixed = i === 0 || (c.type === 'segment' && i === c.lines.length - 1);
    if (fixed) {
      alert(tx('cantDelLine'));
      return;
    }
    if (!confirm(tx('delLineConfirm', lineName(c, i)))) return;
    c.lines.splice(i, 1);
    cv.sel = Math.max(0, i - 1);
    saveCourses();
    renderCourseTab();
    return;
  }
  refreshLine();
});
$('#cLines').addEventListener('change', e => {
  if (e.target.dataset.f !== 'pt') return;
  const c = editCourse(),
    l = c.lines[+e.target.closest('.lineCard').dataset.i];
  if (!e.target.value.trim()) {
    l.c = null;
    refreshLine();
    return;
  }
  const p = parseLatLon(e.target.value);
  if (!p) {
    alert(tx('badPoint'));
    return;
  }
  l.c = p;
  refreshLine();
});
$('#cSel').addEventListener('change', e => {
  cv.id = e.target.value;
  cv.sel = 0;
  cv.trace = null;
  cv.z = 1;
  cv.ox = cv.oy = 0;
  renderCourseTab();
});
$('#cName').addEventListener('change', e => {
  editCourse().name = e.target.value.trim() || tx('untitled');
  saveCourses();
  renderCourseTab();
});
$('#cType').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const c = editCourse();
  c.type = b.dataset.t;
  migrateCourse(c);
  saveCourses();
  renderCourseTab();
});
$('#cNew').addEventListener('click', () => {
  const c = migrateCourse({ id: 'c' + Date.now(), name: tx('newCourse'), type: 'circuit', lines: [newLine()] });
  courses.push(c);
  cv.id = c.id;
  cv.sel = 0;
  cv.trace = null;
  cv.z = 1;
  cv.ox = cv.oy = 0;
  saveCourses();
  renderCourseTab();
  $('#cName').focus();
});
$('#cAddLine').addEventListener('click', () => {
  const c = editCourse();
  if (c.type === 'segment') {
    c.lines.splice(c.lines.length - 1, 0, newLine());
    cv.sel = c.lines.length - 2;
  } else {
    c.lines.push(newLine());
    cv.sel = c.lines.length - 1;
  }
  saveCourses();
  renderCourseTab();
});
