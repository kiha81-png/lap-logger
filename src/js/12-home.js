// ---------- ホーム ----------
function renderHome() {
  const fill = (sel, type) => {
    const list = coursesOf(type),
      c = selCourse(type);
    $(sel).innerHTML = list.length
      ? list.map(x => `<option value="${esc(x.id)}"${c && x.id === c.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')
      : `<option value="">${esc(tx('noCourseOpt'))}</option>`;
  };
  fill('#selCircuit', 'circuit');
  fill('#selSegment', 'segment');
  $('#dragChips').innerHTML = DRAG_DISTS.map(
    d => `<button data-d="${d}" class="${settings.dragDist.includes(d) ? 'on' : ''}">${distLabel(d)}</button>`
  ).join('');
  $('#v-run [data-i18n=dragSpeeds]').textContent = tx('dragSpeeds');
  const v = curVehicle();
  $('#selVeh').innerHTML = vehicles
    .map(x => `<option value="${esc(x.id)}"${x.id === v.id ? ' selected' : ''}>${esc(x.name)}</option>`)
    .join('');
  const idx = Math.max(0, MODES.indexOf(settings.mode));
  $$('#dots button').forEach((b, i) => b.classList.toggle('on', i === idx));
  const car = $('#carousel');
  if (car.clientWidth) car.scrollLeft = idx * (car.clientWidth + 12);
  homeNote();
  const due = backupDue();
  $('#dueBox').hidden = !due;
  if (due) $('#dueText').textContent = LS.get('lastBackup', 0) ? tx('backupDue', due) : tx('backupDueNever');
  drawOutline($('#olCircuit'), selCourse('circuit'));
  drawOutline($('#olSegment'), selCourse('segment'));
  drawDragOutline($('#olDrag'));
  drawFreeOutline($('#olFree'));
}
function homeNote() {
  const v = curVehicle(),
    m = settings.mode,
    msgs = [];
  let fix = null;
  if (m === 'drag') msgs.push(tx('drag1hz'));
  else if (m === 'free') msgs.push(tx('freeNote'));
  else {
    const c = selCourse(m);
    const p = c ? courseProblem(c) : tx('noCourse');
    if (p) msgs.push(p);
    if (c && p) fix = c;
  }
  const fb = $('#homeFix');
  fb.hidden = !fix;
  if (fix) {
    fb.textContent = tx('fixCourse', fix.name);
    fb.dataset.id = fix.id;
  }
  if (v.type === 'car' && !v.cal) msgs.push(tx('calNeeded'));
  if (battery && !battery.charging && battery.level < 0.3) msgs.push(tx('lowBattery', Math.round(battery.level * 100)));
  if (!window.isSecureContext) msgs.push(tx('needHttps'));
  $('#homeNote').textContent = msgs.join(' ');
}
function drawOutline(cv, course) {
  const g = setupCanvas(cv);
  if (!g) return;
  const { ctx, w, h } = g;
  if (!course) return canvasMsg(ctx, tx('noCourse'));
  const ss = sessions.filter(s => s.mode !== 'drag' && s.course && s.course.id === course.id && s.points.length > 2);
  let pts = null,
    proj = null;
  for (const s of ss) {
    const A = analyze(s),
      b = bestPiece(A);
    if (b) {
      pts = getTrace(s, A, b);
      proj = A.proj;
      break;
    }
  }
  if (!pts && ss.length) {
    const A = analyze(ss[0]);
    proj = A.proj;
    pts = ss[0].points.map(proj);
  }
  const lines = course.lines.filter(l => ptOk(l.c));
  if (!proj && lines.length) proj = makeProj(lines[0].c.lat, lines[0].c.lon);
  if (!proj) return canvasMsg(ctx, tx('noTraceYet'));
  const all = (pts || []).concat(lines.map(l => proj(l.c)));
  const f = fitter(
    all.length > 1
      ? all
      : all.concat([
          { x: all[0].x + 50, y: all[0].y + 50 },
          { x: all[0].x - 50, y: all[0].y - 50 }
        ]),
    w,
    h,
    18
  );
  if (pts) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    strokePath(ctx, pts, f);
  } else canvasMsg(ctx, tx('noTraceYet'));
  drawCourseLines(ctx, f, course, proj, -1);
}
// 直近のフリー走行の軌跡
function drawFreeOutline(cv) {
  const g = setupCanvas(cv);
  if (!g) return;
  const { ctx, w, h } = g,
    s = sessions.find(x => x.mode === 'free' && !x.active && x.points.length > 2);
  if (!s) return canvasMsg(ctx, tx('freeNoTrace'));
  const pr = makeProj(s.points[0].lat, s.points[0].lon);
  const pts = thin(
    s.points.map((p, i, a) => Object.assign(pr(p), { gap: i > 0 && p.t - a[i - 1].t > GAP_MS })),
    1500
  ); // 途切れは間引く前に印を付ける
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  strokePath(ctx, pts, fitter(pts, w, h, 18));
}
function drawDragOutline(cv) {
  const g = setupCanvas(cv);
  if (!g) return;
  const { ctx, w, h } = g,
    x0 = w * 0.25,
    y0 = h * 0.82,
    x1 = w * 0.75,
    y1 = h * 0.18;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  const ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2,
    k = 16;
  for (const [x, y] of [
    [x0, y0],
    [x1, y1]
  ]) {
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang) * k, y - Math.sin(ang) * k);
    ctx.lineTo(x + Math.cos(ang) * k, y + Math.sin(ang) * k);
    ctx.stroke();
  }
}
(() => {
  const car = $('#carousel');
  let tm = null;
  car.addEventListener('scroll', () => {
    clearTimeout(tm);
    tm = setTimeout(() => {
      const i = Math.round(car.scrollLeft / (car.clientWidth + 12)),
        m = MODES[Math.max(0, Math.min(MODES.length - 1, i))];
      if (m !== settings.mode) {
        settings.mode = m;
        saveSettings();
        $$('#dots button').forEach((b, j) => b.classList.toggle('on', j === i));
        homeNote();
      }
    }, 120);
  });
  $('#dots').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) car.scrollTo({ left: +b.dataset.i * (car.clientWidth + 12), behavior: 'smooth' });
  });
})();
$('#selCircuit').addEventListener('change', e => {
  settings.courseCircuit = e.target.value;
  saveSettings();
  renderHome();
});
$('#selSegment').addEventListener('change', e => {
  settings.courseSegment = e.target.value;
  saveSettings();
  renderHome();
});
$('#selVeh').addEventListener('change', e => {
  vehicleId = e.target.value;
  saveVehicles();
  homeNote();
});
// 計測画面の「コースを直す」：そのコースを開いた状態でコース画面へ
$('#homeFix').addEventListener('click', e => {
  cv.id = e.currentTarget.dataset.id;
  cv.sel = 0;
  cv.trace = null;
  cv.z = 1;
  cv.ox = cv.oy = 0;
  showTab('v-course');
  window.scrollTo(0, 0);
});
$('#dragChips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = +b.dataset.d,
    on = settings.dragDist.includes(d);
  if (on && settings.dragDist.length === 1) return;
  settings.dragDist = on ? settings.dragDist.filter(x => x !== d) : settings.dragDist.concat(d).sort((a, b) => a - b);
  saveSettings();
  renderHome();
});
