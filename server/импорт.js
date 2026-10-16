/* Разовый перенос данных из Google Таблицы в базу сервера.
   node server/импорт.js <выгрузка.json> <база.sqlite>
   Выгрузка — ответ действия dump в Apps Script: { sessions: [[…]], responses: [[…]] }.
   Строки ложатся в том же порядке, первая — шапка. В уже заполненную базу
   не пишет: перенос делается один раз, до первых прохождений на сервере. */

'use strict';
const fs = require('node:fs');
const sheets = require('./sheets');

const [src, dbPath] = process.argv.slice(2);
if (!src || !dbPath) { console.error('нужно: node server/импорт.js выгрузка.json база.sqlite'); process.exit(1); }

const dump = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!dump.ok || !Array.isArray(dump.sessions) || !Array.isArray(dump.responses)) {
  console.error('это не выгрузка dump'); process.exit(1);
}

sheets.init(dbPath);
const store = sheets.open(dbPath);
// лист с одной шапкой бэкенд заводит сам при первом запросе — такой можно заменить
for (const name of ['sessions', 'responses']) {
  const sh = store.book.getSheetByName(name);
  if (sh && sh.getLastRow() > 1) {
    console.error(`в листе ${name} уже есть данные — перенос не делаю`); process.exit(1);
  }
}
store.db.prepare("DELETE FROM rows WHERE sheet IN ('sessions', 'responses')").run();

store.lock.waitLock();
for (const name of ['sessions', 'responses']) {
  const sh = store.book.insertSheet(name);
  // пустые хвосты строк Google отдаёт ''; их не храним
  dump[name].forEach(row => {
    const r = row.slice();
    while (r.length && r[r.length - 1] === '') r.pop();
    sh.appendRow(r);
  });
  console.log(`${name}: ${dump[name].length - 1} строк`);
}
store.lock.releaseLock();
