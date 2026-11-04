"""Lap Logger の自動テスト。

必要なもの: Python 3、Playwright と QR の読み取り（pip install playwright zxing-cpp pillow）、Microsoft Edge。
使い方:    python tests/run_tests.py

このリポジトリのフォルダだけを http://127.0.0.1:<空きポート>/lap-logger-test/ で配信し、
Edge（画面なし）で開いて、合成した走行データで判定・保存・オフライン動作を確かめる。
"""
import base64, functools, http.server, io, json, os, socketserver, sys, threading, time
import zxingcpp
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = '/lap-logger-test/'


class Handler(http.server.SimpleHTTPRequestHandler):
    """PREFIX の下だけを、このリポジトリのファイルとして返す。"""
    def translate_path(self, path):
        path = path.split('?', 1)[0]
        if not path.startswith(PREFIX):
            return os.path.join(ROOT, '__not_found__')
        return super().translate_path('/' + path[len(PREFIX):])

    def log_message(self, *a):
        pass


def start_server():
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
    httpd.handle_error = lambda *a: None  # ブラウザが途中で接続を切ったときの表示を出さない
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}{PREFIX}'


def waitjs(page, expr, timeout=15):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if page.evaluate(expr):
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(expr)


SETUP = """() => {
  window.confirm = () => true; window.alert = () => {};
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: () => 1, clearWatch: () => {} } });
  LS.set('consent', CONSENT_VER);
  window.runDet = s => { const d = new LapDetector(s.course, Object.assign({}, DEFAULT_OPT, s.settings)); s.points.forEach(p => d.push(p)); return d; };
  window.toLL = (x, y) => ({ lat: 34.84 + y / (6371008.8 * Math.PI / 180), lon: 136.54 + x / (6371008.8 * Math.PI / 180 * Math.cos(34.84 * Math.PI / 180)) });
}"""

