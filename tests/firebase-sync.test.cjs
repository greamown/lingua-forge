const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '../practice.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Replace network SDK imports at the boundary; exercise the real app and sync module together.
const syncSource = readFileSync(join(__dirname, '../firebase-sync.js'), 'utf8').replace(/^import .*;\s*$/gm, '');
const DELETE = Symbol('delete');

// One device = the practice page plus the sync module, talking to a shared fake Firestore document.
function device(remote, language = 'en', { fail = false, stored = new Map() } = {}) {
  const elements = new Map();
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set((tag[0].match(/class="([^"]*)"/)?.[1] || '').split(' '));
    elements.set(tag[1], {
      value: '', textContent: '', disabled: false, innerHTML: '', hidden: false, dataset: {},
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, force) { const show = force ?? !classes.has(name); show ? classes.add(name) : classes.delete(name); return show; },
      },
      focus() {}, setAttribute(name, value) { this[name] = value; }, removeAttribute() {},
    });
  }
  const stats = { cloudWrites: 0 };
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [], body: {}, documentElement: { dataset: {} }, createTreeWalker: () => ({ nextNode: () => null }), addEventListener() {} },
    window: { scrollTo() {}, addEventListener() {} },
    location: { search: '?lang=' + language }, URLSearchParams, NodeFilter: { SHOW_TEXT: 4 },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    Intl, Date, console, setTimeout, clearTimeout, ProgressRecords: require('../progress-records.js'),
    firebaseConfig: { apiKey: 'test', projectId: 'test' }, initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
    onAuthStateChanged: () => {}, GoogleAuthProvider: class {}, signInWithPopup: async () => {}, signOut: async () => {},
    doc: (_, ...path) => path, serverTimestamp: () => 123, deleteField: () => DELETE,
    runTransaction: async (_, run) => {
      if (fail) throw Error('offline');
      return run({
        get: async () => ({ exists: () => true, data: () => JSON.parse(JSON.stringify(remote)) }),
        set: (_, value, { mergeFields }) => { stats.cloudWrites++; for (const f of mergeFields) value[f] === DELETE ? delete remote[f] : (remote[f] = JSON.parse(JSON.stringify(value[f]))); },
      });
    },
  });
  vm.runInContext(script, context);
  vm.runInContext(syncSource + '\nglobalThis.sync=sync;currentUser={uid:"u1",email:"me@example.com"};db={};', context);
  return { run: code => vm.runInContext(code, context), el: id => elements.get(id), stored, stats, sync: () => context.sync() };
}

test('practice on two devices is merged item by item', async () => {
  const remote = {};
  const phone = device(remote), laptop = device(remote);
  phone.run('schedule(data[0],2)');
  await phone.sync();
  laptop.run('schedule(data[1],0)');
  await laptop.sync();
  await phone.sync();
  for (const d of [phone, laptop]) {
    assert.equal(d.run('data[0].seen'), 1);
    assert.equal(d.run('data[0].level'), 1);
    assert.equal(d.run('data[1].seen'), 1);
    assert.equal(d.run('data[1].level'), 0);
  }
  assert.match(phone.el('firebaseStatus').textContent, /已同步 10 筆英文/);
  assert.equal(phone.el('cloudSyncLabel').textContent, '已同步');
});

test('each item records when it was first and last practiced', () => {
  const d = device({});
  d.run('schedule(data[0],2)');
  const first = d.run('data[0].firstStudiedAt');
  assert.ok(first > 0);
  assert.equal(d.run('data[0].lastStudiedAt'), first);
  d.run('renderLibrary()');
  assert.match(d.el('items').innerHTML, /練習 1 次 · 首次 .+ · 上次 /);
  const records = JSON.parse(d.stored.get('english-forge-v1-records'));
  assert.equal(Object.values(records).find(r => r.english === d.run('data[0].english')).lastStudiedAt, first);
});

test('importing the same lesson on two devices does not duplicate it after sync', async () => {
  const remote = {};
  const a = device(remote), b = device(remote);
  for (const d of [a, b]) d.run('mergeItems([{english:"Shared lesson.",chinese:"共同教材"}])');
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(a.run('data.filter(x=>x.english==="Shared lesson.").length'), 1);
  assert.equal(a.run('data.length'), 11);
  assert.equal(a.run('data[10].english'), 'Shared lesson.', 'library order is kept');
});

test('English and Japanese sync to separate fields and keep other apps\' data', async () => {
  const remote = { agentRecords: { keep: { at: 1 } } };
  await device(remote, 'en').sync();
  await device(remote, 'ja').sync();
  assert.ok(Object.values(JSON.parse(remote.japaneseRecords)).some(r => r.english === '水をください。'));
  assert.equal(Object.keys(JSON.parse(remote.englishRecords)).length, 10);
  assert.deepEqual(remote.agentRecords, { keep: { at: 1 } });
});

test('old snapshot backups are merged in and removed', async () => {
  const remote = { items: [{ english: 'From old backup.', chinese: '舊備份', seen: 3, level: 2, due: '2026-12-01' }], updatedAt: { seconds: 1 }, japaneseItems: [{ english: '猫', chinese: '貓' }] };
  const d = device(remote, 'en');
  await d.sync();
  assert.equal(d.run('data.find(x=>x.english==="From old backup.").seen'), 3);
  assert.equal('items' in remote, false);
  assert.equal('updatedAt' in remote, false);
  assert.deepEqual(remote.japaneseItems, [{ english: '猫', chinese: '貓' }], 'Japanese legacy data waits for the Japanese page');
});

test('a failed sync keeps local progress and offers a retry', async () => {
  const d = device({}, 'en', { fail: true });
  d.run('schedule(data[0],2)');
  await d.sync();
  assert.equal(d.run('data[0].seen'), 1);
  assert.match(d.el('firebaseStatus').textContent, /同步失敗：offline/);
  assert.equal(d.el('cloudSyncLabel').textContent, '同步失敗，重試');
});

test('deleting an item on one device removes it on the other after sync', async () => {
  const remote = {};
  const a = device(remote), b = device(remote);
  await a.sync(); await b.sync();
  const english = a.run('data[0].english');
  a.run('confirm=()=>true;deleteItem(0)');
  await a.sync(); await b.sync();
  assert.equal(b.run('data.some(x=>x.english===' + JSON.stringify(english) + ')'), false);
  assert.equal(b.run('data.length'), 9);
});
