// ---------- 保存 ----------
const APP_VERSION = '4.6.0';
const SCHEMA = 2;
// github.io では同じユーザーのページ同士が保存領域を共有するので、公開URL以外（テスト用など）は名前を分ける
const NS = location.pathname.replace(/[^/]*$/, '') || '/';
const NS_SUFFIX = NS === '/lap-logger/' ? '' : '@' + NS;
const LSP = 'll' + NS_SUFFIX + '.';
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(LSP + k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(LSP + k, JSON.stringify(v));
    } catch (e) {
      showBanner(tx('lsFail'));
    }
  }
};
// 記録の本体（GPSの点とGの値）は chunks に追記し、それ以外の情報だけを sessions に置く
function stripSess(s) {
  const o = {};
  for (const k of Object.keys(s)) if (k !== 'points' && k !== 'gs' && k[0] !== '_') o[k] = s[k];
  o.schema = SCHEMA;
  return o;
}
const exportSess = s => Object.assign(stripSess(s), { points: s.points, gs: s.gs });
const DB = {
  db: null,
  q: Promise.resolve(),
  opened: false,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('lapLogger' + NS_SUFFIX, SCHEMA);
      r.onupgradeneeded = e => {
        const db = r.result,
          trn = r.transaction;
        if (e.oldVersion < 1) db.createObjectStore('sessions', { keyPath: 'id' });
        if (e.oldVersion < 2) {
          db.createObjectStore('chunks', { keyPath: ['sid', 'seq'] });
          db.createObjectStore('backups', { keyPath: 'id' });
          if (e.oldVersion >= 1) {
            // 旧形式から移すまえに、元のデータを丸ごと控えておく
            const ss = trn.objectStore('sessions'),
              cs = trn.objectStore('chunks'),
              bs = trn.objectStore('backups');
            ss.getAll().onsuccess = ev => {
              const all = ev.target.result || [];
              if (all.length) {
                try {
                  const rq = bs.put({
                    id: 'b' + Date.now(),
                    at: Date.now(),
                    reason: 'v1→v2',
                    count: all.length,
                    data: JSON.stringify({ sessions: all, courses: LS.get('courses', []), vehicles: LS.get('vehicles', []) })
                  });
                  rq.onerror = ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                  }; // 容量不足などでも、移行の取引全体は取り消さない
                } catch (err) {}
              }
              for (const s of all) {
                cs.put({ sid: s.id, seq: 0, points: s.points || [], gs: s.gs || [] });
                ss.put(stripSess(s));
              }
            };
          }
        }
      };
      r.onsuccess = () => {
        this.db = r.result;
        this.opened = true;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          showBanner(tx('dbReload'));
        };
        res();
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => showBanner(tx('dbBlocked'));
    });
  },
  write(stores, fn) {
    if (!this.db) return Promise.resolve(this.opened ? false : null); // null：保存領域が使えない（起動時に案内済み）
    return new Promise(res => {
      let trn = null;
      try {
        trn = this.db.transaction(stores, 'readwrite');
        trn.oncomplete = () => res(true);
        trn.onerror = trn.onabort = () => res(false);
        fn(trn);
      } catch (e) {
        try {
          if (trn) trn.abort();
        } catch (e2) {}
        res(false);
      }
    });
  },
  done(p) {
    return p.then(ok => {
      if (ok === false) showBanner(tx('saveFailBanner'));
      return !!ok;
    });
  },
  // 書き込みは順番に処理する（同じ記録への追記が重ならないように）
  serial(fn) {
    const p = this.q.then(fn);
    this.q = p.catch(() => {});
    return p;
  },
  saveMeta(s) {
    return this.serial(() => this.done(this.write(['sessions'], t => t.objectStore('sessions').put(stripSess(s)))));
  },
  append(s) {
    return this.serial(() => {
      const from = s._saved || { p: 0, g: 0 },
        seq = s._seq || 0,
        pEnd = s.points.length,
        gEnd = (s.gs || []).length;
      const pts = s.points.slice(from.p, pEnd),
        gs = (s.gs || []).slice(from.g, gEnd),
        has = pts.length || gs.length;
      return this.done(
        this.write(['sessions', 'chunks'], t => {
          if (has) t.objectStore('chunks').put({ sid: s.id, seq, points: pts, gs });
          t.objectStore('sessions').put(stripSess(s));
        })
      ).then(ok => {
        if (ok && has) {
          s._seq = seq + 1;
          s._saved = { p: pEnd, g: gEnd };
        }
        return ok;
      });
    });
  },
  putFull(s) {
    return this.serial(() =>
      this.done(
        this.write(['sessions', 'chunks'], t => {
          const cs = t.objectStore('chunks');
          cs.delete(IDBKeyRange.bound([s.id, -Infinity], [s.id, Infinity]));
          cs.put({ sid: s.id, seq: 0, points: s.points, gs: s.gs || [] });
          t.objectStore('sessions').put(stripSess(s));
        })
      ).then(ok => {
        if (ok) {
          s._seq = 1;
          s._saved = { p: s.points.length, g: (s.gs || []).length };
        }
        return ok;
      })
    );
  },
  del(id) {
    return this.serial(() =>
      this.done(
        this.write(['sessions', 'chunks'], t => {
          t.objectStore('sessions').delete(id);
          t.objectStore('chunks').delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
        })
      )
    );
  },
  getAll(store) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async loadAll() {
    if (!this.db) return [];
    const [metas, chunks] = await Promise.all([this.getAll('sessions'), this.getAll('chunks')]);
    const by = new Map(
      metas.map(m => [m.id, Object.assign(m, { points: [], gs: m.vehicle && m.vehicle.type === 'car' ? [] : undefined, _seq: 0 })])
    );
    chunks.sort((a, b) => a.seq - b.seq);
    for (const c of chunks) {
      const s = by.get(c.sid);
      if (!s) continue;
      for (const q of c.points) s.points.push(q);
      if (c.gs && c.gs.length) {
        if (!s.gs) s.gs = [];
        for (const g of c.gs) s.gs.push(g);
      }
      s._seq = c.seq + 1;
    }
    for (const s of by.values()) {
      if (s.gs === undefined) delete s.gs;
      s._saved = { p: s.points.length, g: (s.gs || []).length };
    }
    return [...by.values()];
  },
  backups() {
    return this.db ? this.getAll('backups') : Promise.resolve([]);
  },
  loadOne(id) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((res, rej) => {
      const t = this.db.transaction(['sessions', 'chunks'], 'readonly');
      const rm = t.objectStore('sessions').get(id),
        rc = t.objectStore('chunks').getAll(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
      t.oncomplete = () => {
        const m = rm.result;
        if (!m) return res(null);
        const s = Object.assign(m, { points: [], _seq: 0 });
        if (m.vehicle && m.vehicle.type === 'car') s.gs = [];
        for (const c of (rc.result || []).sort((a, b) => a.seq - b.seq)) {
          for (const q of c.points) s.points.push(q);
          if (c.gs && c.gs.length) {
            if (!s.gs) s.gs = [];
            for (const g of c.gs) s.gs.push(g);
          }
          s._seq = c.seq + 1;
        }
        s._saved = { p: s.points.length, g: (s.gs || []).length };
        res(s);
      };
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
};
function showBanner(msg) {
  const b = $('#banner');
  b.textContent = msg;
  b.hidden = false;
}

const CONSENT_VER = 1;
let consentNow = false;
const consented = () => consentNow || LS.get('consent', 0) >= CONSENT_VER;
const DEFAULT_OPT = {
  minLap: 30,
  maxAcc: 20,
  mode: 'circuit',
  unit: 'kmh',
  hc: false,
  cb: false,
  liveMain: 'last',
  liveG: false,
  dragDist: [200, 400],
  courseCircuit: null,
  courseSegment: null,
  lang: (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'
};
let settings = Object.assign({}, DEFAULT_OPT, LS.get('settings', {}));
const saveSettings = () => LS.set('settings', settings);
function tx(k, ...a) {
  const d = I18N[settings.lang] || I18N.ja,
    v = k in d ? d[k] : k in I18N.ja ? I18N.ja[k] : k;
  return typeof v === 'function' ? v(...a) : v;
}

const newLine = () => ({ c: null, hdg: null, w: 30 });
function migrateCourse(c) {
  if (!c.type) c.type = 'circuit';
  if (c.type !== 'segment') c.type = 'circuit';
  c.lines = (Array.isArray(c.lines) ? c.lines : []).map(l => {
    if (l && typeof l === 'object' && ('c' in l || 'hdg' in l))
      return {
        c: ptOk(l.c) ? { lat: l.c.lat, lon: l.c.lon } : null,
        hdg: num(l.hdg) ? l.hdg : null,
        w: num(l.w) && l.w > 0 ? Math.min(200, l.w) : 30
      };
    if (l && typeof l === 'object' && ptOk(l.a) && ptOk(l.b)) {
      // 旧形式（両端の2点）
      const pr = makeProj(l.a.lat, l.a.lon),
        b = pr(l.b);
      return {
        c: pr.inv({ x: b.x / 2, y: b.y / 2 }),
        hdg: (((Math.atan2(b.x, b.y) / D2R + 90) % 360) + 360) % 360,
        w: Math.round(Math.hypot(b.x, b.y) + 30)
      };
    }
    return newLine();
  });
  if (!c.lines.length) c.lines.push(newLine());
  if (c.type === 'segment' && c.lines.length < 2) c.lines.push(newLine());
  return c;
}
let courses = LS.get('courses', null);
if (!Array.isArray(courses) || !courses.length)
  courses = [
    {
      id: 'c' + Date.now(),
      name: settings.lang === 'ja' ? '鈴鹿ツインサーキット' : 'Suzuka Twin Circuit',
      type: 'circuit',
      lines: [newLine()]
    }
  ];
courses.forEach(migrateCourse);
let vehicles = LS.get('vehicles', null);
if (!Array.isArray(vehicles) || !vehicles.length)
  vehicles = [{ id: 'v' + Date.now(), name: 'CBR600RR (PC40)', type: 'bike', cal: null, flipF: false, flipL: false }];
let vehicleId = LS.get('vehicleId', vehicles[0].id);
let sessions = [];
const saveCourses = () => LS.set('courses', courses);
const saveVehicles = () => {
  LS.set('vehicles', vehicles);
  LS.set('vehicleId', vehicleId);
};
const curVehicle = () => vehicles.find(v => v.id === vehicleId) || vehicles[0];
const vehSnap = v => ({ id: v.id, name: v.name, type: v.type, flipF: !!v.flipF, flipL: !!v.flipL });
const courseById = id => courses.find(c => c.id === id);
const coursesOf = type => courses.filter(c => (c.type === 'segment') === (type === 'segment'));
function selCourse(type) {
  const key = type === 'segment' ? 'courseSegment' : 'courseCircuit',
    list = coursesOf(type);
  let c = list.find(x => x.id === settings[key]);
  if (!c && list.length) {
    c = list[0];
    settings[key] = c.id;
  }
  return c || null;
}
const sessById = id => sessions.find(s => s.id === id);
