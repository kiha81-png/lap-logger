// ---------- 記録タブ ----------
const recState = { view: 'list', sid: null, pi: 0, veh: '' };
function vehicleMap() {
  const m = new Map(vehicles.map(v => [v.id, v.name]));
  for (const s of sessions) if (s.vehicle && !m.has(s.vehicle.id)) m.set(s.vehicle.id, s.vehicle.name);
  return m;
}
function renderRec() {
  $('#recList').hidden = recState.view !== 'list';
  $('#recSess').hidden = recState.view !== 'sess';
  $('#recLap').hidden = recState.view !== 'lap';
  if (recState.view === 'list') renderRecList();
  else if (recState.view === 'sess') renderSess();
  else renderLapView();
}
function goRec(view, push) {
  if (push) history.pushState({ rec: view }, '');
  recState.view = view;
  stopPlay();
  renderRec();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => {
  if (curTab !== 'v-rec' || recState.view === 'list') return;
  goRec(recState.view === 'lap' ? 'sess' : 'list', false);
});
$$('[data-back]').forEach(b =>
  b.addEventListener('click', () =>
    history.state && history.state.rec ? history.back() : goRec(recState.view === 'lap' ? 'sess' : 'list', false)
  )
);
function renderRecList() {
  const vmap = vehicleMap();
  if (recState.veh && !vmap.has(recState.veh)) recState.veh = '';
  $('#recVeh').innerHTML =
    `<option value="">${esc(tx('recAllVeh'))}</option>` +
    [...vmap].map(([id, n]) => `<option value="${esc(id)}"${id === recState.veh ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const list = recState.veh ? sessions.filter(s => s.vehicle && s.vehicle.id === recState.veh) : sessions;
  $('#recCards').innerHTML = list.length
    ? list
        .map(s => {
          const n = (s.laps || []).length,
            r = isFree(s) ? s.ride : null;
          const wl = s.mode !== 'drag' && !isFree(s) ? (s.laps || []).filter(l => !l.excl) : []; // ⚠つきしか無いときは、そのタイムに⚠を付けて出す
          const best = isFree(s)
            ? r
              ? fmtDist(r.dist)
              : ''
            : sessBest(s) || (wl.length ? fmtLap(Math.min(...wl.map(l => l.time))) + '⚠' : !n && !s.active && s.why0 ? tx(s.why0) : '');
          const cnt = isFree(s) ? (r ? fmtDur(r.total) : '') : s.mode === 'drag' || s.mode === 'segment' ? tx('nRuns', n) : tx('nLaps', n);
          return `<button class="rcard" data-id="${esc(s.id)}">
      <span class="rmode">${esc(tx(modeKey(s.mode)))}</span>
      <span class="rtitle">${esc(sessName(s))}</span>
      <span class="rbest">${esc(best)}</span>
      <span class="rsub">${fmtDate(s.startedAt)}・${esc(s.vehicle ? s.vehicle.name : '')}${cnt ? '・' + esc(cnt) : ''}${s.active ? esc(tx('recording')) : ''}</span>
    </button>`;
        })
        .join('')
    : `<p class="note">${esc(tx('noRecords'))}</p>`;
}
$('#recVeh').addEventListener('change', e => {
  recState.veh = e.target.value;
  renderRecList();
});
$('#recCards').addEventListener('click', e => {
  const b = e.target.closest('.rcard');
  if (!b) return;
  recState.sid = b.dataset.id;
  goRec('sess', true);
});

const fmtClock = t => {
  const d = new Date(t);
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
};
function pieceRide(s, pc) {
  return pc._rs || (pc._rs = rideStats(s.points, pc.ia, pc.ib));
}
function rideLines(r) {
  const k = spdK(),
    out = [
      tx('rideStat1', fmtDist(r.dist), fmtDur(r.total)),
      tx('rideStat2', fmtDur(r.mov), fmtDur(r.stop)),
      tx('rideStat3', Math.round(r.vavg * k), Math.round(r.vmax * k))
    ];
  if (r.gapN) out.push(tx('rideGaps', r.gapN, fmtDur(r.gapMs)));
  return out;
}
function renderSess() {
  const s = sessById(recState.sid);
  if (!s) {
    recState.view = 'list';
    return renderRec();
  }
  const A = analyze(s),
    drag = s.mode === 'drag',
    free = isFree(s),
    best = bestPiece(A),
    pts = s.points;
  const bl = free ? (A.ride ? fmtDist(A.ride.dist) : '') : sessBest(s);
  $('#sTitle').textContent = sessName(s) + (bl ? ' – ' + bl : '');
  const dur = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0;
  const hz = dur ? ((pts.length - 1) / dur).toFixed(1) : '0',
    acc = pts.length ? (pts.reduce((a, p) => a + p.acc, 0) / pts.length).toFixed(1) : '0';
  let h = `<div class="sub">${fmtDate(s.startedAt)}・${esc(s.vehicle ? s.vehicle.name : '')}</div>
    <div class="block">${esc(tx('statsGps', hz, pts.length, acc))}${s.gs ? '<br>' + esc(tx('statsG', s.gs.length)) : ''}`;
  if (free) {
    if (A.ride) h += '<br>' + rideLines(A.ride).map(esc).join('<br>');
  } else if (!drag) {
    if (!A.det) h += `<br><span class="warnText">${esc(courseProblem(s.course))}</span>`;
    const ok = A.laps.filter(l => !l.warn && !l.excl),
      n = nSecOf(s.course),
      bs = [];
    for (let k = 0; k < n; k++) {
      const v = ok.map(l => l.splits[k]).filter(x => x != null);
      bs[k] = v.length ? Math.min(...v) : null;
    }
    if (n > 1 && bs.every(x => x != null))
      h += `<br><b>${esc(tx('theo', fmtLap(bs.reduce((a, b) => a + b, 0))))}</b><br>${bs.map((v, k) => `${k + 1}) ${fmtSec(v)}`).join(', ')}`;
    if (s.vehicle && A.det) {
      const pb = bestFor(s.vehicle.id, s.course);
      if (pb.lap != null) h += `<br>${esc(tx('pbVehCourse', fmtLap(pb.lap)))}`;
    }
  } else if (s.vehicle) {
    const pb = dragBest(s.vehicle.id),
      D = dragMain(s);
    if (pb.times[D] != null) h += `<br>${esc(tx('pbVehDrag', `${distLabel(D)} ${fmtS(pb.times[D])}`))}`;
  }
  h += '</div>';
  if (!A.pieces.length) h += `<p class="note">${esc(tx('noLapsYet'))}</p>`;
  if (!drag && !free && !s.active) {
    const why = why0(A.det, (s.settings && s.settings.minLap) || DEFAULT_OPT.minLap).lines;
    if (why.length) h += `<div class="block" id="whyNone"><b>${esc(tx('whyNone'))}</b><br>${why.map(esc).join('<br>')}</div>`;
  }
  A.pieces.forEach((pc, i) => {
    let title, lines;
    if (free) {
      const r = pieceRide(s, pc);
      title = `${pieceLabel(pc)}  ${tx('rideRange', fmtClock(pc.start), fmtClock(pc.end))}`;
      lines = rideLines(r);
    } else if (drag) {
      const D = dragMain(s);
      title = `${pieceLabel(pc)}  ${pc.times[D] != null ? distLabel(D) + ' ' + fmtS(pc.times[D]) + tx('sec') : ''}`;
      lines = Object.keys(pc.times)
        .sort((a, b) => a - b)
        .map(d => tx('dragRunLine', d, fmtS(pc.times[d]), Math.round(pc.vAt[d] * spdK())))
        .concat(Object.keys(pc.spd).map(k => tx('spdTime', k, fmtS(pc.spd[k]), pc.spdUnit || 'km/h')))
        .concat([tx('maxSpd', Math.round(pc.maxV * spdK()))]);
    } else {
      const st = lapStats(s, A, pc);
      title = `${pieceLabel(pc)}  ${fmtLap(pc.time)}`;
      lines = [tx('lapStat1', st.vmin.toFixed(1), st.vmax.toFixed(1), st.vavg.toFixed(1))];
      if (st.hasG) lines.push(tx('lapStat2', st.brake.toFixed(1), st.coast.toFixed(1)));
      if (pc.splits && pc.splits.length > 1) lines.push(pc.splits.map((v, k) => `S${k + 1} ${fmtSec(v)}`).join('  '));
    }
    const exable = pc.kind === 'lap' || pc.kind === 'run';
    h += `<div class="lcard${pc === best ? ' best' : ''}${pc.excl ? ' excl' : ''}" data-pi="${i}" role="button" tabindex="0"><div class="lt">${esc(title)}${pc.warn ? '⚠' : ''}${pc === best ? ' <span class="bestc">★</span>' : ''}${pc.excl ? esc(tx('exclTag')) : ''}</div>
      <div class="ls">${lines.map(esc).join('<br>')}</div><span class="det">${esc(tx('detail'))}</span>${exable ? `<button class="ex" data-ex="${i}">${esc(tx(pc.excl ? 'unexcl' : 'excl'))}</button>` : ''}</div>`;
  });
  h += `<p class="note">${esc(tx(free ? 'rideDef' : 'statDef'))}</p>
    ${free ? '' : `<button class="wide" data-sa="recalc">${esc(tx('recalc'))}</button>`}
    ${
      drag || free
        ? ''
        : `<div class="row" style="margin-top:8px"><select id="recalcSel" aria-label="${esc(tx('recalcPick'))}">${courses
            .filter(c => !courseProblem(c))
            .map(
              c =>
                `<option value="${esc(c.id)}"${s.course && c.id === s.course.id ? ' selected' : ''}>${esc(c.name)}（${esc(tx(c.type === 'segment' ? 'modeSegment' : 'modeCircuit'))}）</option>`
            )
            .join('')}</select><button data-sa="recalcOther">${esc(tx('recalcOther'))}</button></div>`
    }
    <details class="help" id="moreOps"><summary>${esc(tx('moreOps'))}</summary>
    ${drag || free ? '' : `<button class="wide" style="margin-top:8px" data-sa="auto">${esc(tx('autoFromThis'))}</button>`}
    <div class="row eq"><button data-sa="csv">CSV</button><button data-sa="json">JSON</button><button data-sa="del" class="danger">${esc(tx('del'))}</button></div>
    </details><button class="wide" style="margin-top:8px" data-sa="gs">${esc(tx('gsSendOne'))}</button><p class="note" id="gsSessNote"></p>`;
  $('#sBody').innerHTML = h;
  renderGsSess();
}
$('#sBody').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('lcard')) {
    e.preventDefault();
    e.target.click();
  }
});
$('#sBody').addEventListener('click', async e => {
  const ex = e.target.closest('[data-ex]');
  if (ex) {
    const s = sessById(recState.sid),
      pc = s && analyze(s).pieces[+ex.dataset.ex];
    if (!pc) return;
    if (s.active) {
      alert(tx('recalcActive'));
      return;
    }
    const ts = (s.excluded || []).filter(t => Math.abs(t - pc.start) >= 3000);
    s.excluded = pc.excl ? ts : ts.concat(pc.start);
    anaCache.delete(s.id);
    analyze(s);
    DB.saveMeta(s);
    gsResend(s.id);
    renderSess();
    return;
  }
  const card = e.target.closest('.lcard');
  if (card) {
    recState.pi = +card.dataset.pi;
    lv.cmpKey = null;
    lv.t = 0;
    goRec('lap', true);
    return;
  }
  const b = e.target.closest('[data-sa]');
  if (!b) return;
  const s = sessById(recState.sid);
  if (!s) return;
  const act = b.dataset.sa;
  if (act === 'recalc') recalcSession(s, true);
  else if (act === 'recalcOther') {
    const c = courseById(($('#recalcSel') || {}).value);
    if (!c) {
      alert(tx('courseGone'));
      return;
    }
    recalcSession(s, true, c);
  } else if (act === 'auto') {
    const c = courseById(s.course.id);
    if (!c) {
      alert(tx('courseGone'));
      return;
    }
    if (autoHeadings(c, [s])) {
      if (confirm(tx('autoRecalcConfirm', 1))) recalcSession(s, false);
    }
  } else if (act === 'gs') {
    if (s.active) {
      alert(tx('recalcActive'));
      return;
    }
    if (!gsReady()) {
      alert(tx('gsNotSet'));
      return;
    }
    LS.set(
      'gsQueue',
      gsQueue()
        .filter(q => q.id !== s.id)
        .concat({ id: s.id, tries: 0, next: 0, err: '' })
    );
    renderGsSess();
    gsFlush(true);
  } else if (act === 'csv') exportCsv(s);
  else if (act === 'json') download(`lap_${fileStamp(s.startedAt)}.json`, JSON.stringify(exportSess(s)), 'application/json');
  else if (act === 'del') {
    if (s.active) {
      alert(tx('delActive'));
      return;
    }
    if (!confirm(tx('delConfirm', fmtDate(s.startedAt)))) return;
    refreshGen.set(s.id, (refreshGen.get(s.id) || 0) + 1);
    if (DB.db && !(await DB.del(s.id))) return;
    sessions = sessions.filter(x => x.id !== s.id);
    anaCache.delete(s.id);
    history.state && history.state.rec ? history.back() : goRec('list', false);
  }
});
function recalcSession(s, ask, into) {
  if (s.active) {
    alert(tx('recalcActive'));
    return false;
  }
  if (isFree(s)) return false; // フリー走行はコースで計算し直さない
  const v = s.vehicle && vehicles.find(x => x.id === s.vehicle.id);
  if (s.mode === 'drag') {
    if (ask && !confirm(tx('recalcDrag'))) return false;
    s.settings = Object.assign({}, s.settings, { dragDist: settings.dragDist.slice(), unit: settings.unit });
  } else {
    const c = into || (s.course && courseById(s.course.id));
    if (!c) {
      alert(tx('courseGone'));
      return false;
    }
    if (ask && !confirm(tx('recalcConfirm', c.name))) return false;
    s.course = clone(c);
    s.mode = c.type === 'segment' ? 'segment' : 'circuit';
    s.settings = Object.assign({}, s.settings, { minLap: settings.minLap, maxAcc: settings.maxAcc });
  }
  if (v) s.vehicle = vehSnap(v);
  s.rev = (s.rev || 0) + 1;
  analyze(s);
  DB.saveMeta(s);
  gsResend(s.id);
  if (curTab === 'v-rec') renderRec();
  return true;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 60000);
}
function exportCsv(s) {
  const A = analyze(s),
    t0 = s.points.length ? s.points[0].t : 0,
    f3 = v => (v == null ? '' : v.toFixed(3));
  const rows = ['time,elapsed_s,lat,lon,speed_kmh,accuracy_m,lap,g_lat,g_lon'];
  s.points.forEach((p, i) => {
    const l = A.laps.find(x => p.t > x.start && p.t <= x.end);
    rows.push(
      [
        new Date(p.t).toISOString(),
        ((p.t - t0) / 1000).toFixed(3),
        p.lat.toFixed(7),
        p.lon.toFixed(7),
        (p.v * 3.6).toFixed(1),
        p.acc,
        l ? l.n : 0,
        f3(A.pg.lat[i]),
        f3(A.pg.lon[i])
      ].join(',')
    );
  });
  download(`lap_${fileStamp(s.startedAt)}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
}
$('#impJson').addEventListener('click', () => $('#impFile').click());
$('#impFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await importFile(file);
});
const MAX_IMPORT = 500 * 1024 * 1024;
// 読み込んだ記録を検査して、このアプリの形にそろえる。使えないものは null
function sanitizeSession(o) {
  if (!o || typeof o.id !== 'string' || !num(o.startedAt) || !Array.isArray(o.points)) return null;
  const s = {};
  for (const k of Object.keys(o)) if (k[0] !== '_') s[k] = o[k];
  s.mode = MODES.includes(s.mode) ? s.mode : 'circuit';
  if (hasCourse(s.mode)) {
    if (!s.course || !Array.isArray(s.course.lines)) return null;
    migrateCourse(s.course);
    s.course.name = String(s.course.name || tx('untitled'));
  } else s.course = null;
  s.points = s.points
    .filter(p => p && num(p.t) && num(p.lat) && num(p.lon) && num(p.v))
    .map(p => ({ t: p.t, lat: p.lat, lon: p.lon, v: p.v, acc: num(p.acc) ? p.acc : 0 }));
  if (Array.isArray(s.gs)) s.gs = s.gs.filter(g => Array.isArray(g) && g.length === 3 && g.every(num));
  else delete s.gs;
  s.active = false;
  if (!s.vehicle || typeof s.vehicle.id !== 'string') s.vehicle = vehSnap(curVehicle());
  s.vehicle = {
    id: s.vehicle.id,
    name: String(s.vehicle.name || tx('untitled')),
    type: s.vehicle.type === 'car' ? 'car' : 'bike',
    flipF: !!s.vehicle.flipF,
    flipL: !!s.vehicle.flipL
  };
  s.settings = Object.assign({}, DEFAULT_OPT, s.settings && typeof s.settings === 'object' ? s.settings : {});
  s.settings.dragDist = (Array.isArray(s.settings.dragDist) ? s.settings.dragDist : []).filter(num);
  if (!s.settings.dragDist.length) s.settings.dragDist = [400];
  if (!num(s.settings.minLap)) s.settings.minLap = DEFAULT_OPT.minLap;
  if (!num(s.settings.maxAcc)) s.settings.maxAcc = DEFAULT_OPT.maxAcc;
  if (!Array.isArray(s.excluded)) delete s.excluded;
  else s.excluded = s.excluded.filter(num);
  if (!Array.isArray(s.laps)) s.laps = [];
  delete s.ride;
  if (s.mode === 'free' && s.points.length > 1) {
    const r = rideStats(s.points, 0, s.points.length - 1);
    s.ride = { dist: Math.round(r.dist), mov: r.mov, total: r.total };
  }
  return s;
}
async function addSessions(list) {
  let n = 0;
  for (const s of list) {
    const old = sessById(s.id);
    if (old && old.active) continue;
    analyze(s);
    if (DB.db && !(await DB.putFull(s))) continue;
    sessions = sessions.filter(x => x.id !== s.id);
    sessions.push(s);
    anaCache.delete(s.id);
    analyze(s);
    n++;
  }
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return n;
}
async function importFile(file) {
  if (rec.on) {
    alert(tx('recalcActive'));
    return;
  }
  if (file.size > MAX_IMPORT) {
    alert(tx('importTooBig'));
    return;
  }
  let o;
  try {
    o = JSON.parse(await file.text());
  } catch (err) {
    alert(tx('importParse'));
    return;
  }
  if (o && o.kind === 'backup' && o.app === 'lap-logger') return restoreBackup(o);
  if (o && o.kind === 'course' && o.app === 'lap-logger' && o.course && Array.isArray(o.course.lines)) {
    addCourse(
      migrateCourse({
        id: 'c' + Date.now(),
        name: String(o.course.name || tx('untitled')).slice(0, 80),
        type: o.course.type,
        lines: o.course.lines
      })
    );
    return;
  }
  const s = sanitizeSession(o);
  if (!s) {
    alert(tx('importBad'));
    return;
  }
  const old = sessById(s.id);
  if (old && old.active) {
    alert(tx('delActive'));
    return;
  }
  if (old && !confirm(tx('importDup'))) return;
  if (await addSessions([s])) alert(tx('importOk'));
  renderTab();
}