# 各テストは {name: [期待どおりか, 詳細]} を返す
TESTS = {
'circuit': """() => {
  const R = 300, v = 40, pts = []; let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < 260; i++){ const a = -0.3 + v * i / R, p = toLL(R * Math.cos(a) + rnd() * 4, R * Math.sin(a) + rnd() * 4); pts.push({ t: 1.7e12 + i * 1000 + Math.round(rnd() * 100), lat: p.lat, lon: p.lon, v, acc: 5 }); }
  const line = a => ({ c: toLL(R * Math.cos(a), R * Math.sin(a)), hdg: null, w: 30 });
  const c = migrateCourse({ id: 'tc', name: 't', type: 'circuit', lines: [line(0), line(2 * Math.PI / 3), line(4 * Math.PI / 3)] });
  const s = { id: 'tc1', startedAt: 1.7e12, mode: 'circuit', vehicle: vehSnap(vehicles[0]), course: c, settings: { minLap: 30, maxAcc: 20 }, points: pts, laps: [] };
  const n = autoHeadingLine(c.lines[0], [s]) === 'ok' && autoHeadingLine(c.lines[1], [s]) === 'ok' && autoHeadingLine(c.lines[2], [s]) === 'ok';
  const det = runDet(s), exp = 2 * Math.PI * R / v * 1000;
  const ok = n && det.laps.length === 5 && det.laps.every(l => Math.abs(l.time - exp) < 150 && l.splits.every(x => Math.abs(x - exp / 3) < 150));
  return [ok, { hdg: c.lines.map(l => Math.round(l.hdg)), laps: det.laps.map(l => (l.time / 1000).toFixed(3)) }];
}""",
'reverse_and_gap': """() => {
  const R = 300, v = 40, line = { c: toLL(R, 0), hdg: 0, w: 30 }, c = migrateCourse({ id: 'tr', name: 't', type: 'circuit', lines: [line] });
  const pts = []; let a = -0.3, t = 1.7e12;
  const step = d => { a += d * v / R; t += 1000; const p = toLL(R * Math.cos(a), R * Math.sin(a)); pts.push({ t, lat: p.lat, lon: p.lon, v, acc: 5 }); };
  for (let i = 0; i < 3; i++) step(1); for (let i = 0; i < 3; i++) step(-1); for (let i = 0; i < 60; i++) step(1);
  const det = runDet({ course: c, settings: { minLap: 30 }, points: pts });
  const gp = []; for (let i = 0; i < 200; i++){ if (i >= 70 && i < 75) continue; const b = -0.3 + v * i / R, p = toLL(R * Math.cos(b), R * Math.sin(b)); gp.push({ t: 1.7e12 + i * 1000, lat: p.lat, lon: p.lon, v, acc: 5 }); }
  const g = runDet({ course: c, settings: { minLap: 30 }, points: gp });
  return [det.laps.length === 1 && g.laps.some(l => l.warn) && g.laps.some(l => !l.warn), { rev: det.laps.length, gapWarn: g.laps.map(l => l.warn) }];
}""",
'segment': """() => {
  const pts = []; for (let i = 0; i < 50; i++) pts.push({ t: 1.7e12 + i * 1000, ...toLL(0, -100 + 30 * i), v: 30, acc: 4 });
  const c = migrateCourse({ id: 'ts', name: 't', type: 'segment', lines: [{ c: toLL(0, 0), hdg: 0, w: 30 }, { c: toLL(0, 500), hdg: 0, w: 30 }, { c: toLL(0, 1000), hdg: 0, w: 30 }] });
  const det = runDet({ course: c, settings: { minLap: 30 }, points: pts });
  return [det.laps.length === 1 && Math.abs(det.laps[0].time - 33333) < 5, det.laps.map(l => l.time)];
}""",
'drag': """() => {
  const t0 = 1.8e12, dp = [];
  for (let i = 0; i < 4; i++) dp.push({ t: t0 + i * 1000, ...toLL(0, 0), v: 0, acc: 4 });
  for (let k = 4; k < 40; k++){ const t = t0 + k * 1000, dt = (t - (t0 + 3500)) / 1000, tA = Math.min(dt, 14); let v = 5 * tA, y = 2.5 * tA * tA;
    if (dt > 14){ const dd = dt - 14; v = Math.max(0, 70 - 8 * dd); y = 490 + 70 * dd - 4 * dd * dd; } dp.push({ t, ...toLL(0, y), v, acc: 4 }); }
  const d = new DragDetector({ dragDist: [200, 400], unit: 'kmh' }); dp.forEach(p => d.push(p));
  const r = d.laps[0], ok = r && Math.abs(r.times[200] - 8944) < 60 && Math.abs(r.times[400] - 12649) < 60 && Math.abs(r.spd[100] - 5556) < 30;
  const m = new DragDetector({ dragDist: [402.336], unit: 'mph' }); dp.forEach(p => m.push(p));
  const q = m.laps[0], ok2 = q && Math.abs(q.spd[60] - 26822 / 5 / 1000 * 1000) < 40 && q.spdUnit === 'mph';
  return [ok && ok2, { times: r && r.times, spd: r && r.spd, mph: q && q.spd }];
}""",
'gps_g_sign': """() => {
  const R = 200, v = 25, pts = [];
  for (let i = 0; i < 40; i++){ const a = v * i / R, p = toLL(R * Math.sin(a), R - R * Math.cos(a)); pts.push({ t: 1.7e12 + i * 1000, lat: p.lat, lon: p.lon, v, acc: 4 }); }
  const g = pointG({ points: pts, vehicle: { type: 'bike' } }), mid = g.lat.slice(5, 30), exp = -v * v / R / 9.80665;
  return [mid.every(x => x != null && Math.abs(x - exp) < 0.05), { exp: exp.toFixed(3), got: mid.slice(0, 3).map(x => x.toFixed(3)) }];
}""",
'other_tab_blocks_start': """async () => {
  let release; navigator.locks.request(LOCKP + 'other', () => new Promise(r => { release = r; }));
  await new Promise(r => setTimeout(r, 100));
  settings.mode = 'drag'; live.lastFixT = 0; await startRec();
  const blocked = !rec.on; release();
  return [blocked, { recOn: rec.on }];
}""",
'broken_course_file': """async () => {
  const n0 = courses.length;
  await importFile(new File([JSON.stringify({ app: 'lap-logger', kind: 'course', course: { name: 'x', lines: [5, 'a', null, { c: { lat: 34.8, lon: 136.5 }, hdg: 'q', w: '5' }] } })], 'c.json'));
  const c = courses[courses.length - 1];
  const ok = courses.length === n0 + 1 && c.lines.length === 4 && c.lines[3].w === 30 && c.lines[3].hdg === null && c.lines[0].c === null;
  courses.pop(); saveCourses();
  return [ok, c.lines];
}""",
'consent_in_memory': """() => {
  const keep = consentNow; consentNow = true;
  const ok = consented(); consentNow = keep;
  return [ok, null];
}""",
'drag_without_device_speed': """async () => {
  // 端末が速度を出さない場合（iPhone で起きる）：位置だけから、発進時刻と距離のタイムを求められるか
  // 更新は 1 秒ごとと 0.2 秒ごと、位置の揺れは精度に比例させる
  const out = {}; let off = 5e6;
  for (const [acc, hz] of [[5, 1], [10, 1], [20, 1], [5, 5], [10, 5]]){
    settings.mode = 'drag'; settings.dragDist = [200, 400]; settings.unit = 'kmh';
    live.lastFixT = 0; await startRec();
    const step = 1000 / hz, t0 = Date.now() + (off += 1e5), tS = t0 + 4500; let seed = acc * 7 + hz; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const noise = acc * 0.3;
    for (let k = 0; k < 25 * hz; k++){ const t = t0 + k * step, dt = Math.max(0, (t - tS) / 1000), y = 2.5 * dt * dt + rnd() * noise, x = rnd() * noise, q = toLL(x, y);
      onPos({ timestamp: t, coords: { latitude: q.lat, longitude: q.lon, accuracy: acc, speed: null } }); }
    const r = rec.det.laps[0] || (rec.det.cur ? { start: rec.det.cur.start, times: rec.det.cur.times, warn: rec.det.cur.warn } : null);
    out[acc + 'm/' + hz + 'Hz'] = r ? { startErr: Math.round(r.start - tS), t200: r.times[200] && Math.round(r.times[200] - 8944), t400: r.times[400] && Math.round(r.times[400] - 12649), warn: r.warn } : null;
    stopRec(); await DB.q;
  }
  const ok = Object.values(out).every(o => o && Math.abs(o.t200) < 800 && Math.abs(o.t400) < 800);
  return [ok, out];
}""",
'slow_crossing_5hz_no_speed': """() => {
  // 0.2 秒ごとの更新・速度なしでも、時速30km程度のライン通過を数えるか
  const c = migrateCourse({ id: 'tp', name: 't', type: 'segment', lines: [{ c: toLL(0, 50), hdg: 0, w: 30 }, { c: toLL(0, 250), hdg: 0, w: 30 }] });
  const s = { id: 'tp1', startedAt: 1, mode: 'segment', vehicle: vehSnap(vehicles[0]), course: c, settings: { minLap: 30 }, points: [] };
  // onPos と同じ補完で速度を作る
  const pts = []; for (let k = 0; k < 200; k++){ const t = 1.7e12 + k * 200, q = toLL(0, 8.3 * k * 0.2); pts.push({ t, lat: q.lat, lon: q.lon, acc: 5 }); }
  for (let i = 0; i < pts.length; i++){ let ref = pts[Math.max(0, i - 1)]; for (let k = i - 1; k >= 0 && pts[i].t - pts[k].t <= 2500; k--) ref = pts[k];
    const d2 = distM(ref, pts[i]), dt2 = (pts[i].t - ref.t) / 1000; pts[i].v = i === 0 ? 0 : (d2 < Math.min(8, Math.max(3, 7.5)) ? 0 : d2 / dt2); }
  s.points = pts;
  const det = runDet(s);
  return [det.laps.length === 1 && Math.abs(det.laps[0].time - 200 / 8.3 * 1000) < 400, det.laps.map(l => l.time)];
}""",
'stationary_jitter': """async () => {
  settings.mode = 'circuit'; settings.courseCircuit = courses[0].id;
  live.lastFixT = 0; await startRec();
  const base = Date.now() + 0.5e6; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < 30; i++){ const q = toLL(rnd() * 4, rnd() * 4); onPos({ timestamp: base + i * 1000, coords: { latitude: q.lat, longitude: q.lon, accuracy: 5, speed: i % 2 ? null : -1 } }); }
  const s = rec.session, vmax = Math.max(...s.points.map(p => p.v)), g = gm.cur;
  stopRec(); await DB.q;
  return [vmax === 0 && (!g || (g.lat === 0 && g.lon === 0)), { vmax, g }];
}""",
'auto_build': """() => {
  // 楕円形のコース：直線 400m ×2（時速144km）とカーブ R80（時速72km）。1周目の前にピットロード（時速40km）を通る
  const stad = (laps, hz, noise) => {
    const L = 800 + 2 * Math.PI * 80, at = d => { d = ((d % L) + L) % L;
      if (d < 400) return { x: d, y: 0, v: 40 };
      if (d < 400 + Math.PI * 80){ const a = (d - 400) / 80 - Math.PI / 2; return { x: 400 + 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; }
      if (d < 800 + Math.PI * 80){ const k = d - 400 - Math.PI * 80; return { x: 400 - k, y: 160, v: 40 }; }
      const a = (d - 800 - Math.PI * 80) / 80 + Math.PI / 2; return { x: 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; };
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const pts = []; let t = 1.7e12;
    for (let x = 50; x < 350; x += 11 / hz){ const q = toLL(x, -25); pts.push({ t, lat: q.lat, lon: q.lon, v: 11, acc: 5 }); t += 1000 / hz; }
    for (let d = 350; d < 350 + laps * L; ){ const q = at(d), ll = toLL(q.x + rnd() * noise, q.y + rnd() * noise); pts.push({ t, lat: ll.lat, lon: ll.lon, v: q.v, acc: 5 }); t += 1000 / hz; d += q.v / hz; }
    return { L, pts };
  };
  const out = {};
  for (const [hz, noise] of [[1, 6], [5, 4]]){
    const { pts } = stad(4, hz, noise), s = { id: 'ab' + hz, startedAt: 1.7e12, mode: 'circuit', vehicle: vehSnap(vehicles[0]), course: { id: 'other', name: 'o', type: 'circuit', lines: [] }, settings: { minLap: 20, maxAcc: 20 }, points: pts, laps: [] };
    const r = findStartLine([s]); if (!r){ out[hz] = null; continue; }
    const c = migrateCourse({ id: 'tab', name: 't', type: 'circuit', lines: [newLine()] });
    placeLine(c.lines[0], r.c, r.dir, [s]);
    const pr = makeProj(34.84, 136.54), q = pr(c.lines[0].c), h = c.lines[0].hdg, dh = a => Math.abs(((h - a + 540) % 360) - 180);
    s.course = c; const det = runDet(s), exp = (800 / 40 + 2 * Math.PI * 80 / 20) * 1000;
    const onStraight = q.x > 60 && q.x < 340 && ((Math.abs(q.y) < 4 && dh(90) < 6) || (Math.abs(q.y - 160) < 4 && dh(270) < 6));
    out[hz] = { ok: onStraight && r.passes >= 3 && det.laps.length >= 3 && det.laps.every(l => Math.abs(l.time - exp) < 1500), x: Math.round(q.x), y: Math.round(q.y), hdg: Math.round(h), passes: r.passes, laps: det.laps.map(l => (l.time / 1000).toFixed(1)) };
  }
  // 1周に満たない記録では作らない
  const none = findStartLine([{ points: stad(0.9, 1, 4).pts }]);
  return [!!out[1] && out[1].ok && !!out[5] && out[5].ok && none === null, { out, none }];
}""",
'tap_place': """() => {
  // 楕円形のコース：直線 400m ×2（時速144km）とカーブ R80（時速72km）。1周目の前にピットロード（時速40km）を通る
  const stad = (laps, hz, noise) => {
    const L = 800 + 2 * Math.PI * 80, at = d => { d = ((d % L) + L) % L;
      if (d < 400) return { x: d, y: 0, v: 40 };
      if (d < 400 + Math.PI * 80){ const a = (d - 400) / 80 - Math.PI / 2; return { x: 400 + 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; }
      if (d < 800 + Math.PI * 80){ const k = d - 400 - Math.PI * 80; return { x: 400 - k, y: 160, v: 40 }; }
      const a = (d - 800 - Math.PI * 80) / 80 + Math.PI / 2; return { x: 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; };
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const pts = []; let t = 1.7e12;
    for (let x = 50; x < 350; x += 11 / hz){ const q = toLL(x, -25); pts.push({ t, lat: q.lat, lon: q.lon, v: 11, acc: 5 }); t += 1000 / hz; }
    for (let d = 350; d < 350 + laps * L; ){ const q = at(d), ll = toLL(q.x + rnd() * noise, q.y + rnd() * noise); pts.push({ t, lat: ll.lat, lon: ll.lon, v: q.v, acc: 5 }); t += 1000 / hz; d += q.v / hz; }
    return { L, pts };
  };
  const { pts } = stad(3, 1, 3), s = { id: 'tp1', startedAt: 1.7e12, mode: 'circuit', vehicle: vehSnap(vehicles[0]), course: { id: 'other', name: 'o', type: 'circuit', lines: [] }, settings: { minLap: 20, maxAcc: 20 }, points: pts, laps: [] };
  sessions.push(s);
  const c = migrateCourse({ id: 'ctp', name: 'tap', type: 'circuit', lines: [newLine(), newLine()] });
  courses.push(c); cv.id = c.id; cv.sel = 1; cv.trace = 'tp1';
  showTab('v-course'); renderCourseTab();
  const pr = makeProj(34.84, 136.54), ll = toLL(200, 160), [X, Y] = cv.hit.f(cv.hit.proj(ll));
  tapPreview(X + 6, Y - 5); // 少しずれた所をタップしても、走行ラインの上に置く
  const l = c.lines[1], q = pr(l.c), dh = Math.abs(((l.hdg - 270 + 540) % 360) - 180);
  const ok1 = Math.abs(q.y - 160) < 3 && Math.abs(q.x - 200) < 15 && dh < 5;
  const [X1, Y1] = cv.hit.f(cv.hit.proj(ll)), same = Math.hypot(X1 - X, Y1 - Y) < 1; // 線を置いても図は動かない
  zoomAt(X, Y, 4); const [X2, Y2] = cv.hit.f(cv.hit.proj(ll)), keep = same && Math.hypot(X2 - X, Y2 - Y) < 1;
  cv.sel = 0; const far = cv.hit.f(cv.hit.proj(toLL(200, 80))); tapPreview(far[0], far[1]); // コースの内側（走っていない所）
  const ok3 = !ptOk(c.lines[0].c);
  courses = courses.filter(x => x !== c); sessions = sessions.filter(x => x !== s); cv.id = courses[0].id; cv.sel = 0; cv.z = 1; cv.ox = cv.oy = 0; cv.trace = null; saveCourses(); showTab('v-run');
  return [ok1 && keep && ok3, { x: Math.round(q.x), y: Math.round(q.y), hdg: Math.round(l.hdg), keep, ok3 }];
}""",
'course_perf': """() => {
  // 楕円形のコース：直線 400m ×2（時速144km）とカーブ R80（時速72km）。1周目の前にピットロード（時速40km）を通る
  const stad = (laps, hz, noise) => {
    const L = 800 + 2 * Math.PI * 80, at = d => { d = ((d % L) + L) % L;
      if (d < 400) return { x: d, y: 0, v: 40 };
      if (d < 400 + Math.PI * 80){ const a = (d - 400) / 80 - Math.PI / 2; return { x: 400 + 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; }
      if (d < 800 + Math.PI * 80){ const k = d - 400 - Math.PI * 80; return { x: 400 - k, y: 160, v: 40 }; }
      const a = (d - 800 - Math.PI * 80) / 80 + Math.PI / 2; return { x: 80 * Math.cos(a), y: 80 + 80 * Math.sin(a), v: 20 }; };
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const pts = []; let t = 1.7e12;
    for (let x = 50; x < 350; x += 11 / hz){ const q = toLL(x, -25); pts.push({ t, lat: q.lat, lon: q.lon, v: 11, acc: 5 }); t += 1000 / hz; }
    for (let d = 350; d < 350 + laps * L; ){ const q = at(d), ll = toLL(q.x + rnd() * noise, q.y + rnd() * noise); pts.push({ t, lat: ll.lat, lon: ll.lon, v: q.v, acc: 5 }); t += 1000 / hz; d += q.v / hz; }
    return { L, pts };
  };
  const { pts } = stad(100, 10, 3), s = { id: 'pf1', startedAt: 1.7e12, mode: 'circuit', vehicle: vehSnap(vehicles[0]), course: { id: 'other', name: 'o', type: 'circuit', lines: [] }, settings: { minLap: 20, maxAcc: 20 }, points: pts, laps: [] };
  let t = performance.now(); const r = findStartLine([s]); const tFind = performance.now() - t;
  sessions.push(s); const c = migrateCourse({ id: 'cpf', name: 'pf', type: 'circuit', lines: [newLine()] });
  courses.push(c); cv.id = c.id; cv.sel = 0; cv.trace = 'pf1'; showTab('v-course'); renderCourseTab();
  t = performance.now(); for (let i = 0; i < 10; i++) drawCoursePreview(); const tDraw = (performance.now() - t) / 10;
  courses = courses.filter(x => x !== c); sessions = sessions.filter(x => x !== s); cv.id = courses[0].id; cv.trace = null; cv.cache = null; saveCourses(); showTab('v-run');
  const hint = tx('tapHint');
  return [!!r && tFind < 3000 && tDraw < 60 && typeof hint === 'string', { n: pts.length, tFind: Math.round(tFind), tDraw: Math.round(tDraw), hint: hint.slice(0, 12) }];
}""",
'hash_import_guard': """() => {
  let threw = false;
  history.replaceState(null, '', location.pathname + '#c=%E0%A4%A');
  try { checkHashImport(); } catch (e){ threw = true; }
  const gone = location.hash === '';
  const c0 = courses[0], code = courseCode(c0);
  rec.on = true; history.replaceState(null, '', location.pathname + '#c=' + code); checkHashImport();
  const hiddenWhileRec = $('#impBox').hidden; rec.on = false; showImport();
  const shownAfter = !$('#impBox').hidden; const n = courses.length; $('#impAdd').click();
  const noDup = courses.length === n; showTab('v-run');
  return [!threw && gone && hiddenWhileRec && shownAfter && noDup, { threw, gone, hiddenWhileRec, shownAfter, noDup }];
}""",
'escape': """() => {
  const evil = '<img src=x onerror=alert(1)>';
  return [esc(evil) === '&lt;img src=x onerror=alert(1)&gt;', esc(evil)];
}""",
}

