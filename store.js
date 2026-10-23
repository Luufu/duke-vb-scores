/* Data layer. Same interface for live (Firebase) and demo (this browser only). */
(function (root) {
  'use strict';
  const CFG = root.VB_CONFIG || {};
  const strip = (o) => JSON.parse(JSON.stringify(o)); // Firestore rejects `undefined`

  async function createStore() {
    if (CFG.firebase && CFG.firebase.apiKey) return firebaseStore();
    return demoStore();
  }

  // ---------------- Firebase ----------------
  async function firebaseStore() {
    const V = '10.12.2';
    const base = `https://www.gstatic.com/firebasejs/${V}/`;
    const [appMod, fs, au] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-auth.js'),
    ]);
    const app = appMod.initializeApp(CFG.firebase);
    const db = fs.getFirestore(app);
    const auth = au.getAuth(app);
    const tRef = (id) => fs.doc(db, 'tournaments', id);
    const siteRef = fs.doc(db, 'meta', 'site');

    // Spectators poll (cheap); logged-in scorekeepers get instant updates.
    function watch(ref, cb, live) {
      const secs = +CFG.viewerRefreshSeconds || 0;
      if (live || !secs) {
        return fs.onSnapshot(ref, (s) => cb(s.exists() ? s.data() : null), (e) => console.error(e));
      }
      let stopped = false, timer = null;
      const tick = async () => {
        if (stopped) return;
        if (document.visibilityState === 'visible') {
          try { const s = await fs.getDoc(ref); cb(s.exists() ? s.data() : null); } catch (e) { console.error(e); }
        }
        timer = setTimeout(tick, secs * 1000);
      };
      const onVis = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); } };
      document.addEventListener('visibilitychange', onVis);
      tick();
      return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
    }

    return {
      mode: 'live',
      onAuth: (cb) => au.onAuthStateChanged(auth, (u) => cb(!!u)),
      login: (code) => au.signInWithEmailAndPassword(auth, CFG.scorekeeperEmail, code),
      logout: () => au.signOut(auth),
      // Which tournament is "live" rarely changes: spectators read it once on load.
      watchSite(cb, live) {
        if (live) return watch(siteRef, (d) => cb(d || {}), true);
        fs.getDoc(siteRef).then((s) => cb(s.exists() ? s.data() : {})).catch((e) => { console.error(e); cb({}); });
        return () => {};
      },
      setActive: (id) => fs.setDoc(siteRef, { activeId: id }, { merge: true }),
      watchTournament: (id, cb, live) => watch(tRef(id), cb, live),
      async list() {
        const q = await fs.getDocs(fs.collection(db, 'tournaments'));
        return q.docs.map((d) => ({ id: d.id, name: d.data().name, date: d.data().date }));
      },
      save: (t) => fs.setDoc(tRef(t.id), strip(t)),
      update: (id, fields) => fs.updateDoc(tRef(id), strip(fields)),
      remove: (id) => fs.deleteDoc(tRef(id)),
    };
  }

  // ---------------- Demo (localStorage, syncs across tabs) ----------------
  function demoStore() {
    const K = 'vbdemo:';
    const DEMO_CODE = 'demo123';
    const mem = {};
    const get = (k) => {
      try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : null; }
      catch (e) { return mem[k] ? JSON.parse(mem[k]) : null; }
    };
    const put = (k, v) => {
      const s = JSON.stringify(v);
      try { if (v === null) localStorage.removeItem(K + k); else localStorage.setItem(K + k, s); }
      catch (e) { if (v === null) delete mem[k]; else mem[k] = s; }
      notify(k);
    };
    const keys = () => {
      try { return Object.keys(localStorage).filter((k) => k.startsWith(K)).map((k) => k.slice(K.length)); }
      catch (e) { return Object.keys(mem); }
    };
    let ch = null;
    try { ch = new BroadcastChannel('vbdemo'); } catch (e) { /* ignore */ }
    const siteSubs = new Set(), tSubs = new Map(), authSubs = new Set();
    let authed = false;
    try { authed = localStorage.getItem(K + '_auth') === '1'; } catch (e) { /* ignore */ }

    function fire(k) {
      if (k === 'site') siteSubs.forEach((cb) => cb(get('site') || {}));
      else if (k.startsWith('t:')) (tSubs.get(k.slice(2)) || new Set()).forEach((cb) => cb(get(k)));
    }
    function notify(k) { setTimeout(() => fire(k), 0); if (ch) ch.postMessage(k); }
    if (ch) ch.onmessage = (e) => fire(e.data);

    const setAuth = (v) => {
      authed = v;
      try { localStorage.setItem(K + '_auth', v ? '1' : '0'); } catch (e) { /* ignore */ }
      authSubs.forEach((cb) => cb(v));
    };

    return {
      mode: 'demo',
      onAuth(cb) { authSubs.add(cb); setTimeout(() => cb(authed), 0); return () => authSubs.delete(cb); },
      login(code) {
        if (code === DEMO_CODE) { setAuth(true); return Promise.resolve(); }
        return Promise.reject(new Error('Wrong code (demo code is demo123)'));
      },
      logout() { setAuth(false); return Promise.resolve(); },
      watchSite(cb) { siteSubs.add(cb); setTimeout(() => cb(get('site') || {}), 0); return () => siteSubs.delete(cb); },
      setActive(id) { put('site', Object.assign(get('site') || {}, { activeId: id })); return Promise.resolve(); },
      watchTournament(id, cb) {
        if (!tSubs.has(id)) tSubs.set(id, new Set());
        tSubs.get(id).add(cb);
        setTimeout(() => cb(get('t:' + id)), 0);
        return () => tSubs.get(id).delete(cb);
      },
      list() {
        return Promise.resolve(keys().filter((k) => k.startsWith('t:')).map((k) => {
          const t = get(k); return { id: t.id, name: t.name, date: t.date };
        }));
      },
      save(t) { put('t:' + t.id, strip(t)); return Promise.resolve(); },
      update(id, fields) {
        const t = get('t:' + id);
        if (!t) return Promise.reject(new Error('Not found'));
        for (const [p, v] of Object.entries(strip(fields))) root.VBLogic.setPath(t, p, v);
        put('t:' + id, t);
        return Promise.resolve();
      },
      remove(id) { put('t:' + id, null); return Promise.resolve(); },
    };
  }

  root.VBStore = { createStore };
})(window);
