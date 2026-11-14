// ---------- 全データのバックアップ ----------
function buildBackup(){
  return { app: 'lap-logger', kind: 'backup', schema: SCHEMA, version: APP_VERSION, exportedAt: Date.now(),
    settings, courses, vehicles, sessions: sessions.filter(s => !s.active).map(exportSess) };
}
async function shareOrDownload(name, text, type){
  try {
    const f = new File([text], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [f] })){ await navigator.share({ files: [f], title: name }); return true; }
  } catch (e){ if (e && e.name === 'AbortError') return false; }
  download(name, text, type);
  return true;
}
async function backupAll(){
  const d = new Date(), name = `lap-logger-backup_${fileStamp(d.getTime())}.json`;
  if (await shareOrDownload(name, JSON.stringify(buildBackup()), 'application/json')){
    LS.set('lastBackup', Date.now()); renderTab();
  }
}
async function restoreBackup(o){
  const ss = (Array.isArray(o.sessions) ? o.sessions : []).map(sanitizeSession).filter(Boolean);
  const cs = (Array.isArray(o.courses) ? o.courses : []).filter(c => c && typeof c.id === 'string').map(c => migrateCourse({ id: c.id, name: String(c.name || tx('untitled')), type: c.type, lines: c.lines }));
  const vs = (Array.isArray(o.vehicles) ? o.vehicles : []).filter(v => v && typeof v.id === 'string')
    .map(v => ({ id: v.id, name: String(v.name || tx('untitled')), type: v.type === 'car' ? 'car' : 'bike', cal: v.cal && Array.isArray(v.cal.g) && v.cal.g.length === 3 && v.cal.g.every(num) ? v.cal : null, flipF: !!v.flipF, flipL: !!v.flipL }));
  if (!confirm(tx('restoreConfirm', ss.length, cs.length, vs.length))) return;
  for (const c of cs){ courses = courses.filter(x => x.id !== c.id); courses.push(c); }
  for (const v of vs){ vehicles = vehicles.filter(x => x.id !== v.id); vehicles.push(v); }
  saveCourses(); saveVehicles();
  const n = await addSessions(ss);
  alert(tx('restoreDone', n));
  renderTab();
}
async function renderBackups(){
  const list = (await DB.backups()).sort((a, b) => b.at - a.at);
  $('#autoBackups').innerHTML = list.length ? list.map(b => `<button class="wide" data-bk="${esc(b.id)}">${esc(tx('autoBackupItem', fmtDate(b.at), b.count))}</button>`).join('') : '';
}
$('#autoBackups').addEventListener('click', async e => {
  const b = e.target.closest('[data-bk]'); if (!b) return;
  const rec0 = (await DB.backups()).find(x => x.id === b.dataset.bk); if (!rec0) return;
  const d = JSON.parse(rec0.data), snap = Array.isArray(d) ? { sessions: d } : d;
  const data = { app: 'lap-logger', kind: 'backup', schema: 1, version: 'auto', exportedAt: rec0.at, settings,
    courses: snap.courses || courses, vehicles: snap.vehicles || vehicles, sessions: snap.sessions || [] };
  shareOrDownload(`lap-logger-auto-backup_${fileStamp(rec0.at)}.json`, JSON.stringify(data), 'application/json');
});
$('#backupBtn').addEventListener('click', backupAll);
$('#restoreBtn').addEventListener('click', () => $('#impFile').click());
// しばらくバックアップしていなければ、ホームで知らせる
function backupDue(){
  const last = LS.get('lastBackup', 0), newest = sessions.reduce((m, s) => Math.max(m, s.endedAt || s.startedAt), 0);
  if (!newest || newest <= last) return 0;
  const days = Math.floor((Date.now() - (last || newest)) / 86400000);
  return (!last && sessions.length >= 3) || days >= 7 ? Math.max(days, 1) : 0;
}

