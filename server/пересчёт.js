/* Пересчёт баллов расстановки по сохранённым порядкам — после смены правила подсчёта.
   node server/пересчёт.js <база.sqlite> [--записать]
   Без --записать только показывает, сколько строк изменится. Судья не нужен:
   уровни своих комментариев не меняются, пересчитываются баллы веток,
   баллы и зоны навыков. Строки прежних версий тестов пропускаются. */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sheets = require('./sheets');

const [dbPath, flag] = process.argv.slice(2);
if (!dbPath) { console.error('нужно: node server/пересчёт.js база.sqlite [--записать]'); process.exit(1); }
const write = flag === '--записать';

const ctx = {};
vm.createContext(ctx);
const GS = path.resolve(__dirname, '..', 'apps-script');
for (const f of ['config.gs', 'keys.gs', 'scoring.gs']) {
  vm.runInContext(fs.readFileSync(path.join(GS, f), 'utf8').replace(/^module\.exports.*$/gm, ''), ctx);
}
const { CONFIG, buildMap } = ctx;

const store = sheets.open(dbPath);
const sh = store.book.getSheetByName('responses');
const values = sh.getDataRange().getValues();
const head = values[0].map(String);
const col = n => head.indexOf(n);

let changed = 0, skipped = 0, cells = 0;
if (write) store.lock.waitLock();
for (let i = 1; i < values.length; i++) {
  const row = values[i];
  const test = CONFIG.tests.find(t => t.id === String(row[col('test_id')]));
  if (!test) { skipped++; continue; }
  const orderings = {};
  test.situations.forEach(sid => {
    orderings[sid] = String(row[col(sid + '_order')] || '').split(/\s+/).filter(Boolean);
  });
  const map = buildMap(CONFIG.skills, test, orderings, null);
  const next = {};
  test.situations.forEach(sid => { next[sid + '_score'] = map.perSituation[sid]; });
  map.skills.forEach(sk => { next[sk.id + '_score'] = sk.score; next[sk.id + '_zone'] = sk.zone; });

  let rowChanged = false;
  for (const name in next) {
    const c = col(name);
    if (c < 0 || String(row[c]) === String(next[name])) continue;
    rowChanged = true; cells++;
    if (write) sh.getRange(i + 1, c + 1).setValue(next[name]);
  }
  if (rowChanged) changed++;
}
if (write) store.lock.releaseLock();
console.log(`${write ? 'записано' : 'изменится'}: строк ${changed}, ячеек ${cells}; пропущено строк прежних версий: ${skipped}; всего строк: ${values.length - 1}`);
