// ---------- 起動 ----------
(async () => {
  applyLang();
  try {
    await DB.open();
    sessions = await DB.loadAll();
  } catch (e){ showBanner(tx('dbFail')); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const held = await heldRecLocks();
  let otherRec = false;
  for (const s of sessions){
    let dirty = false;
    if (s.active){ if (!held || held.has(LOCKP + s.id)) otherRec = !!held || otherRec; else { s.active = false; dirty = true; } }                      // 前回、記録中に閉じられたもの
    if (!s.vehicle){ s.vehicle = vehSnap(vehicles[0]); dirty = true; }    // 車両の登録より前の記録
    if (!s.mode){ s.mode = 'circuit'; dirty = true; }
    if (s.course && s.course.lines && (!s.course.type || s.course.lines.some(l => l && typeof l === 'object' && 'a' in l))){ migrateCourse(s.course); dirty = true; }
    if (dirty) DB.saveMeta(s);
  }
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  saveCourses();
  ready = true;
  $('#startBtn').disabled = false;
  applyLang();
  renderHome();
  if (consented()) startGeo();
  setupSW();
  applyLook();
  if (otherRec) showBanner(tx('otherTab'));
  if (!consented()) $('#consent').hidden = false;
  try { checkHashImport(); } catch (err){}
  checkBattery();
  gsFlush();
})();
$('#consentOk').addEventListener('click', () => { consentNow = true; LS.set('consent', CONSENT_VER); $('#consent').hidden = true; startGeo(); });
// 電池が少ないときは、ホームで知らせる（Android の Chrome など、対応しているブラウザだけ）
let battery = null;
function checkBattery(){
  if (!navigator.getBattery) return;
  navigator.getBattery().then(b => {
    battery = b;
    ['levelchange', 'chargingchange'].forEach(t => b.addEventListener(t, () => { if (curTab === 'v-run' && !rec.on) homeNote(); }));
    if (curTab === 'v-run' && !rec.on) homeNote();
  }).catch(() => {});
}