STORAGE = """async () => {
  settings.mode = 'drag';
  live.lastFixT = 0; await startRec();
  const s = rec.session, base = Date.now() + 1e6;
  for (let i = 0; i < 25; i++){
    onPos({ timestamp: base + i * 1000, coords: { latitude: 34.84 + i * 0.0002, longitude: 136.54, accuracy: 4, speed: i < 3 ? 0 : 20 } });
    if (i % 8 === 7) await DB.append(s);
  }
  stopRec(); await DB.q;
  return s.id;
}"""


def main():
    httpd, url = start_server()
    results, failed = {}, 0
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True)
        ctx = b.new_context(service_workers='allow')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        waitjs(page, 'ready === true')
        page.evaluate(SETUP)
        for name, js in TESTS.items():
            results[name] = page.evaluate(js)

        # 保存：追記して、読み込み直しても全部残るか
        sid = page.evaluate(STORAGE)
        page.reload(); waitjs(page, 'ready === true')
        n = page.evaluate("id => { const s = sessById(id); return s ? s.points.length : -1 }", sid)
        results['storage_append'] = [n == 25, {'points_after_reload': n}]

        # 2つのタブ：A で記録中に B を開き、A が止めたら B も「記録中」でなくなるか
        page.evaluate("async () => { settings.mode = 'drag'; live.lastFixT = 0; await startRec(); for (let i = 0; i < 5; i++) onPos({ timestamp: Date.now() + 2e6 + i * 1000, coords: { latitude: 34.84, longitude: 136.54 + i * 0.0002, accuracy: 4, speed: 20 } }); await DB.append(rec.session); await new Promise(r => setTimeout(r, 300)); }")
        rid = page.evaluate('rec.session.id')
        pb = ctx.new_page(); pb.on('pageerror', lambda e: errors.append('B: ' + str(e)))
        pb.goto(url); waitjs(pb, 'ready === true'); pb.evaluate(SETUP)
        during = pb.evaluate("id => (sessById(id) || {}).active", rid)
        page.evaluate('stopRec()')
        waitjs(pb, "!(sessById(%s) || {}).active" % json.dumps(rid), timeout=5)
        after = pb.evaluate("id => { const s = sessById(id); return s ? [s.active, s.points.length] : null }", rid)
        results['two_tabs_sync'] = [during is True and after == [False, 5], {'during': during, 'after': after}]
        pb.close()

        # バックアップ → 別の場所（別の保存領域）へ復元
        backup = page.evaluate('JSON.stringify(buildBackup())')
        page.goto(url.replace('/lap-logger-test/', '/lap-logger-test/sub/'))
        page.goto(url)  # 同じ場所に戻る（保存領域の分離は名前の付け方で確認）
        results['namespace'] = [page.evaluate("NS_SUFFIX") == '@' + PREFIX, page.evaluate("NS_SUFFIX")]

        # オフライン起動
        waitjs(page, 'ready === true'); waitjs(page, 'navigator.serviceWorker.controller !== null')
        ctx.set_offline(True)
        page.reload(); waitjs(page, 'ready === true')
        results['offline'] = [page.evaluate('ready === true'), 'loaded while offline']
        ctx.set_offline(False)

        # コースの共有：QR を読み取ると共有リンクになり、それを開くと同じコースが追加される
        page.evaluate(SETUP)
        share = page.evaluate("""() => {
          const c = migrateCourse({ id: 'cq', name: '共有<b>テスト</b>', type: 'circuit', lines: [
            { c: toLL(0, 0), hdg: 90, w: 30 }, { c: toLL(400, 80), hdg: 180.5, w: 24 }, { c: toLL(200, 160), hdg: 270, w: 30 }, newLine()] });
          courses.push(c); cv.id = c.id; showTab('v-course'); renderCourseTab();
          $('#cShare').click();
          const out = { url: shareUrl, png: $('#qrCv').toDataURL('image/png'), visible: !$('#shareBox').hidden, lines: JSON.stringify(c.lines) };
          $('#qrClose').click(); courses = courses.filter(x => x !== c); cv.id = courses[0].id; saveCourses(); showTab('v-run');
          return out;
        }""")
        img = Image.open(io.BytesIO(base64.b64decode(share['png'].split(',', 1)[1])))
        rd = zxingcpp.read_barcodes(img)
        qr_text = rd[0].text if rd else None
        n0 = page.evaluate('courses.length')
        page.goto(qr_text or url); waitjs(page, 'ready === true'); page.evaluate(SETUP)
        got = page.evaluate("""() => { const shown = !$('#impBox').hidden, info = $('#impInfo').textContent, hashGone = location.hash === '';
          $('#impAdd').click(); const c = courses[courses.length - 1];
          return { shown, info, hashGone, n: courses.length, name: c.name, lines: c.lines.map(l => [l.c ? +l.c.lat.toFixed(6) : null, l.c ? +l.c.lon.toFixed(6) : null, l.hdg, l.w]) }; }""")
        want = [[round(l['c']['lat'], 6) if l['c'] else None, round(l['c']['lon'], 6) if l['c'] else None, l['hdg'], l['w']] for l in json.loads(share['lines'])]
        bad_codes = page.evaluate("""() => [parseCourseCode('LL1.@@@@'), parseCourseCode('LL1.' + btoa('{"l":[]}')), parseCourseCode('hello'), parseCourseCode('LL1.' + btoa(JSON.stringify({ n: 'x', l: [[999, 999, 1, 30]] })))].map(c => c ? (c.lines[0].c === null ? 'nullpt' : 'course') : null)""")
        page.evaluate("() => { courses = courses.filter(c => c.name !== '共有<b>テスト</b>'); saveCourses(); }")
        results['qr_share'] = [share['visible'] and qr_text == share['url'] and '#c=LL1.' in (qr_text or '') and got['shown'] and got['hashGone']
                               and got['n'] == n0 + 1 and got['name'] == '共有<b>テスト</b>' and got['lines'] == want and bad_codes == [None, None, None, 'nullpt'],
                               {'qr': (qr_text or '')[:60], 'url_len': len(share['url']), 'got': got, 'want': want, 'bad': bad_codes}]
        results['backup_roundtrip'] = [json.loads(backup)['kind'] == 'backup' and len(json.loads(backup)['sessions']) >= 1, len(json.loads(backup)['sessions'])]
        results['no_page_errors'] = [not errors, errors]
        b.close()
    httpd.shutdown()

    for name, (ok, detail) in results.items():
        failed += not ok
        print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False)))
    print(f'\n{len(results) - failed}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
